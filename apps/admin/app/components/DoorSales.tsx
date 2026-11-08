import { Button, cn } from "@form-at/ui";
import { useState } from "react";
import type { DoorMethod, DoorSummary } from "~/data/door-sales";
import type { DoorPriceResponseBody } from "~/routes/api/tickets/door-price";
import type { DoorSaleResponseBody, DoorUndoResponseBody } from "~/routes/api/tickets/door-sales";
import { fmtClock, fmtPounds } from "~/utils/fmt";

// The door counter: how many are inside against the venue's capacity, the
// cash and card sold at the door, and the cash that should be in the box.
//
// Numbers only ever change from a server response. A tap that fails leaves
// them as they were and says "not saved, tap again", so a dropped request at a
// door with weak signal never looks counted. Every write answers with the
// fresh totals, which also brings in the other door phones' sales.

interface DoorSalesProps {
  /** The door numbers from the page load; null when they couldn't be read. */
  door: DoorSummary | null;
  capacity: number;
  /** Paid online orders; null when the list couldn't be read. */
  onlinePaid: number | null;
  /** Online buyers checked in so far; null when the list couldn't be read. */
  onlineIn: number | null;
}

/** Room left at or below this is shown in red: the door should slow down. */
const LOW_ROOM = 20;

type Notice = { tone: "ok" | "error"; text: string };

type SendResult<T> =
  | { kind: "ok"; body: T }
  | { kind: "not_found" }
  | { kind: "failed"; status: number | null };

const priceInputClass =
  "w-24 bg-black border border-grey/30 px-3 py-2 text-white font-mono text-base focus:border-gold outline-none";

/** "12", "12.5" or "12.50" → pence; null for anything else. */
function parsePounds(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value.trim())) return null;
  return Math.round(Number.parseFloat(value) * 100);
}

function failureText(status: number | null): string {
  if (status === 401) return "not saved: not authorized, reload the page";
  return "not saved, tap again";
}

export function DoorSales({ door, capacity, onlinePaid, onlineIn }: DoorSalesProps) {
  // The newest summary a write returned, kept with the page-load summary it
  // replaced: after a refresh brings a new `door`, the page load wins again.
  const [fresh, setFresh] = useState<{ base: DoorSummary | null; value: DoorSummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [priceDraft, setPriceDraft] = useState<string | null>(null);

  const summary = fresh && fresh.base === door ? fresh.value : door;
  const doorSold = summary ? summary.cash + summary.card : null;
  const inside = doorSold != null && onlineIn != null ? onlineIn + doorSold : null;
  const roomLeft = doorSold != null && onlinePaid != null ? capacity - onlinePaid - doorSold : null;
  const roomIsLow = roomLeft != null && roomLeft <= LOW_ROOM;

  // Sends one write and, when it worked, applies the summary it returned.
  // The caller turns the result into the notice.
  async function send<T extends { summary: DoorSummary }>(
    url: string,
    init: RequestInit,
  ): Promise<SendResult<T>> {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(url, init);
      if (response.status === 404) return { kind: "not_found" };
      if (!response.ok) return { kind: "failed", status: response.status };
      const body = (await response.json()) as T;
      setFresh({ base: door, value: body.summary });
      return { kind: "ok", body };
    } catch {
      // No signal, or an expired Access session (see SendPushForm): either
      // way nothing was saved.
      return { kind: "failed", status: null };
    } finally {
      setBusy(false);
    }
  }

  const handleSale = async (method: DoorMethod) => {
    const result = await send<DoorSaleResponseBody>("/api/tickets/door-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method }),
    });
    setNotice(
      result.kind === "ok"
        ? { tone: "ok", text: `saved: +1 ${method}` }
        : { tone: "error", text: failureText(result.kind === "failed" ? result.status : null) },
    );
  };

  const handleUndo = async () => {
    const result = await send<DoorUndoResponseBody>("/api/tickets/door-sales", {
      method: "DELETE",
    });
    if (result.kind === "ok") {
      const { method, createdAt } = result.body.undone;
      setNotice({ tone: "ok", text: `undid 1 ${method} from ${fmtClock(createdAt)}` });
    } else if (result.kind === "not_found") {
      setNotice({ tone: "error", text: "nothing of yours to undo from the last minute" });
    } else {
      setNotice({ tone: "error", text: failureText(result.status) });
    }
  };

  const draftPence = priceDraft == null ? null : parsePounds(priceDraft);

  const handleSavePrice = async () => {
    if (draftPence == null) return;
    const result = await send<DoorPriceResponseBody>("/api/tickets/door-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pricePence: draftPence }),
    });
    if (result.kind === "ok") {
      setPriceDraft(null);
      setNotice({
        tone: "ok",
        text: `door price now ${fmtPounds(result.body.summary.pricePence)}`,
      });
    } else {
      setNotice({
        tone: "error",
        text: failureText(result.kind === "failed" ? result.status : null),
      });
    }
  };

  const tapClass = cn("min-h-14 text-lg", busy && "opacity-40 cursor-not-allowed");

  return (
    <section aria-label="door sales" className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="border border-grey/30 py-3">
          <p className="text-xs text-grey tracking-widest">inside</p>
          <p className="font-display text-4xl text-white">
            {inside ?? "—"}
            <span className="text-lg text-grey"> / {capacity}</span>
          </p>
        </div>
        <div className={cn("border py-3", roomIsLow ? "border-red-400" : "border-grey/30")}>
          <p className={cn("text-xs tracking-widest", roomIsLow ? "text-red-400" : "text-grey")}>
            room left
          </p>
          <p className={cn("font-display text-4xl", roomIsLow ? "text-red-400" : "text-white")}>
            {roomLeft ?? "—"}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["online in", onlineIn],
            ["door cash", summary?.cash ?? null],
            ["door card", summary?.card ?? null],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="border border-grey/30 py-2">
            <dt className="text-xs text-grey tracking-widest">{label}</dt>
            <dd className="font-display text-2xl text-white">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Button
          variant="secondary"
          onClick={() => handleSale("cash")}
          disabled={busy}
          className={tapClass}
        >
          +1 cash
        </Button>
        <Button
          variant="secondary"
          onClick={() => handleSale("card")}
          disabled={busy}
          className={tapClass}
        >
          +1 card
        </Button>
        <Button variant="fail" onClick={handleUndo} disabled={busy} className={tapClass}>
          −1
        </Button>
      </div>

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn("text-sm", notice.tone === "error" ? "text-red-400" : "text-gold")}
        >
          {notice.text}
        </p>
      )}

      <div className="border-t border-grey/10 pt-3 space-y-2">
        <p className="t-body text-grey">
          expected cash in the box:{" "}
          <span className="text-white">{summary ? fmtPounds(summary.expectedCashPence) : "—"}</span>
        </p>
        {priceDraft == null ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="t-body text-grey">
              door price:{" "}
              <span className="text-white">{summary ? fmtPounds(summary.pricePence) : "—"}</span>
            </p>
            <Button
              variant="secondary"
              onClick={() => setPriceDraft(summary ? (summary.pricePence / 100).toFixed(2) : "")}
              disabled={busy}
              className="min-h-12 text-base"
            >
              change
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label htmlFor="door-price" className="t-body text-grey">
              door price £
            </label>
            <input
              id="door-price"
              inputMode="decimal"
              autoComplete="off"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
              className={priceInputClass}
            />
            <Button
              variant="secondary"
              onClick={handleSavePrice}
              disabled={busy || draftPence == null}
              className={cn(
                "min-h-12 text-base",
                (busy || draftPence == null) && "opacity-40 cursor-not-allowed",
              )}
            >
              save
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPriceDraft(null)}
              className="min-h-12 text-base"
            >
              cancel
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

import type { PaidOrder } from "@form-at/data/tickets";
import { BracketLabel, Button, cn } from "@form-at/ui";
import { type ReactNode, useState } from "react";
import type { DoorSummary } from "~/data/door-sales";
import type { CheckInResponseBody } from "~/routes/api/tickets/check-in";
import { fmtClock } from "~/utils/fmt";
import { DoorSales } from "./DoorSales";

// The door: the door sales counter, every paid ticket (an order of 3 is three
// rows, "1 of 3"…), a search over name and email, and one tap to let a ticket
// in. Built for a phone in a dark basement: large tap targets, large
// text, nothing to scroll sideways. The list is loaded once on the server;
// search runs here over that list, so it keeps working between refreshes.

interface DoorListProps {
  /** null when the list couldn't be read: counts show `—`, never `0`. */
  orders: PaidOrder[] | null;
  /** The door sales numbers; null when they couldn't be read. */
  door: DoorSummary | null;
  capacity: number;
  onRefresh: () => Promise<void>;
}

/** What a tap on this device found out about a ticket since the list loaded. */
type RowOutcome =
  | { kind: "checked_in"; checkedInAt: number }
  | { kind: "already_used"; checkedInAt: number; checkedInBy: string | null }
  | { kind: "error"; message: string };

const searchClass =
  "w-full bg-black border border-grey/30 px-3 py-3 text-white font-mono text-base focus:border-gold outline-none";

function matchesDoorSearch(order: PaidOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    (order.name?.toLowerCase().includes(q) ?? false) ||
    (order.email?.toLowerCase().includes(q) ?? false)
  );
}

function errorFor(status: number): string {
  if (status === 401) return "not authorized: reload the page";
  if (status === 404) return "not valid: no paid ticket with this id";
  return "check-in failed: try again";
}

export function DoorList({ orders, door, capacity, onRefresh }: DoorListProps) {
  const [query, setQuery] = useState("");
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({});
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const checkedInAtOf = (order: PaidOrder): number | null => {
    if (order.checkedInAt != null) return order.checkedInAt;
    const outcome = order.ticketId ? outcomes[order.ticketId] : undefined;
    return outcome && outcome.kind !== "error" ? outcome.checkedInAt : null;
  };

  // One row per ticket. A paid order whose tickets are missing is one row
  // standing for all its seats, so it counts its whole quantity.
  const paid = orders ? orders.reduce((n, o) => n + (o.ticketId ? 1 : o.quantity), 0) : null;
  const checkedIn = orders ? orders.filter((o) => checkedInAtOf(o) != null).length : null;
  const remaining = paid != null && checkedIn != null ? paid - checkedIn : null;
  const visible = orders?.filter((o) => matchesDoorSearch(o, query)) ?? [];

  const handleCheckIn = async (ticketId: string) => {
    setBusyTicketId(ticketId);
    let outcome: RowOutcome;
    try {
      const response = await fetch("/api/tickets/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      if (response.status === 200 || response.status === 409) {
        const body = (await response.json()) as CheckInResponseBody;
        outcome =
          body.status === "checked_in"
            ? { kind: "checked_in", checkedInAt: body.checkedInAt }
            : {
                kind: "already_used",
                checkedInAt: body.checkedInAt,
                checkedInBy: body.checkedInBy,
              };
      } else {
        outcome = { kind: "error", message: errorFor(response.status) };
      }
    } catch {
      // A thrown fetch is both what no signal looks like and what an expired
      // Access session looks like (see SendPushForm), so the message covers both.
      outcome = { kind: "error", message: "check-in failed: check your signal or reload" };
    }
    setOutcomes((prev) => ({ ...prev, [ticketId]: outcome }));
    setBusyTicketId(null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-5">
      <DoorSales door={door} capacity={capacity} onlinePaid={paid} onlineIn={checkedIn} />

      <dl className="grid grid-cols-2 gap-2 border-t border-grey/10 pt-5 text-center">
        {(
          [
            ["paid online", paid],
            ["to come", remaining],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="border border-grey/30 py-2">
            <dt className="text-xs text-grey tracking-widest">{label}</dt>
            <dd className="font-display text-2xl text-white">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Button
          variant="secondary"
          onClick={handleRefresh}
          disabled={refreshing}
          className={cn("min-h-12 text-base", refreshing && "opacity-40 cursor-not-allowed")}
        >
          {refreshing ? "refreshing" : "refresh"}
        </Button>
        <a
          href="/api/tickets/door-csv"
          download
          className="flex min-h-12 items-center text-base text-grey hover:text-white tracking-widest"
        >
          <BracketLabel>download csv</BracketLabel>
        </a>
      </div>

      {orders == null ? (
        <p className="t-body sm:t-body-md text-grey">
          Couldn't load the door list. Reload the page; if it still fails, use the printed CSV.
        </p>
      ) : (
        <>
          <div>
            <label htmlFor="door-search" className="block text-xs text-grey tracking-widest mb-1">
              search name or email
            </label>
            <input
              id="door-search"
              type="search"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={searchClass}
            />
          </div>

          {visible.length === 0 ? (
            <p className="t-body text-grey">
              {orders.length === 0 ? "No paid orders yet." : "No one matches that search."}
            </p>
          ) : (
            <ul className="divide-y divide-grey/10 border-y border-grey/10">
              {visible.map((order) => (
                <DoorRow
                  key={order.ticketId ?? order.orderId}
                  order={order}
                  checkedInAt={checkedInAtOf(order)}
                  outcome={order.ticketId ? outcomes[order.ticketId] : undefined}
                  busy={order.ticketId != null && busyTicketId === order.ticketId}
                  onCheckIn={handleCheckIn}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function DoorRow({
  order,
  checkedInAt,
  outcome,
  busy,
  onCheckIn,
}: {
  order: PaidOrder;
  checkedInAt: number | null;
  outcome: RowOutcome | undefined;
  busy: boolean;
  onCheckIn: (ticketId: string) => void;
}) {
  const { ticketId } = order;

  let status: ReactNode;
  if (outcome?.kind === "already_used") {
    status = (
      <p className="text-base text-red-400">
        already used at {fmtClock(outcome.checkedInAt)}
        {outcome.checkedInBy && <span className="block text-xs">by {outcome.checkedInBy}</span>}
      </p>
    );
  } else if (checkedInAt != null) {
    status = <p className="text-base text-gold">in at {fmtClock(checkedInAt)}</p>;
  } else if (ticketId == null) {
    status = <p className="text-xs text-grey">no ticket yet</p>;
  } else {
    status = (
      <Button
        variant="secondary"
        onClick={() => onCheckIn(ticketId)}
        disabled={busy}
        className={cn("min-h-12 text-base", busy && "opacity-40 cursor-not-allowed")}
      >
        {busy ? "checking" : "check in"}
      </Button>
    );
  }

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className={cn("text-lg", order.name ? "text-white" : "text-grey italic")}>
          {order.name ?? "no name"}
        </p>
        <p className="text-sm text-grey break-all">{order.email ?? "no email"}</p>
        <p className="text-xs text-grey/70 tracking-widest">
          {order.tierName}
          {order.quantity > 1 &&
            (order.seq != null
              ? ` · ${order.seq + 1} of ${order.quantity}`
              : ` · ${order.quantity} tickets`)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {status}
        {outcome?.kind === "error" && (
          <p className="mt-1 max-w-40 text-xs text-red-400">{outcome.message}</p>
        )}
      </div>
    </li>
  );
}

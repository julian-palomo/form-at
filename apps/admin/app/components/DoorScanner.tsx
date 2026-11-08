import { cn } from "@form-at/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CheckInResponseBody } from "~/routes/api/tickets/check-in";
import { fmtClock } from "~/utils/fmt";
import { useQrCamera } from "~/utils/useQrCamera";

// The door's QR scanner: the rear camera, and one large result per scan that
// the person at the door can read at arm's length in the dark. The camera
// stays on between people. Loaded lazily by DoorList, so the decoder only
// downloads when someone presses `scan`.

export interface DoorScannerProps {
  /** A scan the server answered for a real ticket, so the list below can show it too. */
  onCheckIn: (ticketId: string, body: CheckInResponseBody) => void;
}

type ScanResult =
  | { kind: "in"; body: CheckInResponseBody }
  | { kind: "used"; body: Extract<CheckInResponseBody, { status: "already_used" }> }
  | { kind: "not_valid" }
  | { kind: "error"; message: string };

/**
 * The camera sees a held-up QR several times a second. After a scan, the same
 * code is ignored for this long, so the person just let in doesn't read as
 * ALREADY USED a moment later. Any other code is checked at once.
 */
const SAME_CODE_IGNORE_MS = 10_000;
/** After a failed request the same code may retry sooner. */
const SAME_CODE_RETRY_MS = 2_000;
/** How long a result stays up before the panel asks for the next QR. */
const RESULT_MS = 4_000;

const VIBRATE_IN = [80];
const VIBRATE_REFUSED = [250, 100, 250];

function errorFor(status: number): string {
  if (status === 401) return "not authorized: reload the page";
  if (status === 503) return "scanner not set up: check in by name below";
  return "check-in failed: try again";
}

function vibrate(pattern: number[]) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

function holder(body: CheckInResponseBody): string {
  const name = body.name ?? "no name";
  return body.quantity > 1 ? `${name} (${body.seq + 1} of ${body.quantity})` : name;
}

export default function DoorScanner({ onCheckIn }: DoorScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const busyRef = useRef(false);
  const ignoreRef = useRef<{ code: string; until: number } | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    [],
  );

  const show = (next: ScanResult) => {
    setResult(next);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setResult(null), RESULT_MS);
  };

  const handleCode = async (code: string) => {
    const now = Date.now();
    const ignored = ignoreRef.current;
    if (busyRef.current || (ignored?.code === code && now < ignored.until)) return;
    busyRef.current = true;
    ignoreRef.current = { code, until: now + SAME_CODE_IGNORE_MS };

    let next: ScanResult;
    try {
      const response = await fetch("/api/tickets/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code }),
      });
      if (response.status === 200 || response.status === 409) {
        const body = (await response.json()) as CheckInResponseBody;
        // The server verified the signature, so the part before the last
        // dot is a real ticket id.
        onCheckIn(code.slice(0, code.lastIndexOf(".")), body);
        next = body.status === "checked_in" ? { kind: "in", body } : { kind: "used", body };
      } else if (response.status === 404 || response.status === 400) {
        // 400 is a QR that isn't shaped like a ticket at all.
        next = { kind: "not_valid" };
      } else {
        next = { kind: "error", message: errorFor(response.status) };
      }
    } catch {
      // A thrown fetch is both no signal and an expired Access session.
      next = { kind: "error", message: "check-in failed: check your signal or reload" };
    }

    if (next.kind === "error") {
      ignoreRef.current = { code, until: Date.now() + SAME_CODE_RETRY_MS };
    }
    vibrate(next.kind === "in" ? VIBRATE_IN : VIBRATE_REFUSED);
    show(next);
    busyRef.current = false;
  };

  const camera = useQrCamera(videoRef, handleCode);

  return (
    <section aria-label="QR scanner" className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden border border-grey/30 bg-black">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        {camera !== "running" && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center t-body text-grey">
            {camera === "starting" && "starting the camera…"}
            {camera === "denied" &&
              "Camera blocked. Allow it in the browser's site settings, then open the scanner again."}
            {camera === "unavailable" && "No camera here. Check in by name below."}
          </p>
        )}
      </div>
      <ScanResultPanel result={result} />
    </section>
  );
}

function ScanResultPanel({ result }: { result: ScanResult | null }) {
  let tone: string;
  let content: ReactNode;

  if (result == null) {
    tone = "border border-grey/30 text-grey";
    content = <p className="text-base tracking-widest">point the camera at a ticket's QR</p>;
  } else if (result.kind === "in") {
    tone = "bg-green-500 text-black";
    content = <p className="font-display text-3xl break-words">IN · {holder(result.body)}</p>;
  } else if (result.kind === "used") {
    tone = "bg-red-600 text-white";
    content = (
      <>
        <p className="font-display text-3xl">ALREADY USED at {fmtClock(result.body.checkedInAt)}</p>
        <p className="text-base break-words">{holder(result.body)}</p>
        {result.body.checkedInBy && (
          <p className="text-sm break-all">by {result.body.checkedInBy}</p>
        )}
      </>
    );
  } else if (result.kind === "not_valid") {
    tone = "bg-red-600 text-white";
    content = <p className="font-display text-3xl">NOT VALID</p>;
  } else {
    tone = "border border-red-400 text-red-400";
    content = <p className="text-base">{result.message}</p>;
  }

  return (
    <output
      aria-live="assertive"
      className={cn("flex min-h-28 flex-col justify-center gap-1 px-4 py-3 text-center", tone)}
    >
      {content}
    </output>
  );
}

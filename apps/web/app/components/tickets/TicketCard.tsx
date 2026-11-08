import { getEvent } from "@form-at/data/events";
import { TerminalRow } from "@form-at/ui";
import { Suspense, lazy } from "react";
import type { StoredTicket } from "~/store/ticketsSlice";
import { fmtEventDay } from "~/utils/fmt";

// One ticket as the buyer shows it at the door: the QR on a white square,
// then the facts. Used by `/tickets/$token` (the emailed link), `/tickets`
// (the device's stored tickets) and the page Stripe returns to. Everything
// here comes from the stored ticket and the static event list, so it renders
// with no signal.
//
// `TicketQr` stays a lazy import (CLAUDE.md §1): `uqr` is only loaded on the
// ticket pages. The fallback is the same white square, so the layout doesn't
// jump when the QR arrives.

const TicketQr = lazy(() => import("./TicketQr"));

export type TicketCardTicket = Pick<
  StoredTicket,
  "token" | "eventId" | "tierName" | "name" | "seq" | "quantity"
>;

export function ticketLabel(ticket: Pick<StoredTicket, "seq" | "quantity">): string {
  return ticket.quantity > 1 ? `ticket ${ticket.seq + 1} of ${ticket.quantity}` : "ticket";
}

export function TicketCard({ ticket }: { ticket: TicketCardTicket }) {
  const event = getEvent(ticket.eventId);
  const rows: Array<[string, string]> = [
    ["event", event?.title ?? ticket.eventId],
    ...(event
      ? ([
          ["date", fmtEventDay(event.date)],
          ["venue", event.venue],
          ["time", event.runtime],
        ] as Array<[string, string]>)
      : []),
    [ticketLabel(ticket), ticket.tierName],
    ...(ticket.name ? ([["name", ticket.name]] as Array<[string, string]>) : []),
  ];

  return (
    <article className="flex flex-col items-center gap-6">
      <div className="bg-white w-56 h-56 sm:w-64 sm:h-64">
        <Suspense fallback={<div className="w-full h-full" />}>
          <TicketQr value={ticket.token} />
        </Suspense>
      </div>
      <div className="space-y-1 w-full">
        {rows.map(([label, value]) => (
          <TerminalRow key={label} label={label} value={value} />
        ))}
      </div>
    </article>
  );
}

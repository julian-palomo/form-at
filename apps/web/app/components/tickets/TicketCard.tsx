import { getEvent } from "@form-at/data/events";
import { BracketLabel, TerminalRow } from "@form-at/ui";
import { Suspense, lazy } from "react";
import type { StoredTicket } from "~/store/ticketsSlice";
import { fmtEventDay } from "~/utils/fmt";

// One ticket as the buyer shows it at the door: a gold frame with the
// `[ ticket 1 of 2 ]` tag on its top edge, the QR on a white square inside,
// then the facts. The frame is the shape of a ticket everywhere one is
// drawn; the celebration on the success page is separate (Celebration.tsx).
// Used by `/tickets/$token` (the emailed link), `/tickets`
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
    ["tier", ticket.tierName],
    ...(ticket.name ? ([["name", ticket.name]] as Array<[string, string]>) : []),
  ];

  return (
    <article className="relative flex flex-col items-center gap-6 border-2 border-gold shadow-[0_0_25px_rgba(197,133,56,0.35)] px-5 pt-10 pb-6">
      {/* The tag sits on the frame's top edge; its page-coloured background
          breaks the line behind it. */}
      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-black px-2 text-sm text-grey tracking-widest">
        <BracketLabel>{ticketLabel(ticket)}</BracketLabel>
      </span>
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

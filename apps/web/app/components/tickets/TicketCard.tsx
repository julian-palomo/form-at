import { getEvent } from "@form-at/data/events";
import { BracketLabel, Button, TerminalRow, cn } from "@form-at/ui";
import { Suspense, lazy } from "react";
import { useStore, useStoreHydrated } from "~/store";
import type { StoredTicket } from "~/store/ticketsSlice";
import { fmtEventDay } from "~/utils/fmt";
import { ticketShareTarget } from "~/utils/shareTarget";

// One ticket as the buyer shows it at the door: a plain gold frame (no glow:
// a glow bleeds behind the tag's cut-out) with the `[ ticket 1 of 2 ]` tag
// on its top edge, the QR on a white square inside, then the facts. The frame is the shape of a ticket everywhere one is
// drawn; the celebration on the success page is separate (Celebration.tsx).
// Used by `/tickets/$token` (the emailed link), `/tickets`
// (the device's stored tickets) and the page Stripe returns to. Everything
// here comes from the stored ticket and the static event list, so it renders
// with no signal. Below the facts, `send to a friend` opens ShareModal with
// the ticket's link; once the share or copy completes the stored ticket is
// marked sent (ticketsSlice) and the card shows that, with `keep it` to undo.
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
  const openShareModal = useStore((s) => s.openShareModal);
  const keepTicket = useStore((s) => s.keepTicket);
  // The sent mark lives on the stored copy, so a card drawn from a loader
  // (the ticket page, the success page) reads it from the store too. Read
  // after hydration only: the SSR'd card is never sent.
  const hydrated = useStoreHydrated();
  const sentAt = useStore((s) => s.tickets[ticket.token]?.sentAt ?? null);
  const sent = hydrated && sentAt !== null;
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
    <article className="relative flex flex-col items-center gap-6 border-2 border-gold px-5 pt-10 pb-6">
      {/* The tag sits on the frame's top edge; its page-coloured background
          breaks the line behind it. */}
      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-black px-2 text-sm text-grey tracking-widest">
        <BracketLabel>{ticketLabel(ticket)}</BracketLabel>
      </span>
      {/* A sent ticket dims and its QR is covered, so the sender can't show
          it at the door by mistake while the friend holds the same link. The
          QR stays drawn underneath: `keep it` only lifts the cover. */}
      <div className={cn("flex flex-col items-center gap-6 w-full", sent && "opacity-40")}>
        <div className="relative bg-white w-56 h-56 sm:w-64 sm:h-64">
          <Suspense fallback={<div className="w-full h-full" />}>
            <TicketQr value={ticket.token} />
          </Suspense>
          {sent && (
            <div
              data-testid="ticket-sent-cover"
              className="absolute inset-0 flex items-center justify-center bg-black text-sm text-grey tracking-widest text-center px-4"
            >
              sent to a friend
            </div>
          )}
        </div>
        <div className="space-y-1 w-full">
          {rows.map(([label, value]) => (
            <TerminalRow key={label} label={label} value={value} />
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 w-full">
        {sent ? (
          <Button variant="secondary" onClick={() => keepTicket(ticket.token)}>
            keep it
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => openShareModal(ticketShareTarget(ticket))}>
            send to a friend
          </Button>
        )}
        <p className="text-xs text-grey/60 tracking-widest text-center">
          {sent
            ? "the link is with your friend now. whoever scans it first gets in."
            : "whoever scans it first gets in."}
        </p>
      </div>
    </article>
  );
}

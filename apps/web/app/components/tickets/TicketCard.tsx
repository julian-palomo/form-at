import { getEvent } from "@form-at/data/events";
import { BracketLabel, Button, TerminalRow, cn } from "@form-at/ui";
import { Suspense, lazy, useState } from "react";
import { useStore, useStoreHydrated } from "~/store";
import type { StoredTicket } from "~/store/ticketsSlice";
import { fmtEventDay } from "~/utils/fmt";
import { ticketShareTarget } from "~/utils/shareTarget";
import { TicketQrFullscreen } from "./TicketQrFullscreen";

// One ticket as the buyer shows it at the door: a gold frame with a soft
// glow, the `[ ticket 1 of 2 ]` tag on its top edge, the QR on a white
// square inside, the night's title, then a perforation line and the
// facts, the way a paper ticket splits into stub and counterfoil. A tap on
// the QR fills the screen with it (TicketQrFullscreen) for the scanner in
// a dark club. The frame is the shape of a ticket everywhere one is drawn;
// the celebration on the success page is separate (Celebration.tsx).
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
  const [qrFullscreen, setQrFullscreen] = useState(false);
  const label = ticketLabel(ticket);
  const title = event?.title ?? ticket.eventId;
  const nightLine = event ? `${fmtEventDay(event.date)} · ${event.runtime}` : null;
  const rows: Array<[string, string]> = [
    ...(event ? ([["venue", event.venue]] as Array<[string, string]>) : []),
    ["tier", ticket.tierName],
  ];

  return (
    <article className="relative flex flex-col items-center gap-6 border-2 border-gold shadow-[0_0_25px_rgba(197,133,56,0.35)] px-5 pt-10 pb-6">
      {/* The tag sits on the frame's top edge. Its page-coloured background
          breaks the line behind it, and a blurred shadow of the same colour
          fades the frame's glow out around the text, so the tag doesn't cut
          a hard-edged box out of the glow. */}
      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-black shadow-[0_0_14px_10px_var(--color-black)] px-2 text-sm text-grey tracking-widest">
        <BracketLabel>{label}</BracketLabel>
      </span>
      {/* A sent ticket dims and its QR is covered, so the sender can't show
          it at the door by mistake while the friend holds the same link. The
          QR stays drawn underneath: `keep it` only lifts the cover. */}
      <div className={cn("flex flex-col items-center gap-6 w-full", sent && "opacity-40")}>
        <div className="relative bg-white w-56 h-56 sm:w-64 sm:h-64">
          {/* A covered QR can't be enlarged: the cover is what keeps it off
              the scanner while the friend holds the link. */}
          <button
            type="button"
            aria-label="show the QR code full screen"
            disabled={sent}
            onClick={() => setQrFullscreen(true)}
            className="block w-full h-full cursor-pointer disabled:cursor-default"
          >
            <Suspense fallback={<div className="w-full h-full" />}>
              <TicketQr value={ticket.token} />
            </Suspense>
          </button>
          <TicketQrFullscreen
            open={qrFullscreen}
            onClose={() => setQrFullscreen(false)}
            label={label}
          >
            <Suspense fallback={<div className="w-full h-full" />}>
              <TicketQr value={ticket.token} />
            </Suspense>
          </TicketQrFullscreen>
          {sent && (
            <div
              data-testid="ticket-sent-cover"
              className="absolute inset-0 flex items-center justify-center bg-black text-sm text-grey tracking-widest text-center px-4"
            >
              sent to a friend
            </div>
          )}
        </div>
        <div className="text-center">
          <p className="text-xl text-white tracking-widest">{title}</p>
          {nightLine && <p className="text-sm text-grey mt-1">{nightLine}</p>}
        </div>
        <div aria-hidden="true" className="w-full border-t border-dashed border-gold/40" />
        <div className="space-y-1 w-full">
          {/* The buyer's name leads the facts and is the one the door reads
              against the list, so it is larger and white. */}
          {ticket.name && (
            <TerminalRow label="name" value={ticket.name} className="text-lg text-white mb-2" />
          )}
          {rows.map(([rowLabel, value]) => (
            <TerminalRow key={rowLabel} label={rowLabel} value={value} />
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
        {sent && (
          <p className="text-xs text-grey/60 tracking-widest text-center">
            the link is with your friend now. whoever scans it first gets in.
          </p>
        )}
      </div>
    </article>
  );
}

import { getEvent } from "@form-at/data/events";
import { PageTitle } from "@form-at/ui";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageLayout } from "~/components/PageLayout";
import { TicketCard, ticketLabel } from "~/components/tickets/TicketCard";
import { type TicketPageView, fetchTicket, parseTicketToken } from "~/data/tickets";
import { useStore } from "~/store";
import { pageHead } from "~/utils/head";

/** A check-in time as the door saw it, e.g. "23:41", in the venue's zone whatever the phone's is. */
function doorTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

// The page a ticket's QR link opens: the emailed link, and the QR itself if
// someone scans it with a phone camera instead of the door's scanner. The
// token is verified on the server before D1 is read, and a bad one is a
// plain 404. Opening it stores the ticket on this device, so a ticket bought
// on a laptop is in the phone's app after one tap.
//
// Never cached: sw.ts leaves every `/tickets/` navigation to the network,
// and the ticket is loaded through a POST server function. `noReferrer`
// keeps the token out of the Referer header of any link out of this page.

export const Route = createFileRoute("/tickets/$token")({
  loader: async ({ params }) => {
    let token: string;
    try {
      token = parseTicketToken(params.token);
    } catch {
      throw notFound();
    }
    const ticket = await fetchTicket({ data: token }).catch(() => null);
    if (!ticket) throw notFound();
    return { ticket };
  },
  // The tags a messaging app shows when the link is sent to a friend: the
  // event's name and banner, nothing from the ticket itself (no name, no
  // QR, no token: `path` is the bare list). The banner is the event page's,
  // generated at build by scripts/generate-og.ts.
  head: ({ loaderData }) => {
    const ticket = loaderData?.ticket;
    const event = ticket ? getEvent(ticket.eventId) : undefined;
    return pageHead({
      title: ticket ? `your ticket for ${ticket.eventTitle}` : "Your ticket",
      description: "open the link to save the ticket on your phone and show the qr at the door.",
      path: "/tickets",
      image: event?.flyer ? `/og/events/${event.id}.jpg` : undefined,
      noindex: true,
      noReferrer: true,
    });
  },
  component: TicketPage,
});

function TicketPage() {
  const { ticket } = Route.useLoaderData();
  useStoreTicket(ticket);
  return (
    <PageLayout>
      <div className="flex-1">
        <PageTitle className="text-3xl sm:text-4xl font-display font-bold leading-tight">
          {ticket.quantity > 1 ? ticketLabel(ticket) : "your ticket"}
        </PageTitle>
        <div className="mb-8">
          <TicketCard ticket={ticket} />
        </div>
        {ticket.checkedInAt !== null ? (
          <p className="text-sm sm:text-base text-grey leading-relaxed mb-6">
            this ticket was scanned at {doorTime(ticket.checkedInAt)}. it lets one person in once.
          </p>
        ) : (
          <p className="text-sm sm:text-base text-grey leading-relaxed mb-6">
            show this qr at the door. it's scanned once, so only send it to the friend who's coming
            in on it. it's saved on this device now: no signal needed.
          </p>
        )}
        <Link
          to="/tickets"
          preload="intent"
          className="text-sm text-grey hover:text-gold transition-colors"
        >
          › all your tickets on this device
        </Link>
      </div>
    </PageLayout>
  );
}

/** Stores the ticket once the client is up; a no-op if this device has it. */
function useStoreTicket(ticket: TicketPageView) {
  const addTickets = useStore((s) => s.addTickets);
  useEffect(() => {
    addTickets([
      {
        token: ticket.token,
        eventId: ticket.eventId,
        tierName: ticket.tierName,
        name: ticket.name,
        seq: ticket.seq,
        quantity: ticket.quantity,
        storedAt: Date.now(),
      },
    ]);
  }, [addTickets, ticket]);
}

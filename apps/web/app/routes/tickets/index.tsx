import { getEvent, getUpcomingEvents } from "@form-at/data/events";
import { PageTitle } from "@form-at/ui";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageLayout } from "~/components/PageLayout";
import { RecoverTicketsForm } from "~/components/tickets/RecoverTicketsForm";
import { TicketCard } from "~/components/tickets/TicketCard";
import { fetchTicketAvailability } from "~/data/tickets";
import { useStore, useStoreHydrated } from "~/store";
import { sortedTickets } from "~/store/ticketsSlice";
import { pageHead } from "~/utils/head";

// The tickets this device holds, each with its QR, from the persisted store
// alone: no loader, no fetch, so it works in the basement with no signal.
// The SSR'd HTML has no tickets in it (they live in localStorage), so the
// copy the service worker caches of this page carries no personal data.
// Below the tickets, or below the empty state, the form that emails the
// links again.

export const Route = createFileRoute("/tickets/")({
  head: () =>
    pageHead({
      title: "Your tickets",
      description: "The Form:at tickets saved on this device.",
      path: "/tickets",
      noindex: true,
    }),
  component: TicketsPage,
});

function TicketsPage() {
  return (
    <PageLayout>
      <div className="flex-1">
        <PageTitle className="text-3xl sm:text-4xl font-display font-bold leading-tight">
          your tickets
        </PageTitle>
        <TicketsView />
      </div>
    </PageLayout>
  );
}

/** The page below its title. Exported for tests. */
export function TicketsView() {
  const hydrated = useStoreHydrated();
  const tickets = useStore((s) => s.tickets);
  if (!hydrated) return null;

  const list = sortedTickets(tickets, (eventId) => getEvent(eventId)?.date ?? "");
  return (
    <>
      {list.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <p className="text-sm sm:text-base text-grey leading-relaxed mb-8">
            show the qr at the door. each one is scanned once. they're saved on this device, so no
            signal is needed.
          </p>
          <ul className="space-y-12 mb-12">
            {list.map((ticket) => (
              <li key={ticket.token}>
                <TicketCard ticket={ticket} />
              </li>
            ))}
          </ul>
        </>
      )}
      <RecoverTicketsForm />
    </>
  );
}

// The tab is always there, so before the sale opens this is what a visitor
// finds. Whether tickets can be bought is asked the way the event page's buy
// block asks it (fetchTicketAvailability, after hydration): sales off, or
// no answer, reads as "soon"; a sale that's open points at the events page.
// The line waits for the answer so the copy never changes under the reader;
// the recover form below it doesn't wait.
function EmptyState() {
  const nextEvent = getUpcomingEvents()[0];
  const [onSale, setOnSale] = useState<boolean | null>(nextEvent ? null : false);

  useEffect(() => {
    if (!nextEvent) return;
    let cancelled = false;
    fetchTicketAvailability({ data: nextEvent.id })
      .then((availability) => {
        if (!cancelled) setOnSale(availability !== null);
      })
      .catch(() => {
        if (!cancelled) setOnSale(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nextEvent]);

  if (onSale === null) return <div className="mb-10" />;
  return (
    <p className="text-sm sm:text-base text-grey leading-relaxed mb-10">
      {nextEvent && !onSale ? (
        <>
          tickets for {nextEvent.title.replace(/^Form:at\s+/i, "")} go on sale soon. you'll find
          them here and on the event page.
        </>
      ) : (
        <>
          your tickets will appear here when you buy them.{" "}
          <Link to="/events" preload="intent" className="hover:text-gold transition-colors">
            › events
          </Link>
        </>
      )}
    </p>
  );
}

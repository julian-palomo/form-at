import { type Event, getNextEvent } from "@form-at/data/events";
import { useEffect, useState } from "react";
import { fetchTicketAvailability } from "~/data/tickets";
import { useStore, useStoreHydrated } from "~/store";

/** How long the home page waits for the sale's answer before showing the listening layout. */
const SALE_ANSWER_TIMEOUT_MS = 3000;

export type HomeNight =
  /** Not known yet: the store hasn't hydrated, or the sale hasn't answered. */
  | { state: "pending" }
  /** No night to point at: the manifesto and the play button. */
  | { state: "listening" }
  /** A night to point at. `ticketCount` is how many of its tickets this device holds. */
  | { state: "night"; event: Event; ticketCount: number };

// Which of its two layouts the home page shows.
//
// The night layout needs a night still to come (getNextEvent) and one of:
// this device holds a ticket for it, read from the persisted store, so it
// works offline; or its tickets are on sale, asked the way the event page's
// buy block asks (fetchTicketAvailability, a POST after hydration that
// neither the SSR'd HTML nor the service worker caches). A night that is
// announced but not on sale, sold out, or whose answer fails or takes longer
// than SALE_ANSWER_TIMEOUT_MS, leaves the listening layout.
//
// `pending` exists so the page never starts typing the manifesto and then
// swaps it for the night: the caller renders neither layout until the answer
// is in. With no night to come there is nothing to wait for, so the server
// render already says `listening`.
export function useHomeNight(): HomeNight {
  const hydrated = useStoreHydrated();
  // Read once per mount. The server and the client can only disagree in the
  // instant a night ends.
  const [event] = useState(() => getNextEvent(new Date()));
  const eventId = event?.id;
  const ticketCount = useStore(
    (s) => Object.values(s.tickets).filter((t) => t.eventId === eventId).length,
  );
  const [onSale, setOnSale] = useState<boolean | null>(null);

  const mustAsk = eventId !== undefined && hydrated && ticketCount === 0;
  useEffect(() => {
    if (!mustAsk) return;
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setOnSale(value);
    };
    const timer = setTimeout(() => settle(false), SALE_ANSWER_TIMEOUT_MS);
    fetchTicketAvailability({ data: eventId })
      .then((availability) => settle(availability?.active != null))
      .catch(() => settle(false));
    return () => {
      settled = true;
      clearTimeout(timer);
    };
  }, [mustAsk, eventId]);

  if (!event) return { state: "listening" };
  if (!hydrated) return { state: "pending" };
  if (ticketCount > 0) return { state: "night", event, ticketCount };
  if (onSale === null) return { state: "pending" };
  return onSale ? { state: "night", event, ticketCount: 0 } : { state: "listening" };
}

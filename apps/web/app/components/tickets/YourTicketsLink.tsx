import { getEvent } from "@form-at/data/events";
import { BracketLabel } from "@form-at/ui";
import { Link } from "@tanstack/react-router";
import { useFirstLoad } from "~/hooks/useFirstLoad";
import { useStore, useStoreHydrated } from "~/store";

// The home page's way into `/tickets`: shown while this device holds a ticket
// for a night that hasn't happened yet, nothing otherwise. Reads only the
// persisted store, so it appears after hydration and never in the SSR HTML.

/** `YYYY-MM-DD` of today in UTC; an event's date is a calendar day, compared as text. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function YourTicketsLink({ className }: { className?: string }) {
  const hydrated = useStoreHydrated();
  const isFirstLoad = useFirstLoad();
  const tickets = useStore((s) => s.tickets);
  if (!hydrated) return null;

  const cutoff = today();
  const upcoming = Object.values(tickets).filter((t) => {
    const event = getEvent(t.eventId);
    return event !== undefined && event.date >= cutoff;
  });
  if (upcoming.length === 0) return null;

  const eventIds = new Set(upcoming.map((t) => t.eventId));
  const label =
    eventIds.size === 1
      ? `your ${upcoming.length > 1 ? "tickets" : "ticket"} for ${(
          getEvent(upcoming[0]?.eventId ?? "")?.title ?? ""
        )
          .replace(/^Form:at\s+/i, "")
          .toLowerCase()}`
      : "your tickets";

  // Fades in like the install slot below it (InstallAppButton): both appear
  // after hydration, and a link that pops in beside a fading row jars.
  return (
    <div className={isFirstLoad ? "animate-slow-fade-in" : "animate-fade-in"}>
      <Link to="/tickets" preload="intent" className={className}>
        <BracketLabel>{label}</BracketLabel>
      </Link>
    </div>
  );
}

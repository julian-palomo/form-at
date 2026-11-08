import { Button, PageTitle } from "@form-at/ui";
import { useEffect, useState } from "react";
import {
  type StartCheckoutResult,
  type TicketAvailability,
  fetchTicketAvailability,
  startCheckout,
} from "~/data/tickets";
import { formatPence } from "~/utils/money";

// The buy block on an event page. Availability loads after hydration through
// a POST server function, so neither the SSR'd HTML nor the service worker's
// caches ever hold a price or a "sold out". Renders nothing while loading,
// when sales are off, and for events without tiers.

const MESSAGES: Record<Exclude<StartCheckoutResult["status"], "redirect">, string> = {
  sold_out: "sold out.",
  too_many_holds: "you already have checkouts open. finish or close one, then try again.",
  unavailable: "ticket sales aren't open right now.",
  error: "something went wrong starting the checkout. try again.",
};

export function TicketBlock({ eventId }: { eventId: string }) {
  const [availability, setAvailability] = useState<TicketAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTicketAvailability({ data: eventId })
      .then((result) => {
        if (!cancelled) setAvailability(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!availability) return null;
  const { active } = availability;

  const buy = async () => {
    setBusy(true);
    setMessage(null);
    const result = await startCheckout({ data: eventId }).catch(
      (): StartCheckoutResult => ({ status: "error" }),
    );
    if (result.status === "redirect") {
      window.location.assign(result.url);
      return;
    }
    if (result.status === "sold_out") setAvailability({ ...availability, active: null });
    setMessage(MESSAGES[result.status]);
    setBusy(false);
  };

  return (
    <div className="mb-10">
      <PageTitle>tickets</PageTitle>
      {active ? (
        <>
          <p className="text-sm sm:text-base text-grey leading-relaxed mb-4">
            {active.name} · {formatPence(active.pricePence)}
          </p>
          <Button variant="secondary" onClick={buy} disabled={busy}>
            {busy ? "opening checkout…" : "buy ticket"}
          </Button>
        </>
      ) : (
        <p className="text-sm sm:text-base text-grey leading-relaxed">sold out.</p>
      )}
      {message && active && (
        <output className="block text-sm text-grey leading-relaxed mt-4">{message}</output>
      )}
    </div>
  );
}

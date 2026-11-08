import { Button, PageTitle, cn } from "@form-at/ui";
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
//
// One purchase takes 1 to `maxQuantity` tickets, all in the tier on sale.

const MESSAGES: Record<Exclude<StartCheckoutResult["status"], "redirect">, string> = {
  sold_out: "sold out.",
  fewer_left: "fewer tickets are left at this price now. pick again.",
  too_many_holds: "you already have checkouts open. finish or close one, then try again.",
  unavailable: "ticket sales aren't open right now.",
  error: "something went wrong starting the checkout. try again.",
};

export function TicketBlock({ eventId }: { eventId: string }) {
  const [availability, setAvailability] = useState<TicketAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetchTicketAvailability({ data: eventId })
      .then((result) => {
        if (!cancelled) setAvailability(result);
      })
      // A failed load leaves the block hidden, the same as sales being off.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!availability) return null;
  const { active } = availability;
  // Clamped on every render, so a smaller maxQuantity after a reload or a
  // `fewer_left` answer never leaves the stepper above it.
  const count = active ? Math.min(Math.max(quantity, 1), active.maxQuantity) : 1;

  const buy = async () => {
    setBusy(true);
    setMessage(null);
    const result = await startCheckout({ data: { eventId, quantity: count } }).catch(
      (): StartCheckoutResult => ({ status: "error" }),
    );
    if (result.status === "redirect") {
      window.location.assign(result.url);
      return;
    }
    if (result.status === "sold_out") setAvailability({ ...availability, active: null });
    if (result.status === "fewer_left") setAvailability(result.availability);
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
          {active.maxQuantity > 1 && (
            <div className="flex items-center justify-center gap-6 mb-4">
              <Button
                variant="secondary"
                aria-label="one ticket fewer"
                onClick={() => setQuantity(count - 1)}
                disabled={busy || count <= 1}
                className={cn("text-base", count <= 1 && "opacity-40 cursor-not-allowed")}
              >
                −
              </Button>
              <output
                aria-live="polite"
                className="font-display text-3xl text-white min-w-10 text-center"
              >
                {count}
              </output>
              <Button
                variant="secondary"
                aria-label="one ticket more"
                onClick={() => setQuantity(count + 1)}
                disabled={busy || count >= active.maxQuantity}
                className={cn(
                  "text-base",
                  count >= active.maxQuantity && "opacity-40 cursor-not-allowed",
                )}
              >
                +
              </Button>
            </div>
          )}
          {/* The page's main call to action: full width, like the home page's play button. */}
          <Button
            variant="primary"
            onClick={buy}
            disabled={busy}
            className={cn("w-full sm:text-base", busy && "opacity-60 cursor-wait")}
          >
            <span className="text-gold">›</span>
            <span>
              {busy
                ? "opening checkout…"
                : `${count > 1 ? `buy ${count} tickets` : "buy ticket"} · ${formatPence(active.pricePence * count)}`}
            </span>
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

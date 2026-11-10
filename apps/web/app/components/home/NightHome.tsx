import type { Event } from "@form-at/data/events";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { Image } from "~/components/Image";
import { HomeCta } from "~/components/home/HomeCta";
import { useTrackEvent } from "~/hooks/useTrackEvent";
import { fmtNightLine } from "~/utils/fmt";

type NightHomeProps = {
  event: Event;
  /** How many of this night's tickets this device holds. */
  ticketCount: number;
  /** The page's fade-in. */
  style: CSSProperties;
  pulseDelay: string;
};

// The home page while a night is ahead and its tickets are on sale, or this
// device holds one: the night's image, one line saying when and where, and
// one button. No manifesto and no play button, so the night is the only
// thing asking for a tap.
//
// The button goes to the event page, where the buy block is. On a device
// that already holds a ticket it goes to /tickets instead and doesn't pulse:
// that visitor needs their QR, not another sale.
export function NightHome({ event, ticketCount, style, pulseDelay }: NightHomeProps) {
  const trackEvent = useTrackEvent();
  const name = event.title
    .replace(/^Form:at\s+/i, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  const holdsTicket = ticketCount > 0;
  const ticketsLabel = `your_${ticketCount > 1 ? "tickets" : "ticket"}_for_${name}`;

  return (
    <>
      {event.homeArt && (
        <Link
          to="/events/$eventId"
          params={{ eventId: event.id }}
          preload="intent"
          className="block self-center w-full sm:max-w-sm"
          style={style}
          suppressHydrationWarning
        >
          {/* The box keeps the artwork's own shape while it loads, so the line
              and the button don't jump; on a short phone --fit-night-art
              (global.css) caps its height and the artwork scales inside. */}
          <Image
            src={event.homeArt}
            alt={event.title}
            sizes="(min-width: 640px) 384px, 100vw"
            priority
            className="block w-full aspect-[23/24] max-h-(--fit-night-art) sm:max-h-none object-contain"
          />
        </Link>
      )}

      <p
        className="my-3 sm:my-6 text-sm text-grey tracking-widest text-center"
        style={style}
        suppressHydrationWarning
      >
        {fmtNightLine(event)}
      </p>

      {holdsTicket ? (
        <HomeCta
          to="/tickets"
          pulse={false}
          style={style}
          onClick={() => trackEvent("home_your_tickets_click")}
        >
          {ticketsLabel}
        </HomeCta>
      ) : (
        <HomeCta
          to="/events/$eventId"
          params={{ eventId: event.id }}
          style={style}
          pulseDelay={pulseDelay}
          onClick={() => trackEvent("home_tickets_click")}
        >
          get_tickets_for_{name}
        </HomeCta>
      )}
    </>
  );
}

import { PageTitle, TerminalRow } from "@form-at/ui";

import { getDJ } from "@form-at/data/djs";
import { getEvent } from "@form-at/data/events";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { AddToCalendarButton } from "~/components/AddToCalendarButton";
import { Image } from "~/components/Image";
import { JsonLd } from "~/components/JsonLd";
import { PageLayout } from "~/components/PageLayout";
import { ShareButton } from "~/components/ShareButton";
import { TicketBlock } from "~/components/TicketBlock";
import { pageHead } from "~/utils/head";
import { eventLd } from "~/utils/jsonld";
import { eventShareTarget } from "~/utils/shareTarget";

export const Route = createFileRoute("/events/$eventId")({
  loader: async ({ params }) => {
    const event = getEvent(params.eventId);
    if (!event) throw notFound();
    const lineup = event.lineupIds.map((id) => getDJ(id)).filter(Boolean);
    return { event, lineup };
  },
  head: ({ loaderData }) => {
    const event = loaderData?.event;
    if (!event) return {};
    return pageHead({
      title: `${event.title} · ${event.date}`,
      description:
        event.description ?? `${event.title} on ${event.date} at ${event.venue}. ${event.audio}.`,
      path: `/events/${event.id}`,
      // Per-event banner generated at build by scripts/generate-og.ts
      // (flyer + title + date composition). Falls back to /og-image.png if missing.
      image: event.flyer ? `/og/events/${event.id}.jpg` : undefined,
    });
  },
  component: EventDetail,
});

function EventDetail() {
  const { event, lineup } = Route.useLoaderData();

  const metaRows: Array<[string, string]> = [
    ["date", event.date],
    ["venue", event.venue],
    ["time", event.runtime],
    ["audio", event.audio],
  ];

  return (
    <PageLayout>
      <JsonLd data={eventLd(event, lineup)} />
      <div className="flex-1">
        <Link
          to="/events"
          preload="intent"
          className="inline-flex items-center gap-2 text-sm sm:text-base text-grey hover:text-purple transition-colors mb-10"
        >
          ‹ events_archive
        </Link>

        {/* The title's row: the title, then the two bracket actions at the
            same weight. They wrap under a long title on a narrow screen. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 mb-5">
          <PageTitle className="text-3xl sm:text-4xl font-display font-bold leading-tight tracking-tight mb-0">
            {event.title}
          </PageTitle>
          <div className="flex items-baseline gap-4">
            <ShareButton target={() => eventShareTarget(event)} />
            {event.status === "upcoming" && <AddToCalendarButton event={event} />}
          </div>
        </div>

        <div className="space-y-1 mb-10">
          {metaRows.map(([label, value]) => (
            <TerminalRow key={label} label={label} value={value} />
          ))}
        </div>

        {/* Page order: facts, lineup, tickets, description, flyer last. The
            lineup sells the night, the buy block is what the page is for
            once it has, and the flyer is the poster a buyer scrolls down to. */}
        {lineup.length > 0 ? (
          <div className="mb-10">
            <PageTitle>lineup</PageTitle>
            <p className="text-sm sm:text-base text-grey leading-relaxed">
              {lineup.map((dj, i) => {
                if (!dj) return null;
                return (
                  <span key={dj.id}>
                    {i > 0 && <span className="text-grey/40 mx-2">/</span>}
                    <Link
                      to="/djs/$djId"
                      params={{ djId: dj.id }}
                      preload="intent"
                      className="hover:text-gold transition-colors"
                    >
                      {dj.name}
                    </Link>
                  </span>
                );
              })}
            </p>
          </div>
        ) : event.status === "upcoming" ? (
          <div className="mb-10">
            <PageTitle>lineup</PageTitle>
            <p className="text-sm sm:text-base text-grey leading-relaxed">
              lineup will be released soon !
            </p>
          </div>
        ) : null}

        {/* Hidden unless sales are on for this event; see TicketBlock. */}
        {event.status === "upcoming" && <TicketBlock eventId={event.id} />}

        {/* The event's intro: what the night is, or why a lineup might look
            partial (a co-organized event where some names have no Form:at DJ
            profile). */}
        {event.description && (
          <p className="text-sm sm:text-base text-grey leading-relaxed mb-10">
            {event.description}
          </p>
        )}
      </div>

      {event.flyer && (
        <Image
          src={event.flyer}
          alt={event.title}
          sizes="(min-width: 768px) 560px, 100vw"
          priority
          // Flyers vary in aspect ratio (square posters vs portrait designs),
          // so we let the image render at its natural ratio rather than
          // forcing a square crop. Brief CLS on load is the trade-off; on a
          // detail page with a single hero image, it's acceptable.
          className="w-full max-w-2xl h-auto mb-10 mx-auto rounded-card"
        />
      )}
    </PageLayout>
  );
}

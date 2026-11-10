import type { MusicSet } from "./sets";

// The event calendar — a plain, hand-maintained array (TECH_DEBT.md item 24:
// events have no D1 table, no admin UI; a new event still needs a code edit +
// deploy). Lives in this shared package, not apps/web, ONLY so apps/admin can
// read `{id, title}` pairs for the event_id dropdown in
// UploadSetForm/EditSetForm — a set's `eventId` (packages/data/src/sets.ts)
// is a foreign key into this array's `id`s. That's a plumbing move, not the
// item-24 migration: there's still no way to add or edit an event without a
// deploy.
export type Event = {
  id: string;
  title: string;
  date: string; // ISO: "2026-02-06"
  venue: string;
  // Short, display-safe location — "Glasgow", "Edinburgh". Separate from
  // `venue` (a full free-text address/description, e.g. "Seafield road beach
  // spot, Edinburgh") because compact contexts (a set card, a share text)
  // need something that never truncates badly, and this is the single place
  // it's typed — a set never carries its own city; it reads this one via
  // `eventId` (see `getCityForSet` below). One string, not two independently
  // hand-typed ones that can drift apart.
  city: string;
  lineupIds: string[]; // DJ ids, headline first
  audio: string;
  runtime: string;
  status: "upcoming" | "past";
  flyer?: string;
  // The image the home page shows while this night's tickets are on sale:
  // the flyer's artwork alone on a transparent background, so it sits on the
  // page's black. Same base-path shape as `flyer`. Without one the home shows
  // the night's line and button with no image.
  homeArt?: string;
  // Optional free-text intro, same shape/purpose as MusicSet's `description?`
  // (sets.ts). Shown as the event page's intro paragraph and used as its meta
  // description; without one, $eventId.tsx builds the meta description from
  // the structured fields. Use it for context a visitor can't get from those
  // fields alone — what the night is, or a co-organized event where some
  // lineup names have no Form:at DJ profile.
  description?: string;
};

export const events: Event[] = [
  {
    id: "format-004",
    title: "Form:at 004",
    date: "2026-12-05",
    venue: "Stereo, City Centre, Glasgow",
    city: "Glasgow",
    lineupIds: ["dzeko", "julz-lever", "hubey"],
    audio: "techno / electro / dub",
    runtime: "23:00 — 04:00",
    status: "upcoming",
    flyer: "events/004",
    homeArt: "events/004-home",
    description:
      "sequence 004: our first saturday, our first night at stereo, on renfield lane. dzeko flies in from barcelona for his scottish debut, vinyl only. he closed marcel dettmann's five-hour night at razzmatazz and co-founded matriz in granada. residents julz lever and hubey complete the transmission. techno, electro and dub from 23:00 to 04:00.",
  },
  {
    id: "format-003",
    title: "Form:at 003",
    date: "2026-08-28",
    venue: "Southside, Glasgow",
    city: "Glasgow",
    lineupIds: ["unreal", "iona-violet", "julz-lever", "til"],
    audio: "techno / electro / dub",
    runtime: "23:00 — 05:00",
    status: "past",
    flyer: "events/003",
  },
  {
    id: "seafield-sound",
    title: "Seafield Sound",
    date: "2026-07-24",
    venue: "Seafield road beach spot, Edinburgh",
    city: "Edinburgh",
    lineupIds: ["julz-lever", "hubey", "til", "angel-negrin", "rushford", "dimebug", "3sr"],
    audio: "electro / house / techno",
    runtime: "20:30 — very late",
    status: "past",
    flyer: "events/seafield-sound",
    description:
      "a joint transmission — form:at is one node in this crew, not the sole operator. on the sand at seafield road; if weather breaks, a covered plan b stands 100m inland. this year's rig hits harder than last year's.",
  },
  {
    id: "format-002",
    title: "Form:at 002",
    date: "2026-04-24",
    venue: "Southside, Glasgow",
    city: "Glasgow",
    lineupIds: ["brandon-lee-vear", "julz-lever", "hubey", "til"],
    audio: "techno / electro / dub",
    runtime: "23:00 — 05:00",
    status: "past",
    flyer: "events/002",
  },
  {
    id: "format-001",
    title: "Form:at 001",
    date: "2026-02-06",
    venue: "Southside, Glasgow",
    city: "Glasgow",
    lineupIds: ["angel-negrin", "julz-lever", "hubey"],
    audio: "techno / electro / dub",
    runtime: "23:00 — 05:00",
    status: "past",
    flyer: "events/001",
  },
];

export function getEvent(id: string): Event | undefined {
  return events.find((e) => e.id === id);
}

export function getUpcomingEvents(): Event[] {
  return events.filter((e) => e.status === "upcoming");
}

export function getPastEvents(): Event[] {
  return events.filter((e) => e.status === "past");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The night still to come, soonest first: an `upcoming` event whose night
 * hasn't ended at `now`. A night runs past midnight, so it counts until noon
 * UTC on the day after its `date`. Reading the date as well as `status` is
 * what lets a caller stop pointing at a night once it has happened, before
 * anyone flips its `status` to `past`.
 */
export function getNextEvent(now: Date, from: Event[] = events): Event | undefined {
  return from
    .filter((e) => e.status === "upcoming" && now.getTime() < nightEnd(e.date))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

/** Noon UTC on the day after an event's `YYYY-MM-DD` date, in ms. */
function nightEnd(date: string): number {
  return Date.parse(`${date}T12:00:00Z`) + DAY_MS;
}

// The one place a set's display city is resolved — every compact-render
// call site (SetCard, ShareModal, $setId.tsx's meta fallback) goes through
// this rather than reading a city off the set itself, because sets don't
// carry one: `MusicSet.venue` (packages/data/src/sets.ts) is free text,
// already caught disagreeing with its own event's `venue` on real data
// (2026-09, "Find the red door, Glasgow" vs "Southside, Glasgow"), and is no
// longer read anywhere. `eventId` is nullable (a set with no event — a
// future studio mix) — undefined here is that case, and every caller drops
// the location segment cleanly rather than showing an empty one.
export function getCityForSet(set: MusicSet): string | undefined {
  return set.eventId ? getEvent(set.eventId)?.city : undefined;
}

// The venue's own name, for compact labels: everything before the first
// comma of `venue` ("Stereo, Renfield Lane, City Centre, Glasgow" → "Stereo").
export function getVenueName(event: Event): string {
  return event.venue.split(",")[0]?.trim() || event.venue;
}

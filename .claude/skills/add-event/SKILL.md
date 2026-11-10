---
name: add-event
description: Add or update a form:at night in packages/data/src/events.ts — the entry, its flyer, the admin sample data, and flipping it to past afterwards. Use when announcing an event, filling in its lineup or description, or after the night.
---

# Add an event

How form:at 004 was added (commits `959ffb9`, `46f37ed`, `b4e31d3`).

## 1. The entry

Add it to `packages/data/src/events.ts`, following the `Event` type and the
neighbouring entries:

| Field | Value |
|---|---|
| `id` | `format-00N` |
| `title` | `Form:at 00N` |
| `date` | ISO |
| `venue` | the full venue text |
| `city` | short and display-safe, e.g. "Glasgow" |
| `lineupIds` | DJ ids, headline first; `[]` until announced |
| `audio` | the genres line |
| `runtime` | e.g. `"23:00 — tbc"` |
| `status` | `"upcoming"` |

`runtime` stays start-only until the closing time is booked. An unparseable end
puts no end time on calendars or in the JSON-LD, where a guessed one would land
in people's calendars.

`description` is optional and becomes the event page's intro and meta
description. Use it for what the structured fields can't say.

## 2. What follows automatically

**The admin trend marker:** `apps/admin/app/utils/milestones.ts` maps every
event in `events.ts`, so nothing to edit there. `milestones.test.ts` compares
against `events` itself and needs no change either.

## 3. Manual pieces

- **Sample data:** `apps/admin/app/data/sample-stats.ts` has a hand-written
  milestone per event for the dev dashboard. Add or rename the matching line, and
  update `admin-stats.test.ts` if it asserts on it.
- **Flyer** (optional `flyer`): the original goes in
  `apps/web/images-source/events/<name>.jpg` and the entry gets
  `flyer: "events/<name>"`, like 001–003. Ask first, then
  `pnpm --filter @form-at/web optimize-images`. Commit only the generated
  `apps/web/public/images/events/<name>-…` variants.
- **Home art** (optional `homeArt`): the image the home page shows while the
  night's tickets are on sale. It is the flyer's artwork alone on a
  transparent background (a PNG with alpha), at least 1080px wide, saved as
  `apps/web/images-source/events/<name>-home.png`, with
  `homeArt: "events/<name>-home"` on the entry and the same
  `optimize-images` run. 004's was cut from the poster by keeping each pixel
  as opaque as it is gold (red minus blue), which drops a purple and black
  background; another poster needs its own cut. Without `homeArt` the home
  shows the night's line and button with no image.
- **Lineup:** new DJs go through `/add-dj` first.

## 4. After the night

Set `status: "past"`. The DJ page's next row and the event page read it. The
home page doesn't wait for this: `getNextEvent` stops returning a night at
noon UTC on the day after its date.

## 5. Check and show

- `pnpm check`, `pnpm test`.
- Screenshots at 375px of the events list and the event page (`/visual-review`).

---
paths:
  - "packages/data/**"
  - "apps/web/schema.sql"
  - "apps/*/scripts/**"
  - "apps/rum-archiver/**"
  - "apps/web/app/data/tickets.ts"
  - "apps/web/app/data/ticketEmail.ts"
  - "apps/web/app/routes/api/stripe-webhook.ts"
  - "apps/web/app/routes/tickets/**"
  - "apps/web/app/components/TicketBlock.tsx"
  - "apps/web/app/components/tickets/**"
---

# Data: D1, R2, the catalogue, peaks, push

## Never apply `schema.sql` with `--file` against a database that already exists

It holds **10 `ALTER TABLE`s that are not idempotent** — re-running them fails
with a duplicate-column error. `ADD COLUMN IF NOT EXISTS` is not an option: D1
rejects it (`near "EXISTS": syntax error … SQLITE_ERROR`), unlike vanilla SQLite
≥3.35. `schema.sql` is the reference definition and what a *fresh* database needs
once. Migrate an existing database one statement at a time and verify:

```bash
npx wrangler d1 execute form-at-analytics --remote --command "ALTER TABLE plays ADD COLUMN <col> <type>"
npx wrangler d1 execute form-at-analytics --remote --command "PRAGMA table_info(plays)"
```

`schema.sql`'s own comments record which statements are already applied to
production. Read them before running anything. These are Cloudflare writes: print
them for the repo owner to run (`/d1-migration`), don't run them.

## Never overwrite an object under `sets/{id}/{version}/` in R2

Every upload writes to its own version folder (`packages/data/src/r2Keys.ts`),
and the CDN caches those paths for a year (README → *"CDN rules for
cdn.formatglasgow.com"*). Overwrite one and the old bytes keep being served from
the edge and browsers for a year, and a saved offline copy never notices, because
its URL didn't change: TECH_DEBT.md item 31. To replace a set's files, upload a
new version and point the row at it. Any script that writes to R2 builds its keys
with `versionedSetKey`, never by hand.

## Keep `WIDTHS` in step

`WIDTHS` in `apps/web/scripts/optimize-images.ts` ↔ `apps/web/app/components/Image.tsx`.
They're `[640, 1080]`. Add a width to one only and the srcset requests variants
that were never generated.

## Map

| Area | Edit here | Why it's built this way |
|---|---|---|
| Catalogue | `packages/data/src/sets.ts` (+ `sets.generated.ts`, `apps/web/app/data/sets.ts` for the app's fallback wrapping) | README → *"The catalogue is in a database, but the app is offline-first"* (live-wins `mergeSets`, committed snapshot). CI's `sets-snapshot` job fails when the committed snapshot drifts from live D1. |
| Waveform peaks | `apps/web/scripts/generate-peaks.ts` (`pnpm -C apps/web peaks`, needs `ffmpeg` on PATH) writes both files: `peaks.json` (player) and `peaks-fine.bin` (Story picker; format in `packages/data/src/finePeaks.ts`). Existing sets: `backfill-fine-peaks` | README → *"Waveform peaks are computed with ffmpeg, not in the browser"*. Keep the coarse file at 8kHz (higher, it no longer matches the published ones) and the fine one at 48000 Hz, the sets' own rate and the usual phone `AudioContext` rate (any other rate resamples and drifts from the picker's own decode). The backfill only prints its R2/D1 commands (Cloudflare writes are the owner's). |
| Push sending | `packages/data/src/webPush.ts` | README → *"The standard Web Push library doesn't run on Workers"* |
| RUM archive | `apps/rum-archiver/src/index.ts`, query + upsert in `packages/data/src/rumArchive.ts` | Cloudflare degrades beacon data after 7 days, so a cron captures it first. Pages cannot run cron — hence a standalone Worker. Never remove the upsert's `sample_interval` guard: it stops a late run overwriting exact rows. |
| Tickets | Tables at the end of `apps/web/schema.sql`; queries in `packages/data/src/tickets.ts`; QR token in `packages/data/src/ticketToken.ts`; Stripe Checkout and webhook signature in `packages/data/src/stripe.ts` (plain `fetch`, no SDK); buyer side in `apps/web/app/data/tickets.ts`, `routes/api/stripe-webhook.ts` and `routes/tickets/`; the ticket email (Resend, plain `fetch`) in `apps/web/app/data/ticketEmail.ts`; tests on real SQLite via `packages/data/tests/helpers/sqliteD1.ts` | `docs/adr/2026-11-08-*.md`. Capacity is counted from `ticket_orders`: never add `sold`/`reserved` counters. An order holds `quantity` seats (1 to `MAX_TICKETS_PER_ORDER`), so every seat count is a `SUM(quantity)`, never a `COUNT(*)` of orders; `tickets` has one row per seat (`UNIQUE (order_id, seq)`). Every state change stays one conditional statement (or one `batch`): a read followed by a write lets two requests take the last seat or confirm twice. Only the verified Stripe webhook marks an order paid. Sales show only where `DB`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `TICKET_SIGNING_SECRET` are all set (`salesConfig` in `apps/web/app/data/tickets.ts`), which is what keeps test keys on the Preview environment off the public site. Unpaid holds are capped per HMAC'd IP (`MAX_LIVE_HOLDS_PER_IP`) inside `reserveSeat`'s own WHERE. A ticket token is verified (`verifyTicketToken`) before any D1 read, on the web page and at the door. The email is sent only when `confirmOrder` returned ids, so a replayed webhook sends nothing; a failed send never fails the webhook and is recorded in `ticket_email_sends` (`sent = 0`). "Recover my tickets" answers the same for a matched and an unmatched email and counts every attempt per HMAC'd IP in the same table. `TicketQr` (`uqr`) and `Celebration` (the success page's confetti) stay `lazy()`: no ticket code in the main bundle. |

`apps/web/scripts/README.md` documents every script in that folder; adding one
without listing it makes that README's own framing false.

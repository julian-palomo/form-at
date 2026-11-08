# apps/web

The public site and audio player — [formatglasgow.com](https://formatglasgow.com).
A PWA: installable, and a saved set plays with no signal.

Framework is TanStack Start v1 on the Cloudflare Workers runtime. The engineering
narrative — why IndexedDB over Cache Storage, why the service worker is
hand-written, why the catalogue is both a D1 table and a committed snapshot —
lives in the [root README](../../README.md) and isn't repeated here.

```bash
pnpm dev:web      # :5173
pnpm test:web     # unit (Vitest, jsdom; real-SQLite tests under node)
pnpm -C apps/web test:e2e
```

**Service-worker behaviour only exists in a production build.** The dev server
never registers one, because Vite's dev transform emits no `sw.js`. For anything
touching install, offline, offline audio or Range seeking:

```bash
pnpm build:web && pnpm start:web   # :4173, real service worker
```

## Layout

| Path | |
|---|---|
| `app/routes/` | file-based routes; `api/` holds pure endpoints (no component) |
| `app/components/` | app-coupled components — anything tied to Zustand, the router, or this app's asset-URL scheme. Generic presentational pieces live in `packages/ui` |
| `app/hooks/` | `useAudioPlayer` owns all playback logic; `Player.tsx` is layout only |
| `app/store/` | Zustand slices, composed in `index.ts` |
| `app/data/` | catalogue, DJs, events, offline-audio IDB access, ticket-sales server functions (`tickets.ts`) |
| `app/sw.ts` | the service worker, built by `buildServiceWorker` in `vite.config.ts` |
| `schema.sql` | D1 schema for the whole project, including tables only `apps/admin` and `apps/rum-archiver` read. **Never apply it with `--file`** — it holds non-idempotent `ALTER`s |

## Ticket sales

The buy block on an event page (`components/TicketBlock.tsx`) starts a Stripe
Checkout; Stripe returns the buyer to `/tickets/success`, and
`/api/stripe-webhook` is the only place an order becomes paid. Sales are on
only where the Pages environment has the D1 binding and all of these secrets,
so test keys belong in the Preview environment and Production shows no block
until live keys are set there. `main` only deploys to Production; the manual
**Deploy web preview** workflow (`.github/workflows/preview.yml`) deploys any
branch to the `staging` branch alias, which runs in Preview:

| Secret | |
|---|---|
| `STRIPE_SECRET_KEY` | creates Checkout Sessions |
| `STRIPE_WEBHOOK_SECRET` | verifies the webhook's `Stripe-Signature` |
| `TICKET_SIGNING_SECRET` | HMACs buyer IPs for the hold limit and signs ticket tokens; at least 32 characters, never rotated while tickets are valid |

The Stripe webhook endpoint listens for `checkout.session.completed` and
`checkout.session.expired`. Seat counting and the reasons behind it:
[`docs/adr/`](../../docs/adr/).

Sub-directory docs: [`scripts/`](scripts/README.md) for every build and ops
script, [`tests/`](tests/README.md) for test conventions,
[`images-source/`](images-source/README.md) for the image pipeline.

## Things that break quietly

These have each cost a debugging session; the full list is in
[`CLAUDE.md`](../../CLAUDE.md) §1, and the reasoning for each in the
[`.claude/rules/`](../../.claude/rules/) file it names.

- **Never add `self.skipWaiting()` to `app/sw.ts`.** It prunes the previous
  build's chunks while old clients are still running them, so the next lazy
  route-load 404s.
- **Never rebuild the `Request` in the SW's audio route.** It silently drops the
  `Range` header, so seeks re-download from byte 0. No unit test can catch it —
  Node's undici doesn't implement the guard that causes it.
- **Never remove the `@source` directive** from `app/styles/global.css`, or
  Tailwind strips every class used only inside `packages/ui`.

---
paths:
  - "apps/web/app/sw.ts"
  - "apps/web/app/store/offlineSlice.ts"
  - "apps/web/app/store/catalogueSlice.ts"
  - "apps/web/app/data/offline-audio.ts"
  - "apps/web/app/components/OfflineReconciler.tsx"
  - "apps/web/app/components/CatalogueSync.tsx"
  - "apps/web/vite.config.ts"
---

# Offline audio and the service worker

Why it's built this way: README → *"220MB of audio has to survive with no signal"*
(IDB over Cache Storage, quota pre-flight, Range). Edit in
`apps/web/app/data/offline-audio.ts`, `store/offlineSlice.ts` and the audio route
in `app/sw.ts`.

## Never gate the offline-set purge on `catalogueReady` — it must be `catalogueConfirmed`

**The only thing in this repo that can silently destroy user data.**
`reconcileFromIdb` (`apps/web/app/store/offlineSlice.ts`) purges a downloaded set
— 100–220MB the user chose to save — when its id isn't in the catalogue. The two
flags are not interchangeable (`apps/web/app/store/catalogueSlice.ts`):

- `catalogueReady` — the boot fetch **settled**: succeeded, failed, *or* timed out.
- `catalogueConfirmed` — the boot fetch **succeeded**.

Gate the membership purge on `catalogueReady` and a single failed fetch reads as
"the catalogue no longer lists any of your sets", and every saved set is deleted.
`catalogueReady` gates only `reconcileFromIdb`'s cheap first pass; the
membership purge in its second pass checks `catalogueConfirmed`
separately. **Never collapse the two flags into one**, and never let a
"simplification" route the purge through the wrong one. It took two review
rounds to get right and there is no test that fails loudly if you merge them —
the damage happens on a user's device, offline.

## Never add `self.skipWaiting()` to `apps/web/app/sw.ts`

An immediately-activating service worker prunes the previous build's hashed
chunks from the precache **while old clients are still running them**, so the
next lazy route-load in an open session 404s — Cloudflare Pages only serves the
latest deployment. A broken route, not a stale cache. New builds are meant to sit
in `waiting` and take over on the next cold start.

## Never rebuild the `Request` in `sw.ts`'s audio route — always forward the original

Two independent breakages. `new Request(url, {...})` defaults `mode` to `cors`,
which makes the browser block R2's response to `<audio>`'s natively no-cors
request. And even a rebuild that copies `mode` explicitly **silently drops the
`Range` header**, because a `Headers` object under the Fetch spec's
request-no-cors guard discards anything not no-CORS-safelisted — so seeks return
200 full-body instead of 206 and re-download 100MB+ from byte 0. Node's undici
doesn't implement that guard, so **no unit test can catch this**; it only appears
in a real browser.

## Ticket pages and ticket data never come from a cache

`sw.ts`'s navigation route skips `/tickets/`, and every ticket server function in
`apps/web/app/data/tickets.ts` is POST (the `_serverFn` cache only takes GETs).
A cached "confirming…" on the page Stripe returns a buyer to would never turn
into "you're in", and a cached price or "sold out" would be wrong. Keep new
ticket pages under `/tickets/` and new ticket server functions POST.

## Service worker build

`buildServiceWorker` in `apps/web/vite.config.ts` owns the precache allowlist and
revision derivation (README → *"Technology choices"*, Workbox entry).
`vite-plugin-pwa` is **not** a dependency.

The Story picker and remux chunks are excluded from the precache **by filename**
in `vite.config.ts`'s `shouldPrecache`: renaming either module silently
precaches it again.

Service-worker behaviour is testable only against a production build
(`pnpm build:web && pnpm start:web`, :4173). The dev server registers no SW.

---
paths:
  - "apps/web/app/server.ts"
  - "apps/web/app/router.tsx"
  - "apps/web/app/routes/**"
  - "apps/web/app/store/**"
  - "apps/web/app/hooks/**"
  - "apps/web/app/utils/rootHead.ts"
  - "apps/web/app/utils/appContext.ts"
  - "apps/web/app/components/SwipeNavigator.tsx"
  - "apps/web/app/components/player/**"
  - "apps/web/public/_headers"
  - "apps/admin/app/server.ts"
---

# The web app: server entry, player, navigation, store

## Never delete `apps/web/app/server.ts` or `apps/admin/app/server.ts`

These custom entries handle Cloudflare's `fetch(request, env, ctx)` convention
and forward `env.DB` as `context.cloudflare.env`. **Without them D1 is
unreachable from every piece of server-side code** — both `server.handlers`
routes and `createServerFn` handlers. They look like boilerplate a framework
should own. It doesn't.

## Map

| Area | Edit here | Why it's built this way |
|---|---|---|
| Audio player | `apps/web/app/hooks/useAudioPlayer.ts` (all playback logic; `Player.tsx` is layout only) | Sets must play on locked screens — Media Session API. Persistent bar in `__root.tsx` survives route changes. |
| Web/app divide | `apps/web/app/utils/appContext.ts` — the `?ctx=app` marker | README → *"Browser tabs never read the offline library"*. A product invariant, not an accident: don't make tabs read IDB. |
| Navigation | `apps/web/app/components/SwipeNavigator.tsx` — wraps `<Outlet />`, swipes across `ROUTES = ["/", "/sets", "/events", "/djs"]` | Outgoing page animates via a `cloneNode` snapshot + direct DOM writes; the gold dot indicator likewise. Deliberately not React re-renders. |
| Analytics | `apps/web/app/routes/api/signal.ts`, `hooks/useTrackEvent.ts` | `navigator.sendBeacon` on pause, track change and tab close; plays under 3s ignored. Lands in D1 `plays`. |
| Web Analytics beacon | `apps/web/app/utils/rootHead.ts`, tag in `packages/data/src/webAnalytics.ts` | **We inject it ourselves** — Cloudflare's automatic edge injection worked, then silently stopped. That file's header has the evidence and why manual is also the more precise option. Its host must stay allowlisted in the CSP in BOTH `apps/web/app/server.ts` and `public/_headers`. |
| Server entry | `apps/web/app/server.ts`, `apps/admin/app/server.ts` | Forwards `env.DB` as `context.cloudflare.env`; web's also passes `context.request` (`cf-connecting-ip` and the origin) for ticket checkout. See above. |

## Store slice map — `apps/web/app/store/`

Zustand, composed in `index.ts`:

| Slice | Owns |
|---|---|
| `playerSlice` | playback state, per-track resume `positions`, `peaksCache`, `durations`, `hasError`/`playbackBlockedReason`, and the offline playback gate (`canFetchPlaybackBytes`, `wasServedFromIdb`) |
| `offlineSlice` | downloads, `activeDownloadId`, IDB-backed saved-set state, failure classification |
| `catalogueSlice` | live catalogue fetched over the static snapshot |
| `uiSlice` | transient UI state |
| `ticketsSlice` | the tickets this device holds, by signed token (plain strings and numbers; the event is looked up from `getEvent` at render time); what `/tickets` draws offline. Also `celebratedOrders`, the checkout sessions whose confetti has played on this device |

`index.ts` persists a `partialize`d subset to localStorage: `nowPlayingId`,
`positions`, `peaksCache`, `durations`, PWA install booleans, `tickets`,
`celebratedOrders`. **Never persist
`MusicSet` objects** — only IDs, rehydrated via
`getCatalogueSet(catalogueSets, id) ?? getSet(id)`. A persisted object is a
migration hazard the moment the shape changes; an ID isn't. `deferredPrompt` is
excluded deliberately — non-serializable event object.

`isPlaying` is the control surface for external components; `useAudioPlayer`
bridges it to `audio.play()`/`audio.pause()`.

## API route shape

TanStack Start has no `createAPIFileRoute` as of the version pinned in
`pnpm-lock.yaml` (1.167 at the time of writing — check there, not here, if the
API looks different). Use `createFileRoute` with a `server: { handlers }` option:

```ts
export const Route = createFileRoute("/api/example")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        // context.cloudflare?.env?.DB is available here
        return new Response(null, { status: 204 });
      },
    },
  },
});
```

A route with only `server.handlers` and no `component` is a pure endpoint — the
router never tries to render it. Use `createServerFn` for data fetching from
client code, never a raw `fetch` to an internal API route.

/// <reference lib="webworker" />

// Form:at service worker: precaches the app shell, serves saved audio from IDB,
// replays queued analytics beacons, and handles push.
//
// No PWA framework builds this — `vite-plugin-pwa` is not a dependency, only
// the `workbox-*` runtime libraries are. The `buildServiceWorker` plugin in
// `apps/web/vite.config.ts` esbuilds this file to `dist/client/sw.js` as an
// iife and substitutes `self.__WB_MANIFEST` via esbuild `define`. That plugin
// owns which files are precached (an explicit allowlist) and how each entry's
// revision is derived — read it there rather than assuming glob semantics.
//
// Types come from `ServiceWorkerGlobalScope` via `lib: ["WebWorker"]` in
// `tsconfig.sw.json`. `Window` types are intentionally absent, so DOM access
// fails at typecheck rather than at runtime.

import { AUDIO_HOST } from "@form-at/data/sets";
import type { PushPayload } from "@form-at/data/webPush";
import { clientsClaim } from "workbox-core";
import { matchPrecache, precacheAndRoute } from "workbox-precaching";
import { createPartialResponse } from "workbox-range-requests";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import { SYNC_TAG, replaySignalQueue } from "~/data/beacon-queue";
import { getOfflineAudio } from "~/data/offline-audio";
import { stripAppContext } from "~/utils/appContext";
import { buildNotificationOptions, resolveNotificationClickUrl } from "~/utils/pushNotification";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

// Take control of open clients when this SW activates. This STAYS: on first
// install there is no previous worker and no old client running hashed chunks,
// so claiming immediately is safe — it's what makes offline capability live
// without a reload on the very first visit. For an update it's inert by
// construction: a waiting worker only activates once every client of the old
// worker is gone, so there is nothing stale left to claim by then.
clientsClaim();

// NO `self.skipWaiting()` anywhere — never add one, and never add a message
// handler that calls it on the page's behalf. An immediately-activating SW
// prunes the previous build's hashed chunks from the precache while old
// clients are still running them, and the old client's next lazy route-load
// then 404s, because Cloudflare Pages serves only the latest deployment. A
// broken route, not merely a stale cache.
//
// A new build sits in `waiting` and takes over on the next cold start — the
// lifecycle's own default. There is deliberately no update prompt and no
// forced reload: a reload mid-playback cuts off a 90-minute set, and that is
// the failure this design exists to prevent. Accepted cost: a client left
// open indefinitely keeps running the old version, and a plain reload does
// NOT dislodge it (the document overlap means the registration never drops to
// zero clients) — fully closing the app, or a desktop hard reload, is what
// activates the new build. See PWA_PROGRESS.md's "SW update flow" section.

// Precache everything the build tags into the manifest (HTML, JS, CSS,
// fonts, the icons referenced by the manifest). Workbox handles cache
// versioning by URL revision — old entries are pruned on activate, so we
// don't leak storage across builds.
precacheAndRoute(self.__WB_MANIFEST);

// Navigation requests (SSR'd HTML): serve from cache instantly, revalidate
// in the background. Form:at's content is stable enough that "one visit
// behind" on a new set is fine, and instant loads beat fresh-on-every-nav.
// SSR semantics are preserved — these are still server-rendered docs, just
// possibly from one visit ago. Cache populates per-URL on first online visit.
//
// `/tickets/` is left to the network: the page Stripe returns a buyer to
// shows their order's live status, and a cached "confirming…" would never
// turn into "you're in".
registerRoute(
  ({ request, url }) => request.mode === "navigate" && !url.pathname.startsWith("/tickets/"),
  new StaleWhileRevalidate({ cacheName: "pages-v1" }),
);

// Artwork: same-origin `/images/*` — serve from cache instantly, revalidate
// in the background. Artwork URLs aren't content-hashed (`sets/002-1080.avif`
// stays stable across deploys even if we re-export), so SWR lets us pick up
// new exports on the next visit without breaking offline access in the
// meantime. Cache `artwork-v1` survives deploys — artwork rarely changes and
// a stale-for-one-visit image is fine, none of the JS-version-coupling that
// motivated `pages-v1`'s activate-clear applies here.
//
// Bounds: deliberately unbounded — see TECH_DEBT.md item 8. Worst case is
// ~40MB (50 sets × 4 variants × ~200KB), well within per-origin quota.
// Browser pruning under storage pressure is acceptable until observed.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/images/"),
  new StaleWhileRevalidate({ cacheName: "artwork-v1" }),
);

// TanStack Start server-function calls (`/_serverFn/*`): SWR so previously-
// visited route loader data survives offline. Without this, client-side
// click-nav offline rejects the loader (`fetch` fails with
// `ERR_INTERNET_DISCONNECTED`) and the route hits the error boundary —
// even though direct reloads work fine via `pages-v1`.
//
// GET only: caching a POST response would be incorrect (mutation semantics) and
// Workbox refuses non-GET by default anyway. Offline `/api/signal` POSTs are
// handled by the beacon queue instead (TECH_DEBT 4, `~/data/beacon-queue.ts`).
//
// NOT cleared on activate, opposite of `pages-v1`: cached HTML can reference
// purged hashed JS chunks, which is a hydration risk, but `_serverFn` data is
// small JSON with no asset coupling. Wiping it every deploy would erase offline
// access to recently-visited pages, and URLs carry build hashes so stale
// entries go inert on their own. Same reasoning as `audio-v1`/`artwork-v1`:
// stable URL → don't clear.
registerRoute(
  ({ url, request }) => request.method === "GET" && url.pathname.startsWith("/_serverFn/"),
  new StaleWhileRevalidate({ cacheName: "route-data-v1" }),
);

// Audio: cross-origin R2 MP3 + peaks JSON — read-only from IDB (`audio-v1`
// database). Pass through to network on miss; the download flow in
// `offlineSlice.startDownload` is the only writer. Auto-caching is
// deliberately absent — `save_for_offline` must be an explicit user action,
// not a playback side effect.
//
// IDB rather than Cache Storage — see `~/data/offline-audio.ts` for why. The
// synthetic Response built below satisfies the same Range-slicing contract
// regardless of storage location.
//
// Range handling: `<audio>` issues `Range: bytes=N-` for seek and for
// incremental playback. Only call `createPartialResponse` when a Range header is
// actually present — without one it throws, and the catch returns a misleading
// 416.
//
// === Tab vs app display-mode gate ===
// The page tags playback URLs with `?ctx=app` via `withAppContext` ONLY in
// standalone display-mode, and that marker is the SW's single source of truth
// for "is the requester a standalone PWA?":
//   - missing marker (browser tab) → pure pass-through, never reads IDB. A
//     downloaded set in a tab still streams from R2.
//   - `ctx=app` (standalone) → read IDB, fall through to network on miss.
// The marker is stripped ONLY for the IDB key (`stripAppContext`) so the lookup
// matches the bare URL the download flow stored.
//
// === Network pass-through: ALWAYS `fetch(request)`, never a rebuilt Request ===
// Both pass-through paths (tab, and standalone IDB-miss) must forward the
// ORIGINAL request object. Rebuilding it breaks playback two separate ways:
//   1. `new Request(url, { method, headers })` defaults `mode` to "cors",
//      flipping `<audio>`'s native no-cors so the browser blocks R2 MP3
//      responses. Forwarding `request` preserves mode/credentials/redirect by
//      construction.
//   2. Even a rebuild that copies mode explicitly LOSES the `Range` header: per
//      the Fetch spec a Headers object under the "request-no-cors" guard
//      silently drops anything not no-CORS-safelisted, and Range isn't. Seeks
//      then get a 200 full-body instead of 206, re-downloading 100MB+ sets from
//      byte 0. Node's undici doesn't implement the guard, so this is only
//      observable in a real browser — see PWA_PROGRESS.md's 206-on-seek check.
// The `?ctx=app` marker does reach R2 on the standalone IDB-miss path. That's
// harmless (R2 resolves by path; Range GETs still return 206) and costs only a
// duplicate browser-cache entry keyed separately from the bare tab URL.
//
// === Cached-Response contract ===
// The synthetic Response built here MUST have these five properties or Range
// slicing breaks silently:
//   status:         200  (NOT 206 — slicing a partial response would fail)
//   body:           full blob from IDB
//   Content-Type:   from `entry.contentType` ("audio/mpeg" / "application/json")
//   Content-Length: String(entry.bytesTotal)  (explicit, not the upstream header)
//   Accept-Ranges:  "bytes"
registerRoute(
  ({ url }) =>
    url.hostname === AUDIO_HOST &&
    (url.pathname.endsWith(".mp3") || url.pathname.endsWith(".json")),
  async ({ request, url }) => {
    const { ctxIsApp, bareUrl } = stripAppContext(url);

    // Tab semantics: pure pass-through, no IDB read even if an entry exists.
    // The URL carries no marker in a tab, so `request` already IS the bare
    // canonical request — see the pass-through block comment above for why
    // it must be forwarded unmodified.
    if (!ctxIsApp) return fetch(request);

    const entry = await getOfflineAudio(bareUrl);
    if (!entry) return fetch(request);
    const cached = new Response(entry.blob, {
      status: 200,
      headers: {
        "Content-Type": entry.contentType,
        "Content-Length": String(entry.bytesTotal),
        "Accept-Ranges": "bytes",
      },
    });
    if (!request.headers.has("range")) return cached;
    return createPartialResponse(request, cached);
  },
);

// Cross-deploy safety: clear the navigation cache on activate so we never
// serve cached HTML referencing hashed JS chunks the new deploy no longer
// ships. Without this, the first post-deploy visit would fetch JS 404s and
// fail to hydrate. The precache itself is versioned by Workbox so only
// `pages-v1` needs explicit clearing.
//
// Also deletes a stray Cache Storage cache named `audio-v1` — unrelated to the
// IDB database of the same name. An earlier build used it for the audio
// read-path before storage moved to IDB, so it lingers empty on those devices:
// harmless, but confusing in DevTools. Don't drop this delete as pointless.
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([caches.delete("pages-v1"), caches.delete("audio-v1")]));
});

// Background Sync replay for `/api/signal` beacons that failed to send offline
// (queued from `useAudioPlayer.ts`'s `sendPlay`) — TECH_DEBT 4.
// `replaySignalQueue` in `~/data/beacon-queue.ts` owns the replay logic and is
// pure and unit-tested; this is only the event wiring, same split as
// `push`/`notificationclick` above.
//
// TypeScript's bundled WebWorker lib doesn't define `SyncEvent` or a `"sync"`
// entry in `ServiceWorkerGlobalScopeEventMap` at all, so `addEventListener`
// falls through to its generic
// `(type: string, listener: EventListenerOrEventListenerObject)` overload and
// `event` below is typed as plain `Event` without the cast. The shape is what
// MDN documents: `tag` (which registration this is) and `lastChance` (true if
// the UA won't retry after this attempt),
// extending `ExtendableEvent` for `waitUntil()`.
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
  readonly lastChance: boolean;
}

self.addEventListener("sync", (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag === SYNC_TAG) syncEvent.waitUntil(replaySignalQueue());
});

// Push notifications: receive + click-to-open.
//
// Payload shape is whatever `webPush.ts`'s `PushPayload` sends. MUST NOT
// throw: `event.data` is legitimately `null` for an empty push per spec, and
// `.json()` itself throws on non-JSON bodies — optional chaining alone only
// guards the null case, so this wraps the whole read in try/catch and falls
// back to a generic notification rather than dropping the push silently.
// `buildNotificationOptions` (pure, unit-tested — see
// `~/utils/pushNotification.ts`) owns everything payload-shaped; `tag` stays
// here because it's receipt-time state, not derivable from the payload.
self.addEventListener("push", (event) => {
  let payload: Partial<PushPayload> = {};
  try {
    payload = (event.data?.json() as Partial<PushPayload> | undefined) ?? {};
  } catch {
    // Non-JSON payload — show the generic fallback below instead of nothing.
  }

  const title = payload.title || "Form:at";
  const options = buildNotificationOptions(payload);
  // Unique per push — a constant tag would make a second announcement
  // silently REPLACE an unread first one (tag collapse, no renotify).
  // Two same-day sends (new set + new event) must both stay visible.
  options.tag = `format-${Date.now()}`;

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus-or-open, the standard PWA notificationclick pattern. `navigate()` is
// what lets a tap deep-link an ALREADY-OPEN app to the pushed URL rather than
// just bringing an unrelated tab to the front. `includeUncontrolled: true`
// matters specifically because a client open from BEFORE this SW activated (or
// before `clientsClaim()` took it over) is still a real window worth reusing
// instead of spawning a duplicate.
//
// `event.action` distinguishes a body tap from one of the two action buttons:
// empty string for a body tap or a notification with no buttons, otherwise the
// tapped action's id. `resolveNotificationClickUrl` (pure, unit-tested) owns
// that decision; `null` means "later" was tapped, and the notification already
// closed above, so there's nothing left to do.
self.addEventListener("notificationclick", (event) => {
  const dataUrl = (event.notification.data as { url?: string } | undefined)?.url;
  const targetUrl = resolveNotificationClickUrl(event.action, dataUrl);
  event.notification.close();
  if (targetUrl === null) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const existing = clientList[0];
        if (existing) return existing.focus().then((c) => c.navigate(targetUrl));
        return self.clients.openWindow(targetUrl);
      })
      // `navigate()` rejects (TypeError) on a client this SW doesn't control
      // — and includeUncontrolled above deliberately admits those. Without
      // this fallback the tap would be swallowed entirely: the notification
      // is already closed, the rejection dies inside waitUntil, nothing
      // opens. Worst case here is a duplicate window, which beats a dead tap.
      .catch(() => self.clients.openWindow(targetUrl)),
  );
});

// Last-resort fallback when nothing else handled the request — no cached
// entry AND network failed. Use `matchPrecache` instead of
// `createHandlerBoundToURL`: the latter runs the PrecacheStrategy which has
// `fallbackToNetwork: true` by default, so a cache miss triggers a network
// fetch that fails offline — defeating the whole point of an offline
// fallback. `matchPrecache` is a direct cache lookup, no network involved.
setCatchHandler(async (options) => {
  if (options.request.mode === "navigate") {
    const cached = await matchPrecache("/offline.html");
    if (cached) return cached;
  }
  return Response.error();
});

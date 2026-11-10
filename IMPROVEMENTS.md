# Form:at — Improvements

Running list of feature/functional improvements. Tick off as we ship.

## Quick wins

- [x] **#1 — Autoplay next set on end**
  Already implemented in `apps/web/app/hooks/useAudioPlayer.ts` (`onEnded`). When a set ends, the player advances to the next set in `sets[]` and starts playback.

- [x] **#2 — Sharing (deeplink timestamps + share modal)**
  Goal: match the SoundCloud/Mixcloud sharing pattern so listeners actively pass sets around.
  - `?t=<seconds>` URL support: `/sets/<id>?t=1234` jumps to that moment on play.
  - Custom `ShareModal` opened from the set detail page (`[ share_set ]`) and from share icons on each set card. Options: `copy_link`, `copy @ MM:SS` (when this set is playing past 3s), `whatsapp`, `twitter`, `telegram`, `email`.
  - `Toast` system (slides up/down) confirms successful copy.
  - Later: small share icon in the player bar so listeners can share without leaving the audio.

- [x] **#3 — Continue listening card on home**
  We already persist `nowPlayingId` + `positions`. Surface a top card on `/` that resumes the last set in one tap when those are present.
  Shipped, but not as a separate card: `routes/index.tsx`'s main button is a play/pause toggle for the loaded set — `resume_signal` when it's paused, `pause` while it plays — and with nothing loaded it reads `play_latest` and plays the newest set. Same one-tap-resume outcome, folded into the button rather than a distinct component.

  On the home page's night layout (#15) there is no play button: listening starts from `/sets` while a night's tickets are on sale.

- [x] **#4 — Add to calendar on events**
  `AddToCalendarButton` builds an RFC 5545 `.ics` (TZID=Europe/London) from `event.date / runtime / venue` and triggers a download. Shown on upcoming events only. Util: `apps/web/app/utils/ics.ts`.

## Medium lift, high engagement

- [ ] **#5 — Tracklist / chapters on set pages**
  Add `tracks: [{ time, artist, title }]` to `MusicSet`. Render clickable rows that seek to that moment. Industry standard for DJ mixes; big dwell-time boost.

- [ ] **#6 — Sleep timer + speed control**
  Player additions: 15/30/60-min sleep, 0.75x/1x/1.25x speed. Common asks for long mixes.

- [ ] **#7 — "Shuffle the archive" / random set**
  One button on `/sets` (and maybe `/`) that picks a random set and plays it. Fits the explore vibe.

- [ ] **#11 — Search/filter input for the sets catalogue**
  Not needed yet — same revisit trigger PWA_PROGRESS.md already uses for the deferred manage-offline-sets view: earns its place once the catalogue grows past ~10-15 sets, where scanning every card becomes a chore. At today's 4 sets, scanning is still instant. Placeholder so it isn't lost once the next few batches land.
  **Context update (2026-08-04):** this threshold used to require someone manually running a migration/seed script to add a set. Now that `apps/admin` has a self-serve upload form (PR4, 2026-07), adding a set is a few form fields and a click — the same trigger condition arrives much sooner than when this was written, on whatever cadence Julian actually uploads at rather than an engineering-effort-gated one.

- [x] **#12 — Archive Cloudflare RUM data into D1 before it degrades** *(shipped 2026-08-11)*
  Built as planned below, in four steps: `rum_daily` table, `apps/rum-archiver` (standalone Worker, `crons = ["17 3 * * *"]`), the `visits_history` card, and a pull-only staleness disclosure. Full reasoning — the upsert quality guard, the real-zero-vs-uncovered-day distinction, and the archive/diagnostic cross-validation — is in PWA_PROGRESS.md → *Archiving Cloudflare RUM into D1 before it degrades*. The record below is the pre-build reasoning, kept as history.


  Cloudflare keeps unsampled Web Analytics beacon data for **7 days**, then aggregates it down to ~10%, and retention ends the window entirely after some period. So a live query means yesterday's number is exact, last month's is an extrapolation from a 10% sample, and eventually it's gone. Capturing each day into D1 while it's still unsampled would preserve the accurate version permanently and give history past Cloudflare's retention — a small daily row, not a data pipeline.

  **Same shape as the sets-catalogue snapshot** (`packages/data/src/sets.generated.ts`): a stored copy of something authoritative elsewhere, kept because the authoritative source isn't always reachable. There the reason is offline; here it's retention. Worth reusing that framing if this is ever built, rather than inventing a new one.

  **First question now SETTLED with live data (2026-08-10), and it strengthens the case.** Sampling genuinely bites, definitively, after 7 days. Measured on this site: a 60-day query returned 120 visits extrapolated from **12 real observations** at an effective 1-in-10, with only **11 of 55 days** carrying any rows — sampling deletes whole days, not just precision. A 7-day query over the same data is exact and complete.

  The `visits` card was therefore narrowed to a 7-day window (see PWA_PROGRESS), which buys exactness at the cost of history. That makes this item the **only** way to have accurate history beyond a week: capture each day into D1 while it is still unsampled, or accept that anything older than 7 days is a 10% extrapolation with gaps. Materially stronger than when this was logged, when the premise was still a guess.

  **Trigger question now SETTLED (2026-08-10) — building.** Cloudflare Pages Functions cannot run cron: their API reference exposes only HTTP handlers (`onRequest*`), with no scheduled handler, and Cloudflare's own guidance is to use a standalone Worker instead. GitHub Actions `schedule` needs no new deploy target but **disables itself after 60 days without a commit** (only commits reset it — tags, issues and PR merges don't), which on a project heading to low activity is precisely the wrong failure mode: it stops quietly, permanently, roughly two months after the last commit.

  So: a standalone Worker with a Cron Trigger, accepted as a third deploy target because it is the only option that keeps running when nobody is committing. Each run re-fetches the trailing 7 days and upserts, so any two successful runs inside a week lose nothing — that absorbs transient failures, though notably it would NOT have rescued the GitHub option, whose failure is permanent rather than transient.

  Table applied as `rum_daily` (see `apps/web/schema.sql`). Build order: table → Worker + cron → history card reading D1 → staleness disclosure.

- [ ] **#13 — Instagram Story video: follow-ups deliberately left out of v1**
  Live on Android; iOS still behind `?story=on` until it's tested on an iPhone (design and device results: TECH_DEBT.md item 30, `spikes/instagram-story/`). Deferred on purpose:
  - **CBR warning at admin upload.** The Story excerpt seeks by byte offset, which is exact only for CBR MP3s; v1 refuses a VBR (`Xing`) set at clip time. Add a *warning* (not a block) to the admin upload's validation (`apps/admin/app/utils/validateUpload.ts`) when the file has a `Xing`/`VBRI` header or no `Info` tag. All 10 catalogue sets are CBR today.
  - **Offline clipping in the installed app.** v1's entry is online-only; offline shows a clear message. The excerpt fetch already goes through `withAppContext`, so for a saved set the SW's audio route answers the Range request from the IDB copy via `createPartialResponse` (verified in a desktop production build with the connection cut mid-pick, not on a device). What's left is letting `StoryEntry` open offline for saved sets only. Browser tabs stay online-only regardless (tabs never read the offline library).
  - [x] ~~**Artwork / DJ photo choice in the picker.**~~ **Shipped without a choice:** the card is the DJ's photo, cropped to the square (upper-biased, for the faces), over the set's artwork as a faint background; a set with no DJ or no photo keeps the artwork in the card. PWA_PROGRESS.md → *"Story video: DJ photo card and artwork background"*.
  - [x] ~~**Fine-resolution peaks generated at upload (~10/s)**~~ **Shipped** as `peaks-fine.bin` (1 byte per value, square-root companded; `packages/data/src/finePeaks.ts`), required by the admin upload and backfilled for the existing sets by `apps/web/scripts/backfill-fine-peaks.ts`. The zoomed strip draws from it and decodes audio only once a drag stops, for preview and recording. Not saved offline: offline, the strip falls back to decoding the saved copy. PWA_PROGRESS.md → *"Fine-resolution peaks for the Story picker"* has the measurements.

- [x] **#14 — DJ Story image (promote a DJ's next night on Instagram)**
  `[ image_story ]` in the `instagram:` section (first in the modal) of a DJ page's share modal (the same section that holds the set Story video on a set page), for everyone (browser tab or installed app): a 1080×1920 JPEG drawn in the browser — the Form:at wordmark (the same as the set Story's), the DJ's photo across the content width, their name, their next night (`[ 004 · sat 05.12 · stereo ]`, the page's short label with the venue; the wordmark already says Form:at) or, with none announced, `[ resident ]` / `[ guest ]`, and formatglasgow.com, all inside Instagram's safe zone; the link sticker goes below it by hand. Two photo treatments, switchable in the sheet's preview before sharing: form:at (the default: gold duotone card over a purple-tinted background) and raw (the photo as it is, over a neutral background). The background is always the photo blurred past legibility and darkened, and the text is never treated. Tried and dropped, not to be re-proposed: gold, purple and scan, and glitch (red/blue channel split plus shifted slices), because distorting the photo competes with the DJ for attention. Shared as a file where the browser can (`navigator.canShare({ files })`), downloaded otherwise; the DJ page's link is copied first for Instagram's link sticker. Counted as `dj_story_open` / `dj_story_shared` / `dj_story_downloaded`. Where it lives: `.claude/rules/stories.md`, "DJ Story image". Open:
  - **Device check.** Not yet run on a phone: whether Android's share sheet offers Instagram Stories for the JPEG and it publishes whole, and the same on an iPhone (TECH_DEBT.md item 30's device access).
  - **Admin dashboard.** The three `dj_story_*` events are stored but no card shows them yet.
  - **Several photos per DJ.** Out of scope for v1. The data change: `DJ.photo?: string` becomes `photos?: string[]` (the first is the page's and the OG banner's), and the sheet adds a photo row beside the treatments; `optimize-images` already handles any file name under `images-source/djs/`.

## Bigger but worth it

- [x] **#15 — Home page points at the next night**
  While the next night's tickets are on sale the home page is that night: its artwork on the page's black, one line (`sat 5 dec · stereo · 23:00`) and one button, `get_tickets_for_004`, to the event page. A device that holds a ticket gets `your_tickets_for_004` to `/tickets` instead. The rest of the time it is the manifesto and `play_latest`. Under both: `[ community ]` (the WhatsApp community), `[ instagram ]`, `[ install_the_app ]`. The phone's bottom bar reads `tix`. Taps are counted (`home_*_click` in `trackableEvents.ts`).
  - **Dropped, do not re-propose:** `[ bookings ]` on the home page. Promoters reach the collective through other channels, and no one ever wrote to the address unprompted. Also dropped from the night layout after being tried in renders: the manifesto, the play button, the line-up, and section labels such as `next_transmission`, which took space and attention from the one button.
  - **Open:** what the home shows for a night that is announced but not on sale yet, or sold out (today: the listening layout), and for a night without `homeArt` (today: the line and the button, no image). Events still turn `past` by hand everywhere except the home page.

- [ ] **#8 — Full PWA (install + share routing + offline + polish)**
  Manifest is already in place. Take Form:at from "web app with a manifest" to a real installable PWA with native-app-quality UX. Four phases.

  **Status (verified against the actual code, 2026-08-04): Phases 1-3 fully shipped. Phase 4 partial** — 1 of 5 items done.

  ### Phase 1 — Make it installable ✅ shipped
  - Audit `manifest.json`: `start_url`, `scope`, `display: "standalone"`, `theme_color`, `background_color`, icons (192 + 512 maskable).
  - Register a minimal service worker (just registering it unlocks the Android "Add to Home Screen" prompt — caching comes later).
  - Add an in-app "Install Form:at" CTA on `/` that calls `beforeinstallprompt`.
  - Lighthouse PWA audit → green.
  - **Outcome**: phone shows install prompt; tap → Form:at home-screen icon, launches in standalone mode (no URL bar, no tabs). Feels like a real audio app.
  - _Confirmed: `public/manifest.json` has every field listed above plus `launch_handler`; `app/utils/rootHead.ts` registers the SW; `InstallAppButton.tsx` (home) + `installCapability.ts`/`installPromptStash.ts` handle the `beforeinstallprompt` capture/CTA flow._

  ### Phase 2 — Shared links open the PWA, not the in-app browser ✅ shipped
  - **Android**: with the PWA installed + "Open supported links" enabled (Chrome auto-prompts post-install), taps on `formatglasgow.com` links from Instagram / WhatsApp / wherever open directly inside our PWA, bypassing the in-app browser. Automatic once WebAPK criteria are met.
  - **iOS**: Apple is stricter — taps from IG still go through IG's in-app browser by default. Two mitigations:
    - `launch_handler: { client_mode: "navigate-existing" }` in manifest so future taps land in the same PWA window.
    - In-app-browser detection banner ("Open in Safari for the full experience") that fires only when `userAgent` matches Instagram / TikTok / Facebook.
  - **Outcome**: Android share links open inside the PWA with our lock-screen player and our branding. iOS gets a one-tap escape hatch from the in-app browser.
  - _Confirmed: `manifest.json`'s `launch_handler` is in place; `app/utils/inAppBrowser.ts` + `InAppBrowserBanner.tsx` implement the UA-sniffed banner._

  ### Phase 3 — Offline caching (the original #8) ✅ shipped
  - App shell: cache HTML / JS / CSS / fonts. Repeat visits start instantly even with no signal.
  - Artwork: pre-cache all variants on first visit (small, fast).
  - Audio: explicit `[ save_for_offline ]` button per set caches the MP3 from R2 into Cache Storage. `[ saved · 64MB ]` indicator.
  - Download icon on `/sets` list cards. Each card currently has share + play but no download affordance. Once `save_for_offline` actually downloads audio (this phase), add a per-card download icon that saves the set offline directly from the list without entering the detail page — and have it reflect state (not-saved / downloading / saved, pairing with the `[ saved · 64MB ]` indicator). Deliberately deferred from Phase 3: while `save_for_offline` only triggers install (no real download yet), a download icon on the list would promise a direct download it can't deliver and read as a broken promise. It only becomes honest once the button actually caches the MP3.
  - Beacon queue: if a play happens offline, queue the `/api/signal` POST and replay via Background Sync. No analytics lost.
  - **Outcome**: train, underground, festival Wi-Fi — saved sets just play.
  - _Confirmed: `sw.ts` precaches the app shell (`workbox-precaching`) and runs a `StaleWhileRevalidate` `artwork-v1` route (caches-as-visited rather than a proactive prefetch-everything pass, but the same offline-availability outcome once a set's been viewed); `SaveForOfflineButton.tsx` + `SaveForOfflineIconButton.tsx` (the latter wired into `SetCard.tsx`'s list rows) cover the button and the list-card download affordance; `beacon-queue.ts`'s `SYNC_TAG` + `sw.ts`'s `sync` listener cover Background Sync replay._

  ### Phase 4 — Polish (partial — 0/5 shipped)
  - [ ] Per-device splash screens (iOS especially). Not found in the codebase.
  - [~] ~~Update notification when a new deploy is live ("new build — tap to reload").~~ **Shipped, then deliberately removed — do not re-propose.** `UpdateToast` interrupted the very session it was meant to protect, and any prompt-or-reload variant reintroduces the mid-playback-cutoff failure it was built to avoid. New builds now activate silently on the next cold start. Full rationale and the accepted trade-off (an indefinitely-open client stays on the old version) in PWA_PROGRESS.md's "SW update flow" section.
  - [ ] iOS heartbeat so the PWA doesn't get evicted by the 14-day storage cleanup. Not found in the codebase.
  - [ ] "Manage offline sets" view (storage used, per-set remove). Not shipped — deferred, coupled to TECH_DEBT.md item 16 (orphan-artwork prune ships alongside it). See that item for the (now-accelerated) revisit trigger.
  - [ ] **FullPlayer header layout for iOS PWA standalone mode.** Currently the overlay's header pads itself by `safe-area-inset-top + 1.5rem`, which is the safe default everywhere. In a true iOS PWA-installed context with a notch / Dynamic Island, the more native pattern is to put `› now_playing` on the **left of the island** and `[ × ]` on the **right of the island** with the island filling the gap — like the iOS status bar layout. Requires `viewport-fit=cover`, detection via `window.matchMedia('(display-mode: standalone)')`, and horizontal offsets that clear the system time / indicators (≈5rem each side). Degrades cleanly to current behaviour outside PWA mode. Skipped during Phase 2.5 of the player work because we're not on the PWA install path yet — revisit during this phase. Still true as of 2026-08-04: `FullPlayer.tsx`'s header is still the plain `safe-area-inset-top + 1.5rem` padding, no `matchMedia`/island-aware split.

  ### Recommended order
  Phase 1 first (huge UX win, low risk). Then Phase 2 (directly addresses the Instagram → in-app browser pain). Then Phase 3 (the meaty one). Phase 4 is polish — whenever it bothers us.

  ### Honest trade-offs
  - **Wins**: free distribution channel; home-screen presence creates ownership; lock-screen player becomes first-class; Android shared links route into the PWA; offline listening is a real retention hook.
  - **Costs**: iOS support is second-class; iOS evicts storage after ~14 days of inactivity (can wipe offline sets); service worker adds a cache-staleness failure mode; install discovery on iOS is brutal (no automatic prompt — has to be in the Share sheet).

- [ ] **#9 — Per-DJ stats**
  Aggregate plays and top territories on `/djs/:id`. D1 already has the data — just a new server fn.

- [ ] **#10 — Native-app handoff for social links on iOS**
  Android already opens the native app via `intent://` URLs (see `utils/deeplink.ts`). iOS currently relies on Apple's Universal Links — works for major platforms (Instagram, Spotify, SoundCloud) but only when the user hasn't told iOS to keep links in Safari. Add a best-effort iOS path:
  - On `iPhone|iPad|iPod` UA + a known platform handle, try the app URL scheme (`instagram://user?username=…`, `spotify:user:…`, `twitter://user?screen_name=…`).
  - Use a `visibilitychange` listener as fallback: if the page becomes hidden within ~1.5s, the app opened — cancel fallback. Otherwise navigate to the web URL.
  - **Trade-offs**: Apple has been hostile to URL schemes; some apps drop them; false-fire fallbacks happen if the user returns to the page quickly. Acceptable risk for major platforms, but not worth doing for every social. Pair with PWA install onboarding (Phase 1 / 2 of #8) for the best overall iOS story.

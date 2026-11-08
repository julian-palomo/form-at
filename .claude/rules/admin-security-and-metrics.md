---
paths:
  - "apps/admin/**"
---

# Admin: security controls and metrics

Why auth looks the way it does: README → *"Admin auth: no auth code, then auth
code anyway"*. Security controls in detail: `apps/admin/README.md`.

## Never remove or weaken the host guard

Cloudflare Access can only gate hostnames in a zone we own — it **cannot** gate
Cloudflare's own `*.pages.dev`. So the same admin deployment is reachable at
`form-at-admin.pages.dev` and at every per-deployment preview URL
(`cd9a05fe.form-at-admin.pages.dev`). `apps/admin/app/utils/hostGuard.ts`'s
`isAllowedHost`, plus its enforcement in `apps/admin/app/server.ts` — a plain 404
for any host that isn't `admin.formatglasgow.com` (localhost exempted for dev and
e2e) — **is the only thing keeping the dashboard off the public internet on those
hosts.** It runs before routing and before any D1 access, and returns 404 rather
than a redirect so it doesn't advertise the real hostname. It is not redundant
with Access; deleting it makes the dashboard public. `tests/unit/server.test.ts`
asserts the 404.

## Every mutating admin endpoint must call `verifyAccessJwt`

Cloudflare Access gates page loads at the edge, not individual endpoint calls, so
each writer verifies the Access identity server-side via
`apps/admin/app/utils/verifyAccessJwt.ts`. All seven current ones do —
`routes/api/sets.ts` (upload), `routes/api/sets-presign.ts` (R2 presigned URLs),
`routes/api/sets/restore.ts`, `routes/api/send-push.ts`,
`routes/api/tickets/check-in.ts` (which, for a scanned token, then checks the
signature with `verifyTicketToken` before touching D1), `routes/api/tickets/door-sales.ts` (door `+1`
and `−1`), `routes/api/tickets/door-price.ts`. Add nothing that skips it; only the read-only
aggregate queries may. Reads of buyer data aren't aggregates: the `/door` loader
(`data/door.ts`), `routes/api/tickets/door-csv.ts` and the `/tickets` loader
(`data/sales.ts`) verify it too, through `utils/accessIdentity.ts`. There is deliberately no dev-mode
bypass. Paired with the host guard — Access covers neither the `*.pages.dev`
hostname nor individual endpoint calls.

## Never drop `media-src blob:` or the R2 `connect-src` allowance from the CSP

Two separate directives in `apps/admin/app/server.ts`, two separate real bugs
found back to back against the same real upload attempt (`TECH_DEBT.md` item 23a)
— no unit test could have caught either, since jsdom enforces no CSP and the
header only exists on the real `server.ts` response.

`media-src 'self' blob:` — `UploadSetForm`'s duration read (`readAudioDuration`,
`apps/admin/app/utils/validateUpload.ts`) loads the selected file into an
`<audio>` element via a `blob:` object URL to read its metadata. Without it,
`default-src`'s implicit `'self'` silently blocks the load, `loadedmetadata`
never fires, and every upload reports a valid mp3 as unreadable.

`connect-src 'self' https://*.r2.cloudflarestorage.com` — once the file passes
the check above, `UploadSetForm`'s four PUTs (`uploadWithProgress.ts`'s XHR) go
straight from the browser to R2 against a presigned URL from `sets-presign.ts`
(see `r2Sets.ts`). Without the R2 host, every PUT is silently blocked and the
form shows "check your connection", which has nothing to do with the actual
cause. Wildcarded, not the literal `<accountId>.r2.cloudflarestorage.com` host,
because the account id is only known at runtime via env.

The same block deliberately does **not** allowlist `static.cloudflareinsights.com`
— see `apps/admin/README.md`'s CSP section for why that absence is also
intentional (Cloudflare's zone-level automatic Web Analytics setup would
otherwise mix this dashboard's own visits into the public site's traffic
numbers), not a gap to close alongside `apps/web`'s.

## Never substitute `0` for a metric that failed to load

`AdminDashboardStats.edgeTraffic` is `null` on every failure path — missing
credentials, 403, a GraphQL `errors` array inside a 200 body, timeout, empty
window. `0` states "no traffic"; `null` states "we couldn't read it". Rendering
the first for the second is a wrong fact, not a missing one, and it's
indistinguishable to whoever reads the dashboard. Same reasoning as
`conversionRate`/`acceptedRate` being nullable rather than 0. The
`// edge_traffic` card's empty state is the reference example.

## Naming a metric for what it measures

Where two sources count different things, the label says which. `edge_traffic`
(`requests`/`page_views`) is Cloudflare edge requests **including bots** — never
"visitors" or "people", because `visits` counts beacon page loads with
bot-flagged rows removed **by us**, not by Cloudflare (RUM records bots too —
confirmed in our own data, see PWA_PROGRESS). The two therefore disagree
substantially, and a shared label makes the smaller number look like a bug. Same
reasoning behind `install_to_push` being captioned an approximation and
`avg_engaged_listening` saying it's cumulative. Reasoning per metric lives with
the code — `data/cf-analytics.ts`'s header for this one.

## Keep `TrendChart` lazy

`apps/admin`'s `TrendChart` lazy-loads its inner chart. A static top-level import
still renders correctly while pulling all of `visx` into admin's `_worker.js`.
`ClientOnly` is a render guard, not a code-splitting mechanism. Silent bundle
regression, no test failure.

The same goes for `DoorScanner`, which `DoorList` loads with
`lazy(() => import("./DoorScanner"))`: a static import would ship the jsQR
decoder with every load of `/door`, not only when `scan` is pressed.

## Map

| Area | Edit here | Why it's built this way |
|---|---|---|
| Admin + auth | `apps/admin/app/routes/`, `utils/verifyAccessJwt.ts` | See above. |
| Set upload | `apps/admin/app/routes/api/sets-presign.ts`, `utils/uploadWithProgress.ts`; R2 keys in `utils/r2Sets.ts`, built from `packages/data/src/r2Keys.ts` (upload versions, `versionedSetKey`). Four files per upload; the fine-peaks file is decoded server-side on create, not just HEADed | README → *"A 220MB upload can't go through a Worker"* and *"CDN rules for cdn.formatglasgow.com"* (versioned keys, the immutable cache rule) |
| RUM history card | `apps/admin/app/data/rum-history.ts` (`coveredDays`/`buildHistory`), `components/VisitsHistoryCard.tsx` | PWA_PROGRESS → *Archiving Cloudflare RUM into D1* → "Real zeros vs days nobody looked at" and "Coverage has to be recorded, not inferred". **Never map an uncovered day to `0`** — `TrendChart` takes `(number \| null)[]` precisely so a gap can render as a gap; a zero there draws an outage as flat traffic. **Coverage comes from `rum_capture_runs`, never from `rum_daily.captured_at`** — a run over a quiet window writes no rows, so that derivation turns a healthy week into gaps. **Keep `lastRunAt` and `lastSuccessAt` separate**: merged, a cron that fires daily and fails every read reads as healthy. |
| Admin trend markers | `apps/admin/app/utils/milestones.ts` (static milestones, one per event in `packages/data/src/events.ts`, + `markerPositions`), push sends and uploads from D1 in `fetchMilestones`, drawn by `TrendChart` via `MilestonesContext` | A marker lands in the bar its day was counted in, so it must use the series' own window: `TrendChart`'s defaults are the 60-day window every `admin-stats.ts` trend uses. **A chart over any other window must pass its own `startDay`/`totalDays`**, or its markers silently land in the wrong bars (edge traffic, live visits and the RUM history card do). |
| Cloudflare analytics | `apps/admin/app/data/cf-analytics.ts` — the app's only network calls (zone edge traffic + account RUM visits), both deferred in `routes/dashboard.tsx`'s loader. Diagnose an empty card with `pnpm -C apps/admin diagnose-visits` | That file's headers: what each measures, why edge traffic is never "visitors", why RUM rows are bot-filtered client-side, sampling and retention handling, and why every failure is `null`. |

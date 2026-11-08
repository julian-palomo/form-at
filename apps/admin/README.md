# apps/admin

The internal dashboard — `admin.formatglasgow.com`. Analytics the collective can
actually read, plus set upload, set restore, push sending and the door list for
ticketed nights.

A **separate** Cloudflare Pages project rather than a route inside the public
site. That's what makes the security model work: Cloudflare Access gates the
subdomain at the edge, so there is no login code in this app at all. A `/admin`
route inside the public site couldn't be gated without putting Access in front of
the whole site.

```bash
pnpm dev:admin     # :5174
pnpm test:admin
pnpm -C apps/admin test:e2e
pnpm -C apps/admin diagnose-visits   # why is the visits card empty?
```

No Cloudflare credentials needed locally — with no D1 binding present the
dashboard renders fixtures from `app/data/sample-stats.ts` and shows a
`sample data` marker, so a wrong number can't be mistaken for a real one. `/door`
does the same with made-up buyers and door sales from `app/data/door.ts`.

## Layout

| Path | |
|---|---|
| `app/routes/dashboard.tsx` | the dashboard; tab content is in `components/*Tab.tsx` |
| `app/routes/door.tsx` | the door: inside against the venue capacity, room left, `+1 cash` / `+1 card` / `−1` for people paying at the door, the door price and the cash expected in the box; then a `scan` button that opens the QR scanner, the paid online tickets, search by name or email, one-tap check-in, a refresh button and a CSV download (with a `barcode` column, the signed token, so RA Scan can import it as a fallback). Counter in `components/DoorSales.tsx` (queries in `data/door-sales.ts`), list and search in `components/DoorList.tsx`, the scanner in `components/DoorScanner.tsx` (lazy; camera and jsQR decoding in `utils/useQrCamera.ts`), the loader in `data/door.ts` |
| `app/routes/api/` | the seven mutating endpoints — upload, presign, restore, send-push, `tickets/check-in` (by `ticketId` from a tap, or by the signed `token` from a scan, whose signature is checked before any D1 access), `tickets/door-sales` (`+1` and `−1`), `tickets/door-price` — and `tickets/door-csv` |
| `app/data/` | aggregate D1 queries, Cloudflare Analytics reads, the RUM archive reader |
| `app/utils/hostGuard.ts` | the `*.pages.dev` guard — see below |
| `app/utils/verifyAccessJwt.ts` | server-side Access identity verification |

## Two security controls that look redundant and are not

**`hostGuard.ts` is the only thing keeping this off the public internet.**
Cloudflare Access can gate hostnames in a zone we own; it **cannot** gate
Cloudflare's own `*.pages.dev`. The same deployment answers at
`form-at-admin.pages.dev` and at every per-deployment preview URL. `server.ts`
returns a plain 404 for any host that isn't `admin.formatglasgow.com` (localhost
exempted for dev and e2e), before routing and before any D1 access. Deleting it
makes the dashboard public.

**Every mutating endpoint calls `verifyAccessJwt`.** Access gates *page loads* at
the edge, not individual endpoint calls, so each writer verifies the Access
identity server-side. All seven do. There is deliberately no dev-mode bypass, and
only the read-only aggregate queries may skip it. The door list's loader and the
CSV aren't aggregates (every buyer's name and email), so they verify it too,
through `utils/accessIdentity.ts`.

## The CSP: one thing blocked on purpose, two allowed for the upload form

If the console shows `static.cloudflareinsights.com` blocked by CSP here,
that's intentional — and it isn't this app's own injection to go looking for,
because there isn't one. `apps/web/app/utils/rootHead.ts` injects the beacon
deliberately (see `@form-at/data/webAnalytics`'s header for why); `apps/admin`
never does. Cloudflare's zone-level automatic Web Analytics setup edge-injects
the same beacon into every hostname in the `formatglasgow.com` zone, admin
included, and `app/server.ts`'s `DOCUMENT_CSP` doesn't allowlist it — which is
the point: this dashboard's own visits would otherwise pollute the public
site's traffic numbers. The actual toggle for that edge injection lives in the
Cloudflare dashboard's Web Analytics settings, not in this repo.

`media-src 'self' blob:'` **is** required, though. `UploadSetForm`'s duration
read (`readAudioDuration`, `app/utils/validateUpload.ts`) loads the selected
file into an `<audio>` element via a `blob:` object URL, and without that
directive the load is silently blocked, `loadedmetadata` never fires, and
every upload reports a valid mp3 as unreadable — found against a real upload,
2026-08-18 (see `TECH_DEBT.md` item 23a).

So is `connect-src`'s `https://*.r2.cloudflarestorage.com` allowance. Once the
duration read gets past `media-src`, `UploadSetForm`'s four PUTs go straight
from the browser to R2 against a presigned URL (`sets-presign.ts` →
`r2Sets.ts`) — without this, every PUT is silently blocked and the form shows
a generic "check your connection" that has nothing to do with the actual
cause. Found the same day, immediately after the `media-src` fix, by the same
real upload finally reaching this step (`TECH_DEBT.md` item 23a again). A
wildcard, not the literal `<accountId>.r2.cloudflarestorage.com` host, because
the account id is only known at runtime via env, not at this module's load
time.

## Ticket signing secret

`TICKET_SIGNING_SECRET` on `form-at-admin` must hold the same value as on
`form-at-web`, which signs the tokens the tickets' QRs carry. Without it (or
with a different value) every scan answers "scanner not set up" or NOT VALID,
and the CSV's `barcode` column comes out empty; check-in by name keeps working.

## The house rule for numbers

A metric that failed to load is `null`, never `0`. `0` states "no traffic"; `null`
states "we couldn't read it", and rendering the first for the second is a wrong
fact rather than a missing one. The same rule is why `TrendChart` takes
`(number | null)[]` — an uncaptured day has to render as a gap, or an outage
draws as flat traffic. See `data/cf-analytics.ts` and `data/rum-history.ts` for
the per-metric reasoning.

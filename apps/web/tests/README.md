# Tests

Covers `apps/web`. The other workspaces test themselves the same way and have
no separate README: `apps/admin` has its own `tests/unit` + `tests/e2e`,
`apps/rum-archiver` has `tests/` (Vitest only — a cron Worker has no browser
surface to drive), `packages/data` has `tests/unit` (Vitest, node) and runs
the D1 queries whose correctness rests on SQL against real SQLite through
`tests/helpers/sqliteD1.ts` (which `apps/web`'s ticket tests import too, under
`// @vitest-environment node`), and `packages/ui` co-locates a `.test.tsx` beside each
component (its interaction tests run Storybook stories through Vitest via
`composeStories`). Run everything at once from the repo root with `pnpm test` /
`pnpm test:e2e`.

Two layers, both wired into the workspace:

| Layer | Tool      | Lives in     | What it tests                                      |
|-------|-----------|--------------|----------------------------------------------------|
| Unit  | Vitest    | `tests/unit` | Pure logic — store actions, hooks, components, utils |
| E2E   | Playwright| `tests/e2e`  | Real browser flows — navigation, player, routes    |

## Running

```bash
pnpm test            # vitest watch (DX local)
pnpm test:run        # vitest run (CI)
pnpm test:ui         # vitest UI dashboard

pnpm test:e2e        # playwright (boots dev server automatically)
pnpm test:e2e:ui     # playwright UI mode (great for debugging)
```

The Playwright `webServer` boots its own `vite dev`, so don't start one for it.
It listens on a port hashed from this folder's path (`tests/e2e/_port.ts`,
4200–4699; `apps/admin` uses 4700–5199), never on `pnpm dev`'s 5173, so a dev
server you have running is left alone and two worktrees can run the suite at
the same time. `E2E_PORT=4321 pnpm test:e2e` picks the port by hand. First run
also needs `pnpm exec playwright install` to pull browser binaries.

## Layout

```
tests/
├── unit/
│   ├── store/         # Zustand slices (playerSlice, catalogueSlice, rehydration)
│   ├── hooks/         # useAudioPlayer*, useFirstLoad, useOfflineDownload…
│   ├── components/    # NightHome, CatalogueSync, TicketQr, Celebration, etc. (shared design-system
│   │                  #   components live in packages/ui and are tested there)
│   ├── utils/         # fmt, appContext, deeplink, installCapability…
│   ├── data/          # beacon-queue, sets, setsForRoute (the D1-fallback logic), tickets (real SQLite), ticketEmail (Resend request shape)
│   ├── routes/        # API handlers — api-signal, api-event, api-push-subscribe, api-stripe-webhook (real SQLite); pages — dj-detail, event-detail (page order, bracket actions), ticket-success (celebration once per order), ticket-page-head (Open Graph tags without personal data)
│   └── scripts/       # build scripts (optimize-images, generate-peaks)
├── fixtures/          # binary test inputs (mediarecorder-fragmented.mp4: a real Chrome recording, cut after 2 fragments)
├── e2e/
│   ├── home.spec.ts        # Manifesto, CTA, social links
│   ├── sets.spec.ts        # List + info → detail flow
│   ├── events.spec.ts      # List + lineup links
│   ├── djs.spec.ts         # Residents/guests sections
│   ├── player.spec.ts      # Audio + controls (mocks R2 with silent MP3)
│   ├── navigation.spec.ts  # Top/bottom nav routing
│   ├── csp-violations.spec.ts # Zero CSP violations on the golden path; allowed hosts reachable
│   ├── story-video.spec.ts # Story video recorder in a real browser (harness page, no UI)
│   ├── story-picker.spec.ts # ?story=on entry, install gate, picker (zoomed strip from fine peaks, no audio mid-drag), create → share (Pixel 7; real recording on macOS)
│   ├── tickets.spec.ts     # Sales off outside Cloudflare: no buy block; /tickets/success handles an unknown session; /tickets empty state says the sale is coming; a bad token is a 404
│   ├── _helpers.ts         # shared gotoAndHydrate helper, not a spec
│   └── _port.ts            # the per-checkout dev-server port playwright.config.ts boots on
└── setup.ts          # jest-dom matchers, jsdom HTMLMediaElement stubs (skipped in `// @vitest-environment node` files)
```

## Conventions

- **Co-locate by concern, not by file path.** A `Card` test goes in `tests/unit/components/Card.test.tsx`, not next to `app/components/Card.tsx`.
- **Test behaviour, not implementation.** Prefer `getByRole` / `getByText` over CSS selectors or `data-testid`.
- **Assert what the user sees** — visible text, ARIA labels, URLs.
- **No snapshot tests.** They rot fast and don't catch regressions worth catching.
- **Mock the network in E2E**, never the implementation. See `player.spec.ts` for the R2 audio route stub pattern.
- **Browser-only modules with no UI yet** (canvas, MediaRecorder, Web Audio) are tested through a harness page that `page.route` answers on the dev server's origin, importing the real modules from Vite by path. The app gains no test route. See `story-video.spec.ts`.

## Adding a test

1. Pick the right folder (unit vs e2e).
2. Mirror an existing file's style.
3. Run `pnpm test:run` and `pnpm test:e2e` locally before pushing.

## Known quirks

- **A label that is a prefix of another label breaks `getByText` and `hasText`.** Both match on substring, so adding a `// visits_history` card silently made the existing `getByText("// visits")` resolve to two elements and fail strict mode — a passing test broken by a change to a *different* card. Use `{ exact: true }`, and scope a card with `.filter({ has: page.getByText(label, { exact: true }) })` rather than `.filter({ hasText: label })`, which has no exact option.
- **Playwright runs `workers: 1`** locally — Vite's dev server races on parallel route loads. CI keeps the same setting.
- **`useFirstLoad`** has a 500 ms StrictMode-replay window: tests that mount the same component twice quickly will both see `isFirstLoad === true`.
- **Audio in unit tests**: `setup.ts` stubs `HTMLMediaElement.prototype.play/pause/load` with Promise-returning mocks. jsdom doesn't decode audio.

---
paths:
  - "**/tests/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/vitest.config.ts"
  - "**/vitest.setup.ts"
  - "**/playwright.config.ts"
  - "**/package.json"
---

# Tests

## Never let two workspaces resolve different `vitest` majors

`@testing-library/jest-dom` does **not** depend on `vitest`, so the
`import 'vitest'` carrying its matcher augmentation resolves to whichever single
copy pnpm hoists to `node_modules/.pnpm/node_modules/vitest`. With one version in
the tree that's unambiguous. Add a workspace on a different major and pnpm hoists
one of them — if it picks the other one, jest-dom augments a `vitest` module
nobody type-checks against, and **every** `toBeInTheDocument` / `toHaveClass` /
`toHaveAttribute` in `packages/ui` fails with `TS2339: Property does not exist on
type 'Assertion<HTMLElement>'`.

The failure looks nothing like its cause: the errors land in `packages/ui` test
files that nobody touched, and the hoist can resolve differently on two machines,
so it reproduces in CI while `pnpm -C packages/ui tsc` passes locally. It cost a
full diagnostic pass — versions, lockfile, incremental state, filename casing and
`node_modules` drift all had to be eliminated first. Every workspace is on
`vitest` `^4.1.5`; keep it that way, and if a new workspace genuinely needs
another major, expect this and pin the hoist rather than discovering it in CI.

## Never make `apps/web/vitest.config.ts` extend `vite.config.ts`

It is standalone deliberately: the `tanstackStart` plugin sets up SSR routing
that conflicts with isolated test rendering.

## Layout and conventions

- `apps/web/tests/unit/` — Vitest + jsdom, one folder per concern: `store/`, `hooks/`, `components/`, `utils/`, `data/`, `routes/`, `scripts/`.
- `apps/web/tests/e2e/` — Playwright, four projects (chromium, webkit, mobile-chrome, mobile-safari). Mocks `*.mp3` with a silent fixture.
- `apps/web/tests/setup.ts` — jest-dom matchers + `HTMLMediaElement` stubs (jsdom doesn't decode audio).
- `playwright.config.ts` uses `workers: 1` — Vite's dev server races on parallel route loads.
- Each app's `playwright.config.ts` boots its own `vite dev` on a port hashed from the checkout path (`tests/e2e/_port.ts`; web 4200–4699, admin 4700–5199, `E2E_PORT` overrides), with `--strictPort` and `reuseExistingServer: false`. Two worktrees can run e2e at once, and a suite never attaches to a `pnpm dev` someone started by hand. Keep the two ranges apart and off 5173/5174/4173/4174.
- Click handlers calling `playTrack` rely on the module-level `audioEl` ref in `playerSlice.ts`; register a fake element with `registerAudioElement()` in `beforeEach`.
- Conventions and how to add one: `apps/web/tests/README.md`.
- `packages/ui/vitest.setup.ts` wires jest-dom and calls `installDialogPolyfill()` — the polyfill itself is `packages/ui/src/domPolyfills.ts` (jsdom implements no `HTMLDialogElement.showModal()`).
- `packages/ui` interaction tests: see the two traps in `design-system-and-styling.md`.
- `packages/data/tests/helpers/sqliteD1.ts` — a `D1Database` stand-in on real SQLite (`node:sqlite`), built from `apps/web/schema.sql`. Use it for queries whose correctness rests on the SQL itself (conditional WHEREs, `batch`), where a hand-written fake would only return what the test expects. It runs statements one after another, so it proves the WHERE clauses, not D1's concurrency.

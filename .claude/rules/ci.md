---
paths:
  - ".github/workflows/**"
---

# CI/CD

## Never let `ci.yml` and `deploy.yml` share a Playwright browser cache key

Caches live at `~/.cache/ms-playwright`, keyed on **browser set + `pnpm-lock.yaml`
hash**. The workflows install different sets (ci: chromium+webkit, deploy:
chromium only). Sharing a key means first-writer-wins poisoning — the second
workflow finds a cache hit for browsers it doesn't have. The macOS Story job has
its own key too.

## Workflows

- **`ci.yml`** on push (non-main) + PR. Jobs:
  - `static`: per-workspace Biome lint for `apps/web`, `apps/admin`, `packages/ui`, `packages/data` and `apps/rum-archiver`, plus `turbo tsc` across all of them, plus a Vite build of both apps.
  - `knip`.
  - `hooks`: `bash .claude/hooks/tests/run.sh`, the Claude Code hook tests. Needs `pnpm install` first for Biome.
  - `unit`: all five workspaces.
  - `sets-snapshot`: regenerates `sets.generated.ts` from live D1 and fails on drift from the committed copy.
  - `chromatic`: visual regression for `packages/ui`.
  - `e2e`: Playwright on chromium + webkit for both apps, on `ubuntu-24.04` rather than `ubuntu-latest` (Playwright's `install-deps` has no package list for 26.04). `deploy.yml`'s `e2e` is pinned the same way.
  - `e2e-story-video`: the Story video tests that record H.264 + AAC MP4 for real, on `macos-latest`. Linux Chromium has no such encoders, so on Linux `story-video.spec.ts` skips by name and `story-picker.spec.ts`'s create flow fakes MediaRecorder.
- **`deploy.yml`** on push to `main`, plus manual `workflow_dispatch`.
  - Re-runs `static`/`unit`/`e2e`, then `deploy` and `deploy-admin` only if all pass, so a direct push to `main` can't skip the suite.
  - Deliberately **not** `chromatic`, which stays PR-only to avoid roughly doubling snapshot quota.
- **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CHROMATIC_PROJECT_TOKEN`.

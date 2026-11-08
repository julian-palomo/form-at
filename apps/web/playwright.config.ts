import { defineConfig, devices } from "@playwright/test";
import { e2ePort } from "./tests/e2e/_port";

// 4200-4699 here, 4700-5199 in apps/admin: clear of the dev servers (5173,
// 5174) and the previews (4173, 4174), so the suite never reaches a server a
// person started by hand. Hashed per checkout: see tests/e2e/_port.ts.
const PORT = e2ePort(4200, 500);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Vite's dev server occasionally races on parallel route loads. Keep workers
  // serial — the suite is still fast (<15s) and stable. CI gets retries.
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],

  // Boots its own dev server on PORT, the same `vite dev` as `pnpm dev`.
  // `--strictPort` fails fast instead of drifting to a free port the tests
  // don't know about; never reusing a server keeps a worktree's suite off a
  // server another worktree, or a person, started.
  webServer: {
    command: `pnpm exec vite dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

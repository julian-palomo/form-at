import { defineConfig, devices } from "@playwright/test";
import { e2ePort } from "./tests/e2e/_port";

// 4700-5199 here, 4200-4699 in apps/web: the two suites run in the same CI
// job and never share a port, and both stay clear of the dev servers (5173,
// 5174) and the previews (4173, 4174). Hashed per checkout: see
// tests/e2e/_port.ts.
const PORT = e2ePort(4700, 500);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
  ],

  // Same reasoning as apps/web's config: own server on PORT, strict, never
  // reused.
  webServer: {
    command: `pnpm exec vite dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

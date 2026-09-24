import { defineConfig, devices } from "@playwright/test";

// Dedicated port, distinct from the usual `next dev` 3000, so this suite
// never collides with a dev server a human already has running locally.
const PORT = 3300;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Real end-to-end suite: drives the actual Next.js app (via `next dev`) in
 * a real browser against the local Docker Postgres (`.env`'s
 * DATABASE_URL) -- never a deployed/shared database. Not wired into CI by
 * request; run locally via `pnpm e2e` (see apps/web/package.json).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
      testIgnore: /.*\.setup\.ts/,
    },
  ],
});

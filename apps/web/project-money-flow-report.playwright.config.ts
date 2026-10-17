import { defineConfig, devices } from "@playwright/test";

/**
 * Dedicated ad-hoc config for the Project Money Flow Report e2e spec only --
 * mirrors `split-payment.playwright.config.ts`'s exact rationale: the repo's
 * main playwright.config.ts spawns its own `next dev -p 3300`, which
 * collides with the already-running dev server on :3000 that this working
 * tree has up (Next.js refuses a second dev instance against the same
 * project directory, regardless of port). Rather than edit the shared
 * config (used by every other e2e spec), this points straight at the
 * existing :3000 server and skips webServer management entirely.
 */
const BASE_URL = "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["project-money-flow-report.spec.ts", "project-money-flow-report.setup.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: [["line"]],
  globalSetup: "./e2e/global-setup.ts",
  expect: { timeout: 20_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "setup", testMatch: /project-money-flow-report\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/project-money-flow-report-user.json" },
      dependencies: ["setup"],
      testIgnore: /project-money-flow-report\.setup\.ts/,
    },
  ],
});

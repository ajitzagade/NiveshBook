import path from "node:path";
import { test as setup, expect } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD } from "./test-credentials";

const authFile = path.join(__dirname, ".auth/user.json");

/**
 * Playwright's standard "setup project" pattern: log in once via the real
 * UI, save the resulting session cookie, and every other spec reuses it via
 * `storageState` (see playwright.config.ts) instead of re-logging in per
 * test.
 */
setup("authenticate", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("You're logged in.")).toBeVisible();
  await page.context().storageState({ path: authFile });
});

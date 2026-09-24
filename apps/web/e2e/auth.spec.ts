import { test, expect } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD } from "./test-credentials";

// Overrides the project's authenticated `storageState` (see
// playwright.config.ts) -- these tests are specifically about the
// unauthenticated/login flow itself, so they must start with no session.
test.use({ storageState: { cookies: [], origins: [] } });

test("redirects an unauthenticated visitor to the login form, not the dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByText("You're logged in.")).not.toBeVisible();
});

test("shows an inline error for wrong credentials, without navigating away", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("logs in with valid credentials and can log out again", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByText("You're logged in.")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
});

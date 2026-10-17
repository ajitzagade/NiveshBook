import path from "node:path";
import { test as setup, expect } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD } from "./test-credentials";

const authFile = path.join(__dirname, ".auth/project-money-flow-report-user.json");

/** Dedicated login setup for the Project Money Flow Report e2e run -- mirrors split-payment.setup.ts exactly, kept separate so this run never touches auth.setup.ts's shared storage state file. */
setup("authenticate", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("You're logged in.")).toBeVisible();
  await page.context().storageState({ path: authFile });
});

import { test, expect } from "@playwright/test";

/**
 * e2e coverage for the Project Money Flow Report (Owner/Admin-only
 * downloadable PDF covering one or more Projects' complete picture) --
 * mirrors `split-payment.spec.ts`'s established create-Project-and-fund-it
 * setup shape. This is the one layer that genuinely exercises the harder
 * parts a route/unit test can't: real off-screen diagram capture
 * (`capture-flow-diagram.tsx`) and a real browser file download.
 */

function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createFundedProject(page: import("@playwright/test").Page, label: string) {
  const projectName = uniqueName(label);

  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.locator(".nb-card").filter({ hasText: projectName }).getByRole("link", { name: "Partner Shares" }).click();
  await expect(page).toHaveURL(/\/shares$/);
  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("Report Partner");
  await page.locator("#partner-share-percent").fill("100");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();

  await page.goto(page.url().replace(/\/shares$/, "/add-money"));
  await page.getByRole("button", { name: "New Requirement" }).first().click();
  await page.locator("#requirement-amount").fill("1000000");
  await page.locator("#requirement-date").fill("2027-04-01");
  await page.getByRole("dialog", { name: "New Funding Requirement" }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Funding Requirement" }).getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Should Pay" }).click();
  await page.getByRole("button", { name: "Report Partner" }).click();
  await page.getByRole("button", { name: "Add Investment" }).first().click();
  await page.locator("#tx-amount-0").fill("600000");
  await page.locator("#tx-date").fill("2027-04-02");
  await page.getByRole("dialog", { name: /^Add Investment/ }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Payment" }).getByRole("button", { name: "Confirm" }).click();

  return projectName;
}

test("Project Money Flow Report: generating for one Project produces a real, non-trivial PDF download", async ({ page }) => {
  const projectName = await createFundedProject(page, "E2E Money Flow Report Project");

  await page.goto("/reports");
  await page.getByRole("link", { name: /Project Money Flow Report/ }).click();
  await expect(page).toHaveURL(/\/reports\/project-money-flow$/);

  await page.getByLabel(projectName, { exact: true }).check();

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Generate PDF Report" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const fs = await import("node:fs");
  const stats = fs.statSync(downloadPath!);
  expect(stats.size).toBeGreaterThan(20_000);
});

test("Project Money Flow Report: generating for two Projects at once produces one combined PDF download", async ({ page }) => {
  const projectAName = await createFundedProject(page, "E2E Money Flow Multi A");
  const projectBName = await createFundedProject(page, "E2E Money Flow Multi B");

  await page.goto("/reports/project-money-flow");
  await page.getByLabel(projectAName, { exact: true }).check();
  await page.getByLabel(projectBName, { exact: true }).check();

  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  await page.getByRole("button", { name: "Generate PDF Report" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const fs = await import("node:fs");
  const stats = fs.statSync(downloadPath!);
  // Two Projects' worth of tables + 6 diagram images should clearly exceed
  // a single-Project report's size -- a cheap proxy that both Projects'
  // sections actually made it into the one combined document.
  expect(stats.size).toBeGreaterThan(30_000);
});

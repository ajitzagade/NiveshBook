import { test, expect } from "@playwright/test";

function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createProject(page: import("@playwright/test").Page, name: string) {
  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  // Projects list is a card grid, not a table (founder feedback 2026-09-27
  // redesign) -- scope to this Project's own `.nb-card` by its unique name,
  // then its "Partner Shares" action button (renamed from a plain "Shares"
  // table-row link).
  await page.locator(".nb-card").filter({ hasText: name }).getByRole("link", { name: "Partner Shares" }).click();
  await expect(page).toHaveURL(/\/shares$/);
}

test("adds two Partner Shares and the running total reflects both", async ({ page }) => {
  const projectName = uniqueName("E2E Shares Project");
  await createProject(page, projectName);

  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("E2E Partner One");
  await page.locator("#partner-share-percent").fill("60");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total is 60%. 40% is still remaining.")).toBeVisible();

  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("E2E Partner Two");
  await page.locator("#partner-share-percent").fill("40");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();
});

test("editing a Partner's Share % updates the row and the running total", async ({ page }) => {
  const projectName = uniqueName("E2E Edit Share Project");
  await createProject(page, projectName);

  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("E2E Editable Partner");
  await page.locator("#partner-share-percent").fill("50");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total is 50%. 50% is still remaining.")).toBeVisible();

  // ShareRow is a styled `div`, not a real table row, so there's no
  // `role="row"` to scope by -- find the exact-matching name label, then
  // scope to its parent row for the sibling "Edit" button.
  await page
    .getByText("E2E Editable Partner", { exact: true })
    .locator("xpath=..")
    .getByRole("button", { name: "Edit" })
    .click();
  await page.locator("#partner-share-percent").fill("75");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total is 75%. 25% is still remaining.")).toBeVisible();
});

test("adding a Sub-partner refreshes the still-expanded parent panel without a reload", async ({ page }) => {
  const projectName = uniqueName("E2E Sub-partner Refresh Project");
  await createProject(page, projectName);

  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("E2E Parent Partner");
  await page.locator("#partner-share-percent").fill("100");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();

  const card = page
    .getByText("E2E Parent Partner", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'nb-person-card')][1]")
    .first();
  await card.getByRole("button", { name: /^Sub-partners(\s*\(\d+\))?$/ }).click();
  await expect(card.getByText("No Sub-partners yet for E2E Parent Partner.")).toBeVisible();

  await card.getByRole("button", { name: "Add Sub-partner" }).click();
  await page.locator("#partner-name").fill("E2E Sub One");
  await page.locator("#partner-share-percent").fill("40");
  await page.getByRole("button", { name: "Save" }).click();

  // Still expanded (never collapsed/reloaded) -- must show the just-added
  // row and updated allocation immediately, not the pre-add empty state.
  await expect(card.getByText("No Sub-partners yet for E2E Parent Partner.")).not.toBeVisible();
  await expect(card.getByText("E2E Sub One", { exact: true })).toBeVisible();
  await expect(card.getByText("Allocated: 40% (60% remaining)")).toBeVisible();

  // A second add on the same still-expanded panel must also refresh
  // correctly, not just the first.
  await card.getByRole("button", { name: "Add Sub-partner" }).click();
  await page.locator("#partner-name").fill("E2E Sub Two");
  await page.locator("#partner-share-percent").fill("60");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(card.getByText("E2E Sub Two", { exact: true })).toBeVisible();
  await expect(card.getByText("Allocated: 100% ✓")).toBeVisible();
});

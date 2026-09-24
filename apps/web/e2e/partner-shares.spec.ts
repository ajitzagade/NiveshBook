import { test, expect } from "@playwright/test";

function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createProject(page: import("@playwright/test").Page, name: string) {
  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Save Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.getByRole("row", { name: name }).getByRole("link", { name: "Shares" }).click();
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

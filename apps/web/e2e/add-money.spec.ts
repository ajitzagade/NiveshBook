import { test, expect } from "@playwright/test";

function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

test("creates a funding requirement and it appears in the list with a confirmation toast", async ({
  page,
}) => {
  const projectName = uniqueName("E2E Add Money Project");

  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Save Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page
    .getByRole("row", { name: projectName })
    .getByRole("link", { name: "Add Money" })
    .click();
  await expect(page).toHaveURL(/\/add-money$/);

  await page.getByRole("button", { name: "New Requirement" }).first().click();
  await page.locator("#requirement-amount").fill("1000000");
  await page.locator("#requirement-date").fill("2027-01-15");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("₹10,00,000 created for 2027-01-15")).toBeVisible();
  await expect(page.getByRole("cell", { name: "₹10,00,000" })).toBeVisible();
});

test("records a payment against a Partner's Should Pay and shows a confirmation toast", async ({
  page,
}) => {
  const projectName = uniqueName("E2E Record Payment Project");

  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Save Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  const row = page.getByRole("row", { name: projectName });
  await row.getByRole("link", { name: "Shares" }).click();
  await expect(page).toHaveURL(/\/shares$/);
  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("E2E Payer");
  await page.locator("#partner-share-percent").fill("100");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();

  await page.goto(page.url().replace(/\/shares$/, "/add-money"));
  await page.getByRole("button", { name: "New Requirement" }).first().click();
  await page.locator("#requirement-amount").fill("500000");
  await page.locator("#requirement-date").fill("2027-02-01");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("₹5,00,000 created for 2027-02-01")).toBeVisible();

  await page.getByRole("button", { name: "Should Pay" }).click();
  await page.getByRole("button", { name: "Record Payment" }).first().click();
  await page.locator("#tx-amount").fill("500000");
  await page.locator("#tx-date").fill("2027-02-02");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("₹5,00,000 recorded for E2E Payer")).toBeVisible();
});

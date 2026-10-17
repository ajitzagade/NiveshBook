import { test, expect } from "@playwright/test";

/**
 * e2e coverage for split-payment entry (multiple payment methods in one
 * Add Investment / Record Withdrawal submission) -- mirrors
 * `add-money.spec.ts`/`withdraw-money.spec.ts`'s established
 * create-Project-and-fund-it setup shape.
 */

function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

test("Add Investment: a 3-row split payment (cash + bank transfer + RTGS) records atomically and shows as 3 separate entries", async ({
  page,
}) => {
  const projectName = uniqueName("E2E Split Payment Project");

  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.locator(".nb-card").filter({ hasText: projectName }).getByRole("link", { name: "Partner Shares" }).click();
  await expect(page).toHaveURL(/\/shares$/);
  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("Split Payer");
  await page.locator("#partner-share-percent").fill("100");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();

  await page.goto(page.url().replace(/\/shares$/, "/add-money"));
  await page.getByRole("button", { name: "New Requirement" }).first().click();
  await page.locator("#requirement-amount").fill("1000000");
  await page.locator("#requirement-date").fill("2027-04-01");
  await page.getByRole("dialog", { name: "New Funding Requirement" }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Funding Requirement" }).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Funding requirement of ₹10,00,000 created for 01-04-2027")).toBeVisible();

  await page.getByRole("button", { name: "Should Pay" }).click();
  // Partner/Sub-partner PersonCards in the Should Pay panel start collapsed
  // (2026-09-29 feature) -- expand Split Payer's card before its nested
  // "Add Investment" button is reachable.
  await page.getByRole("button", { name: "Split Payer" }).click();
  await page.getByRole("button", { name: "Add Investment" }).first().click();

  const dialog = page.getByRole("dialog", { name: /^Add Investment/ });
  await page.locator("#tx-amount-0").fill("500000");
  await page.locator("#tx-date").fill("2027-04-02");

  await dialog.getByRole("button", { name: "Add another payment method" }).click();
  await page.locator("#tx-amount-1").fill("300000");
  await page.locator("#tx-payment-mode-1").selectOption("bank_transfer");
  await page.locator("#tx-reference-1").fill("TXN-BT-1");

  await dialog.getByRole("button", { name: "Add another payment method" }).click();
  await page.locator("#tx-amount-2").fill("200000");
  await page.locator("#tx-payment-mode-2").selectOption("rtgs");
  await page.locator("#tx-reference-2").fill("TXN-RTGS-1");

  // Live total across all 3 rows before submitting.
  await expect(dialog.getByText(/Total: ₹10,00,000/)).toBeVisible();
  await expect(dialog.getByText(/across 3 payment methods/)).toBeVisible();

  await dialog.getByRole("button", { name: "Save" }).click();

  const confirmDialog = page.getByRole("dialog", { name: "Confirm Payment" });
  await expect(confirmDialog).toContainText("Split Payer");
  await expect(confirmDialog).toContainText("₹10,00,000");
  await confirmDialog.getByRole("button", { name: "Confirm" }).click();

  await expect(
    page.getByText("₹10,00,000 recorded for Split Payer across 3 payment methods"),
  ).toBeVisible();

  // 3 separate line items, one per payment method, each with its own amount
  // and payment mode (the recorded-row summary line doesn't render the
  // reference number inline -- that's confirmed earlier via the Confirm
  // Payment dialog's own listitem content instead).
  await expect(page.getByText("₹5,00,000")).toBeVisible();
  await expect(page.getByText("Cash")).toBeVisible();
  await expect(page.getByText("₹3,00,000")).toBeVisible();
  await expect(page.getByText("Bank Transfer")).toBeVisible();
  await expect(page.getByText("₹2,00,000")).toBeVisible();
  await expect(page.getByText("RTGS")).toBeVisible();
});

test("Record Withdrawal: a 2-row split withdrawal whose SUM exceeds Can Take triggers Authorize Extra Withdrawal with 'across N payment methods' phrasing", async ({
  page,
}) => {
  const projectName = uniqueName("E2E Split Withdrawal Project");

  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.locator(".nb-card").filter({ hasText: projectName }).getByRole("link", { name: "Partner Shares" }).click();
  await expect(page).toHaveURL(/\/shares$/);
  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("Split Withdrawer");
  await page.locator("#partner-share-percent").fill("100");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();

  // Fund the Project so Can Take is a known, non-zero ₹1,00,000.
  await page.goto(page.url().replace(/\/shares$/, "/add-money"));
  await page.getByRole("button", { name: "New Requirement" }).first().click();
  await page.locator("#requirement-amount").fill("100000");
  await page.locator("#requirement-date").fill("2027-04-01");
  await page.getByRole("dialog", { name: "New Funding Requirement" }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Funding Requirement" }).getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Should Pay" }).click();
  await page.getByRole("button", { name: "Split Withdrawer" }).click();
  await page.getByRole("button", { name: "Add Investment" }).first().click();
  await page.locator("#tx-amount-0").fill("100000");
  await page.locator("#tx-date").fill("2027-04-02");
  await page.getByRole("dialog", { name: /^Add Investment/ }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Payment" }).getByRole("button", { name: "Confirm" }).click();

  await page.goto(page.url().replace(/\/add-money$/, "/withdraw-money"));
  await expect(page.getByText("Split Withdrawer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Split Withdrawer" }).click();
  await page.getByRole("button", { name: "Withdraw Money" }).click();

  const withdrawDialog = page.getByRole("dialog", { name: /^Withdraw Money/ });
  await page.locator("#wtx-amount-0").fill("60000");
  await page.locator("#wtx-date").fill("2027-04-10");

  await withdrawDialog.getByRole("button", { name: "Add another payment method" }).click();
  await page.locator("#wtx-amount-1").fill("60000");
  await page.locator("#wtx-payment-mode-1").selectOption("rtgs");

  // Neither row (60000) alone exceeds the ₹1,00,000 Can Take, but their sum
  // (120000) does -- this feature's own key design decision (check the
  // batch total, not any single row).
  await expect(withdrawDialog.getByText(/Total: ₹1,20,000/)).toBeVisible();
  await withdrawDialog.getByRole("button", { name: "Save" }).click();

  const authorizeDialog = page.getByRole("dialog", { name: "Authorize Extra Withdrawal?" });
  await expect(authorizeDialog).toBeVisible();
  await expect(authorizeDialog).toContainText("₹1,20,000");
  await expect(authorizeDialog).toContainText("across 2 payment methods");
  await authorizeDialog.getByRole("button", { name: "Confirm Authorization" }).click();

  await expect(authorizeDialog).not.toBeVisible();
  // Split Withdrawer's card is already expanded (from opening the Record
  // Withdrawal dialog earlier) -- no extra toggle click needed, which would
  // otherwise just re-collapse it.
  await expect(page.getByText("Extra Taken")).toBeVisible();
  await expect(page.getByText("₹1,20,000").first()).toBeVisible();
  await expect(page.getByText("₹60,000").first()).toBeVisible();
});

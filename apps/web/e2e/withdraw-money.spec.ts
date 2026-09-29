import { test, expect } from "@playwright/test";

/**
 * e2e coverage for the redesigned Withdrawal flow (2026-09-28): "Distribute
 * a Withdrawal" (total amount -> auto-suggested per-Partner split -> manual
 * per-row edit -> validation -> per-row withdrawal_transaction records) and
 * the "Authorize Extra Withdrawal?" over-allocation gate. Mirrors
 * `add-money.spec.ts`'s established create-Project-and-fund-it setup shape.
 *
 * A realistic laptop-sized viewport (2026-09-29 fix): this suite used to
 * paper over a real bug with an inflated 1400x1400 viewport -- `DialogContent`
 * (`packages/ui/src/components/dialog.tsx`) had no `max-h`/`overflow-y-auto`
 * at all, so any dialog taller than the viewport (like "Distribute a
 * Withdrawal" with 5 rows) rendered with its top AND bottom clipped off-screen
 * and no way to scroll to reach them -- confirmed live via a founder-reported
 * screenshot. Now that `DialogContent` itself scrolls internally
 * (`max-h-[90vh] overflow-y-auto`), a normal viewport plus an explicit
 * `scrollIntoViewIfNeeded()` on "Save Distribution" is the real regression
 * test for this -- a `position: fixed` element with no internal overflow
 * can't be scrolled into view at all, so this fails loudly if the fix ever
 * regresses, rather than silently passing because the viewport was inflated
 * to hide the symptom.
 */
test.use({ viewport: { width: 1280, height: 800 } });

function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createProjectWithTwoPartners(page: import("@playwright/test").Page, projectName: string) {
  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.locator(".nb-card").filter({ hasText: projectName }).getByRole("link", { name: "Partner Shares" }).click();
  await expect(page).toHaveURL(/\/shares$/);

  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("Dist Partner A");
  await page.locator("#partner-share-percent").fill("60");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total is 60%. 40% is still remaining.")).toBeVisible();

  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("Dist Partner B");
  await page.locator("#partner-share-percent").fill("40");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();
}

/** Creates a funding requirement and records one investment against it, so `availableToWithdraw` is non-zero. */
async function fundProject(page: import("@playwright/test").Page, amount: string, date: string) {
  await page.goto(page.url().replace(/\/shares$/, "/add-money"));
  await page.getByRole("button", { name: /new requirement/i }).first().click();
  await page.locator("#requirement-amount").fill(amount);
  await page.locator("#requirement-date").fill(date);
  await page.getByRole("dialog", { name: "New Funding Requirement" }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Funding Requirement" }).getByRole("button", { name: "Confirm" }).click();

  await page.getByRole("button", { name: "Should Pay" }).click();
  // The per-Partner breakdown expands asynchronously ("Loading Should Pay…")
  // -- clicking before it settles silently finds nothing (confirmed live:
  // this is exactly what produced a real, reproducible "₹0 is available to
  // withdraw" bug in an earlier draft of this test).
  const addInvestmentButtons = page.getByRole("button", { name: "Add Investment" });
  await expect(addInvestmentButtons.first()).toBeVisible();
  // Record ONE investment for the full `amount`, against whichever Partner's
  // row happens to be first -- Can Take is proportional to Share %, not to
  // who recorded the investment, so this is enough to make
  // `availableToWithdraw` exactly `amount`. Looping over every Partner's own
  // "Add Investment" row with the full amount each (an earlier draft of this
  // helper did) double/multi-funds the Project instead, silently invalidating
  // every Can-Take-relative assumption downstream (confirmed live: this is
  // exactly what made the over-allocation test's own "80000 exceeds Partner
  // A's 60000 Can Take" assumption false once the real available-to-withdraw
  // was actually 200000, not 100000 -- the Authorize gate correctly never
  // fired, because there genuinely was no over-allocation to gate).
  await addInvestmentButtons.first().click();
  await page.locator("#tx-amount").fill(amount);
  await page.locator("#tx-date").fill(date);
  await page.getByRole("dialog", { name: /^Add Investment/ }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Payment" }).getByRole("button", { name: "Confirm" }).click();
}

test("Distribute a Withdrawal: auto-suggests a per-Partner split, blocks a mismatched total, then records each row once fixed", async ({
  page,
}) => {
  const projectName = uniqueName("E2E Distribute Project");
  await createProjectWithTwoPartners(page, projectName);
  await fundProject(page, "100000", "2027-03-01");

  await page.goto(page.url().replace(/\/add-money$/, "/withdraw-money"));
  await expect(page.getByRole("button", { name: "Withdraw Money" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Distribute a Withdrawal" })).toBeVisible();

  await page.getByRole("button", { name: "Distribute a Withdrawal" }).click();
  await page.getByLabel("Total Withdrawal Amount").fill("50000");

  const actualInputs = page.locator('input[aria-label^="Actual withdrawal"]');
  await expect(actualInputs).toHaveCount(2);
  // Auto-suggested: 60/40 split of 50000 -> 30000/20000.
  await expect(actualInputs.nth(0)).toHaveValue("30000.00");
  await expect(actualInputs.nth(1)).toHaveValue("20000.00");

  // Probe: a mismatched total is blocked, with no partial save.
  await actualInputs.nth(0).fill("99999");
  await page.getByLabel("Date").fill("2027-03-05");
  const saveDistributionButton = page.getByRole("button", { name: "Save Distribution" });
  // Explicit regression proof for the dialog-scroll fix (2026-09-29, see
  // this file's own top-of-file comment): a `position: fixed` dialog with
  // no internal overflow can't be scrolled into view at all, so this fails
  // loudly (not just a slow/flaky `.click()`) if `DialogContent`'s
  // `max-h`/`overflow-y-auto` ever regresses.
  await saveDistributionButton.scrollIntoViewIfNeeded();
  await expect(saveDistributionButton).toBeInViewport();
  await saveDistributionButton.click();
  await expect(page.getByText("The Actual amounts must add up to exactly the Total Withdrawal amount.")).toBeVisible();

  // Fix it back to a valid split and save for real.
  await actualInputs.nth(0).fill("30000");
  await actualInputs.nth(1).fill("20000");
  await page.getByRole("button", { name: "Save Distribution" }).click();

  await expect(page.getByLabel("Total Withdrawal Amount")).not.toBeVisible();
  await expect(page.getByText("2027-03-05").first()).toBeVisible();
  await expect(page.getByText("₹30,000").first()).toBeVisible();
  await expect(page.getByText("₹20,000").first()).toBeVisible();
});

test("Distribute a Withdrawal: a row exceeding its own Can Take requires explicit 'Authorize Extra Withdrawal?' confirmation", async ({
  page,
}) => {
  const projectName = uniqueName("E2E Extra Withdrawal Project");
  await createProjectWithTwoPartners(page, projectName);
  await fundProject(page, "100000", "2027-03-01");

  await page.goto(page.url().replace(/\/add-money$/, "/withdraw-money"));
  await page.getByRole("button", { name: "Distribute a Withdrawal" }).click();
  await page.getByLabel("Total Withdrawal Amount").fill("100000");

  const actualInputs = page.locator('input[aria-label^="Actual withdrawal"]');
  // Partner A's own Can Take is 60000 (60% of 100000) -- 80000 exceeds it.
  await actualInputs.nth(0).fill("80000");
  await actualInputs.nth(1).fill("20000");
  await page.getByLabel("Date").fill("2027-03-06");
  await page.getByRole("button", { name: "Save Distribution" }).click();

  const authorizeDialog = page.getByRole("dialog", { name: "Authorize Extra Withdrawal?" });
  await expect(authorizeDialog).toBeVisible();
  await expect(authorizeDialog).toContainText("Dist Partner A");
  await authorizeDialog.getByRole("button", { name: "Confirm & Save" }).click();

  // Authorizing Partner A's over-take reallocates the pool, which can push
  // Partner B over THEIR own ceiling in the same submission -- a real,
  // confirmed, retry-safe behavior (not a bug): the dialog stays open,
  // already-saved rows are skipped on retry, and it can take a second "Save
  // Distribution" (with its own possible second Authorize prompt) to finish.
  // Handle both outcomes rather than assuming one Confirm always finishes it.
  const totalField = page.getByLabel("Total Withdrawal Amount");
  if (await totalField.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Save Distribution" }).click();
    if (await authorizeDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await authorizeDialog.getByRole("button", { name: "Confirm & Save" }).click();
    }
  }

  await expect(totalField).not.toBeVisible();
  await expect(page.getByText("₹80,000").first()).toBeVisible();
  await expect(page.getByText("₹20,000").first()).toBeVisible();
});

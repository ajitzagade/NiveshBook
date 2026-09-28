import { test, expect } from "@playwright/test";

/**
 * e2e coverage for Partner/Sub-partner self-service Add Money & Withdraw
 * Money (2026-09-29): the whole point of this feature is that a Partner
 * pays their own investment and withdraws their own money WITHOUT an
 * Owner/Admin recording it on their behalf -- so this suite deliberately
 * does every money-moving step (paying the funding requirement, taking a
 * withdrawal) from the Partner's own logged-in session, never the
 * owner_admin one. The Owner/Admin only creates the Project, the Partner
 * Share, and the funding requirement itself (creating a requirement stays
 * Owner/Admin-only by this feature's own scope).
 */

function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

test("a Partner pays their own funding requirement and withdraws their own money, entirely self-service", async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const projectName = uniqueName("E2E Self-Service Project");
  const partnerEmail = `e2e-self-service-partner-${stamp}@example.com`;

  // --- Owner/Admin setup: Project, one 100%-share Partner with a linked login, one funding requirement. ---
  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.locator(".nb-card").filter({ hasText: projectName }).getByRole("link", { name: "Partner Shares" }).click();
  await expect(page).toHaveURL(/\/shares$/);
  const projectId = page.url().match(/projects\/([^/]+)\//)?.[1];
  expect(projectId).toBeTruthy();

  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("E2E Self-Service Partner");
  await page.locator("#partner-share-percent").fill("100");
  await page.getByLabel("Linked user").click();
  await page.getByText("+ Add New User", { exact: true }).click();
  await page.getByLabel("User's name").fill("E2E Self-Service Partner User");
  await page.getByLabel("Email").fill(partnerEmail);
  await page.getByRole("button", { name: "Create User" }).click();
  await page.waitForSelector("text=/Done/i");
  const partnerPassword = await page.locator("input[readonly]").first().inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();

  await page.goto(page.url().replace(/\/shares$/, "/add-money"));
  await page.getByRole("button", { name: /new requirement/i }).first().click();
  await page.locator("#requirement-amount").fill("100000");
  await page.locator("#requirement-date").fill("2027-04-01");
  await page.getByRole("dialog", { name: "New Funding Requirement" }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Funding Requirement" }).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("₹1,00,000 created for 2027-04-01")).toBeVisible();

  // --- Fresh, unauthenticated context: log in as the Partner. ---
  const partnerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const partnerPage = await partnerContext.newPage();
  await partnerPage.goto("/");
  await partnerPage.getByLabel("Email").fill(partnerEmail);
  await partnerPage.getByLabel("Password").fill(partnerPassword);
  await partnerPage.getByRole("button", { name: "Log in" }).click();
  await expect(partnerPage.getByText("You're logged in.")).toBeVisible();
  await partnerPage.getByRole("link", { name: "Go to dashboard" }).click();
  await expect(partnerPage).toHaveURL(/\/home/);

  // The Home card exposes both self-service entry points.
  const projectCard = partnerPage.locator(".nb-card").filter({ hasText: projectName });
  await expect(projectCard.getByRole("link", { name: "Add Money" })).toBeVisible();
  await expect(projectCard.getByRole("link", { name: "Withdraw" })).toBeVisible();

  // --- Partner pays their own funding requirement, self-service. ---
  await projectCard.getByRole("link", { name: "Add Money" }).click();
  await expect(partnerPage).toHaveURL(/\/add-money\//);
  await expect(partnerPage.getByText("You don't have permission to do that.")).not.toBeVisible();

  await partnerPage.getByRole("button", { name: /Requirement of/ }).click();
  await expect(partnerPage.getByText("Should Pay")).toBeVisible();
  const actualPaidBefore = partnerPage.locator(".nb-card", { hasText: "Actual Paid" }).last();
  await expect(actualPaidBefore).toContainText("₹0");

  await partnerPage.getByRole("button", { name: "Add Investment" }).click();
  await partnerPage.locator("#my-tx-amount").fill("100000");
  await partnerPage.locator("#my-tx-date").fill("2027-04-02");
  await partnerPage.getByRole("dialog", { name: "Add Investment" }).getByRole("button", { name: "Save" }).click();

  await expect(partnerPage.getByText("Investment recorded.")).toBeVisible();
  await expect(partnerPage.locator(".nb-card", { hasText: "Actual Paid" }).last()).toContainText("₹1,00,000");

  // --- Partner withdraws their own money, self-service. ---
  await partnerPage.goto("/home");
  await partnerPage
    .locator(".nb-card")
    .filter({ hasText: projectName })
    .getByRole("link", { name: "Withdraw" })
    .click();
  await expect(partnerPage).toHaveURL(/\/withdraw-money\//);
  await expect(partnerPage.getByText("You don't have permission to do that.")).not.toBeVisible();
  await expect(partnerPage.locator(".nb-card", { hasText: "Can Take" }).first()).toContainText("₹1,00,000");

  await partnerPage.getByRole("button", { name: "Withdraw Money" }).click();
  await partnerPage.locator("#my-wtx-amount").fill("40000");
  await partnerPage.locator("#my-wtx-date").fill("2027-04-03");
  await partnerPage.getByRole("dialog", { name: "Withdraw Money" }).getByRole("button", { name: "Save" }).click();

  await expect(partnerPage.getByText("Withdrawal recorded.")).toBeVisible();
  await expect(partnerPage.locator(".nb-card", { hasText: "Effective Can Take" }).last()).toContainText("₹60,000");

  await partnerContext.close();
});

test("a Partner hand-editing the URL's partnerId to someone else's id gets rejected, never real data", async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const projectName = uniqueName("E2E Privacy Project");
  const partnerEmail = `e2e-privacy-partner-${stamp}@example.com`;

  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.locator(".nb-card").filter({ hasText: projectName }).getByRole("link", { name: "Partner Shares" }).click();
  await expect(page).toHaveURL(/\/shares$/);
  const projectId = page.url().match(/projects\/([^/]+)\//)?.[1];
  expect(projectId).toBeTruthy();

  await page.getByRole("button", { name: "Add Partner" }).first().click();
  await page.locator("#partner-name").fill("E2E Privacy Partner");
  await page.locator("#partner-share-percent").fill("100");
  await page.getByLabel("Linked user").click();
  await page.getByText("+ Add New User", { exact: true }).click();
  await page.getByLabel("User's name").fill("E2E Privacy Partner User");
  await page.getByLabel("Email").fill(partnerEmail);
  await page.getByRole("button", { name: "Create User" }).click();
  await page.waitForSelector("text=/Done/i");
  const partnerPassword = await page.locator("input[readonly]").first().inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Total Share: 100%")).toBeVisible();

  await page.goto(page.url().replace(/\/shares$/, "/add-money"));
  await page.getByRole("button", { name: /new requirement/i }).first().click();
  await page.locator("#requirement-amount").fill("200000");
  await page.locator("#requirement-date").fill("2027-05-01");
  await page.getByRole("dialog", { name: "New Funding Requirement" }).getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Confirm Funding Requirement" }).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("₹2,00,000 created for 2027-05-01")).toBeVisible();

  const partnerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const partnerPage = await partnerContext.newPage();
  await partnerPage.goto("/");
  await partnerPage.getByLabel("Email").fill(partnerEmail);
  await partnerPage.getByLabel("Password").fill(partnerPassword);
  await partnerPage.getByRole("button", { name: "Log in" }).click();
  await expect(partnerPage.getByText("You're logged in.")).toBeVisible();
  await partnerPage.getByRole("link", { name: "Go to dashboard" }).click();
  await expect(partnerPage).toHaveURL(/\/home/);

  // Hand-edit the URL: swap the real, self `?partnerId=` for an unrelated
  // random id nobody actually owns. The page's own initial load bundles
  // `getOwnershipStructure(projectId, { partnerId: <tampered id> })`
  // alongside the funding-requirements list -- ownership-structure's own
  // self-access re-resolves that EXACT scope independently against live DB
  // Share rows and rejects it (AD-1), so the whole page fails closed into
  // its generic error state before any real data (the requirements list
  // included) is ever shown -- confirmed live: even stronger than a
  // per-row failure, since there's no funding-requirements list to expand
  // at all.
  await partnerPage.goto(`/add-money/${projectId}?partnerId=00000000-0000-0000-0000-000000000000`);
  await expect(partnerPage.getByRole("alert")).toBeVisible();
  await expect(partnerPage.getByText("Should Pay")).not.toBeVisible();
  await expect(partnerPage.getByRole("button", { name: /Requirement of/ })).not.toBeVisible();

  await partnerContext.close();
});

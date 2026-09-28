import { test, expect } from "@playwright/test";

/**
 * e2e coverage for the Money Flow diagrams (2026-09-28 fixes): the
 * All-Projects view's Project-name search (added because at real Project
 * counts the unfiltered grid is illegible) and node draggability (brought
 * to parity with the per-Project canvas, which already had it), plus the
 * per-Project view's self-access fix -- a Partner/Sub-partner viewing
 * their own Project's Money Flow no longer 403s.
 */

function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

test.describe("All-Projects Money Flow", () => {
  // This suite's dev DB isn't truncated between runs (every spec file's own
  // doc comment says so), and `owner_admin` sees every Project system-wide
  // -- confirmed live that with 100+ accumulated Projects, /structure's own
  // per-Project balance+movement fetch (2 requests each) took well past the
  // default 30s test timeout to settle. Not a regression from today's fixes
  // specifically -- a genuine scale finding, flagged separately -- but this
  // suite still needs to reliably pass against the real, ever-growing DB it
  // runs against.
  test.setTimeout(90_000);

  test("Project-name search narrows the canvas down, and a node can be dragged", async ({ page }) => {
    const projectName = uniqueName("E2E Flow Search Project");

    await page.goto("/projects/new");
    await page.getByLabel("Name").fill(projectName);
    await page.getByRole("button", { name: "Create Project" }).click();
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/structure");
    await page.getByLabel("Search Projects").fill(projectName);

    const node = page.getByText(projectName, { exact: true });
    await expect(node).toBeVisible();

    const before = await node.boundingBox();
    expect(before).not.toBeNull();
    if (!before) return;

    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 160, before.y + before.height / 2 + 110, { steps: 10 });
    await page.mouse.up();

    const after = await node.boundingBox();
    expect(after).not.toBeNull();
    if (!after) return;
    // A real position change -- confirms nodesDraggable isn't false anymore
    // (2026-09-28 fix: brought to parity with the per-Project canvas).
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(20);
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(20);

    await expect(page.getByRole("button", { name: /reset layout/i })).toBeVisible();
  });

  test("a search matching nothing shows a dedicated empty state, not a blank canvas", async ({ page }) => {
    await page.goto("/structure");
    await page.getByLabel("Search Projects").fill("Definitely Not A Real Project Name XYZ123");
    await expect(page.getByText("No Projects match your search")).toBeVisible();
  });
});

test.describe("Per-Project Money Flow -- Partner self-access (2026-09-28 fix)", () => {
  test("a Partner viewing their own Project's Money Flow no longer gets 'You don't have permission to do that.'", async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const projectName = uniqueName("E2E Partner Flow Project");
    const partnerEmail = `e2e-flow-partner-${stamp}@example.com`;

    await page.goto("/projects/new");
    await page.getByLabel("Name").fill(projectName);
    await page.getByRole("button", { name: "Create Project" }).click();
    await expect(page).toHaveURL(/\/projects$/);

    await page.locator(".nb-card").filter({ hasText: projectName }).getByRole("link", { name: "Partner Shares" }).click();
    await expect(page).toHaveURL(/\/shares$/);
    const projectId = page.url().match(/projects\/([^/]+)\//)?.[1];
    expect(projectId).toBeTruthy();

    // Quick-add a linked Partner login, directly from the Add Partner dialog.
    await page.getByRole("button", { name: "Add Partner" }).first().click();
    await page.locator("#partner-name").fill("E2E Flow Partner");
    await page.locator("#partner-share-percent").fill("100");
    await page.getByLabel("Linked user").click();
    await page.getByText("+ Add New User", { exact: true }).click();
    await page.getByLabel("User's name").fill("E2E Flow Partner User");
    await page.getByLabel("Email").fill(partnerEmail);
    await page.getByRole("button", { name: "Create User" }).click();
    await page.waitForSelector("text=/Done/i");
    const partnerPassword = await page.locator("input[readonly]").first().inputValue();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Total Share: 100%")).toBeVisible();

    // Fresh, explicitly-unauthenticated context -- this suite's shared
    // storageState is the owner_admin session; a Partner login needs its
    // own. Explicit `storageState: { cookies: [], origins: [] }` (mirrors
    // `auth.spec.ts`'s identical override), not just an options-free
    // `newContext()` -- confirmed live that omitting it left this context
    // already authenticated as the shared owner_admin session.
    const partnerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const partnerPage = await partnerContext.newPage();
    await partnerPage.goto("/");
    await partnerPage.getByLabel("Email").fill(partnerEmail);
    await partnerPage.getByLabel("Password").fill(partnerPassword);
    await partnerPage.getByRole("button", { name: "Log in" }).click();
    await expect(partnerPage.getByText("You're logged in.")).toBeVisible();
    await partnerPage.getByRole("link", { name: "Go to dashboard" }).click();
    await expect(partnerPage).toHaveURL(/\/home/);

    await partnerPage.goto(`/structure/${projectId}`);
    await expect(partnerPage.getByText("You don't have permission to do that.")).not.toBeVisible();
    await expect(partnerPage.getByText("E2E Flow Partner", { exact: true })).toBeVisible();

    await partnerContext.close();
  });
});

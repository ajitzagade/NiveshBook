import { test, expect } from "@playwright/test";

/** Unique per run so repeated local runs never collide on name (this suite doesn't truncate the dev DB between runs). */
function uniqueName(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

test("creates a Project and can edit its name", async ({ page }) => {
  const originalName = uniqueName("E2E Project");
  const renamedTo = `${originalName} (renamed)`;

  await page.goto("/projects/new");
  await page.getByLabel("Name").fill(originalName);
  await page.getByRole("button", { name: "Create Project" }).click();

  await expect(page).toHaveURL(/\/projects$/);
  // Projects list is a card grid, not a table (founder feedback 2026-09-27
  // redesign) -- scope to this Project's own `.nb-card` by its unique name.
  const card = page.locator(".nb-card").filter({ hasText: originalName });
  await expect(card).toBeVisible();

  await card.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel("Name").fill(renamedTo);
  await page.getByRole("button", { name: "Save Changes" }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".nb-card").filter({ hasText: renamedTo })).toBeVisible();
});

test("Home's 'New Project' quick action links through to the new-Project form (2026-09-28: rewritten -- the empty-state-gated 'Go to Projects' link this test originally covered no longer exists; the Home dashboard was redesigned to always-visible ActionTiles, founder feedback 2026-09-26/27, not conditioned on an empty Projects list)", async ({
  page,
}) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "New Project" }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
});

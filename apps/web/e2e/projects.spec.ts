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
  await page.getByRole("button", { name: "Save Project" }).click();

  await expect(page).toHaveURL(/\/projects$/);
  // A plain string `name` does a case-insensitive substring match (unlike
  // RegExp, which would need escaping for the literal "(renamed)" below).
  const row = page.getByRole("row", { name: originalName });
  await expect(row).toBeVisible();

  await row.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel("Name").fill(renamedTo);
  await page.getByRole("button", { name: "Save Changes" }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("row", { name: renamedTo })).toBeVisible();
});

test("Home's placeholder empty state links through to Projects", async ({ page }) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "Go to Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

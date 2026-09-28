import { test, expect } from "@playwright/test";

/**
 * spec-partner-hierarchy-cards Verification: computed-style measurement, not
 * an eyeballed screenshot (AGENTS.md's UI build gotcha section -- a wrong
 * tint or a clipped button is invisible to lint/typecheck/test/build). Not
 * wired into CI (mirrors this suite's own `pnpm e2e`-only convention);
 * intended to be run once locally against `.env`'s local Postgres before the
 * founder sees the deploy, then deleted or left as a regression check per
 * the human's call.
 */

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

async function addPartner(page: import("@playwright/test").Page, name: string, sharePercent: string) {
  // "Add Partner" is ambiguous under a bare role/name lookup (Playwright
  // strict mode) -- the page header's own action button shares its
  // accessible name with EmptyState's "Add Partner" action once the list is
  // non-empty on a later call. Scope to `PageHeader`'s own root (the only
  // element combining `flex` + `justify-between`, per `page-header.tsx`) so
  // this doesn't rely on DOM-order coincidence between the two.
  await page
    .locator("div.flex.justify-between", { has: page.getByRole("heading", { name: "Partner Shares" }) })
    .getByRole("button", { name: "Add Partner" })
    .click();
  await page.locator("#partner-name").fill(name);
  await page.locator("#partner-share-percent").fill(sharePercent);
  await page.getByRole("button", { name: "Save" }).click();
}

async function addSubPartner(
  page: import("@playwright/test").Page,
  partnerName: string,
  subName: string,
  sharePercent: string,
) {
  await page
    .getByText(partnerName, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'nb-person-card')][1]")
    .getByRole("button", { name: /Sub-partners/ })
    .click();
  await page.getByRole("button", { name: "Add Sub-partner" }).click();
  await page.locator("#partner-name").fill(subName);
  await page.locator("#partner-share-percent").fill(sharePercent);
  await page.getByRole("button", { name: "Save" }).click();
}

for (const width of [1200, 900]) {
  test(`Shares screen: no action button clips past the card edge at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    const projectName = uniqueName(`E2E Crop ${width}`);
    await createProject(page, projectName);

    await addPartner(page, "Crop Partner One", "40");
    await addPartner(page, "Crop Partner Two", "30");
    await addPartner(page, "Crop Partner Three", "30");

    const cards = page.locator(".nb-person-card-partner");
    await expect(cards).toHaveCount(3);

    const cardCount = await cards.count();
    for (let i = 0; i < cardCount; i++) {
      const card = cards.nth(i);
      const cardBox = await card.boundingBox();
      expect(cardBox).not.toBeNull();
      const buttons = card.locator("button");
      const buttonCount = await buttons.count();
      for (let b = 0; b < buttonCount; b++) {
        const buttonBox = await buttons.nth(b).boundingBox();
        expect(buttonBox).not.toBeNull();
        if (!cardBox || !buttonBox) continue;
        // The button's right edge must never paint past the card's own
        // right edge (the crop this fix targets) -- 1px slack for
        // sub-pixel rounding.
        expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
        expect(buttonBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      }
    }

    // No horizontal overflow on the page itself at this width.
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
}

test("nested sub-partner card renders inside the partner card with the role tints and colored rail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });

  const projectName = uniqueName("E2E Nest");
  await createProject(page, projectName);
  await addPartner(page, "Nest Partner", "100");
  await addSubPartner(page, "Nest Partner", "Nest Sub", "50");

  const partnerCard = page.getByText("Nest Partner", { exact: true }).locator("xpath=ancestor::div[contains(@class,'nb-person-card-partner')][1]");
  const subCard = page.getByText("Nest Sub", { exact: true }).locator("xpath=ancestor::div[contains(@class,'nb-person-card-sub')][1]");

  await expect(subCard).toBeVisible();

  // Containment: the sub card is a descendant of the partner card's DOM
  // subtree, not a sibling with a drawn connector line.
  const isDescendant = await partnerCard.evaluate((partnerEl, subText) => {
    const subEl = Array.from(partnerEl.querySelectorAll(".nb-person-card-sub")).find((el) =>
      (el.textContent ?? "").includes(subText),
    );
    return subEl !== undefined && partnerEl !== subEl && partnerEl.contains(subEl);
  }, "Nest Sub");
  expect(isDescendant).toBe(true);

  // Tint colors match the tokens (2026-09-28: updated for founder feedback
  // 2026-09-26, tokens.css's own `.nb-person-card-partner` doc comment -- a
  // solid teal background wash across every Partner card read as too
  // heavy/odd, so Partner cards dropped their background fill in favor of a
  // tinted BORDER alone (matching Sub-partner's own border treatment);
  // Sub-partner cards kept their background fill unchanged). This test
  // originally asserted a background tint for both.
  const partnerBorderColor = await partnerCard.evaluate((el) => getComputedStyle(el).borderColor);
  const subBg = await subCard.evaluate((el) => getComputedStyle(el).backgroundColor);
  // border-color: color-mix(in srgb, var(--color-info) 35%, transparent);
  // --color-info: #0ea5a5 -> rgb(14, 165, 165) at 35% alpha.
  expect(partnerBorderColor).toBe("color(srgb 0.054902 0.647059 0.647059 / 0.35)");
  // --color-violet-soft: #f1eafe -> rgb(241, 234, 254)
  expect(subBg).toBe("rgb(241, 234, 254)");

  // The nested rail wrapper (`.nb-person-nest`) is present, with a
  // non-zero left border (the colored rail).
  const rail = partnerCard.locator(".nb-person-nest").first();
  await expect(rail).toBeVisible();
  const railBorderWidth = await rail.evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(railBorderWidth).not.toBe("0px");

  // The rail's own teal-to-violet gradient (`border-image`, tokens.css) is
  // the newest/most fragile CSS in this batch -- sample it directly rather
  // than only its border-width fallback.
  const railBorderImage = await rail.evaluate((el) => getComputedStyle(el).borderImageSource);
  expect(railBorderImage).toContain("linear-gradient");
});

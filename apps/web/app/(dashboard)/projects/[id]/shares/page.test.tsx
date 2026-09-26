// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PartnerShare, SubPartnerShare } from "@niveshbook/types";
import type { Percent } from "@niveshbook/types";
import SharesPage from "./page";

/**
 * Scoped hierarchy-rendering coverage for the founder-approved hybrid
 * (spec-partner-hierarchy-cards, 2026-09-26): this page's full PersonCard/
 * nesting rewrite previously had zero `pnpm test` coverage (no page.test.tsx
 * existed, and the Playwright spec is excluded from CI). Mirrors
 * add-money/withdraw-money page.test.tsx's mocking pattern. Not full-page
 * coverage -- just proving the partner/sub-partner containment + tint.
 */

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-1" }),
}));

const listPartnerShares = vi.fn();
const addPartnerShare = vi.fn();
const updatePartnerShare = vi.fn();

vi.mock("@/lib/partner-shares", () => ({
  listPartnerShares: (...args: unknown[]) => listPartnerShares(...args),
  addPartnerShare: (...args: unknown[]) => addPartnerShare(...args),
  updatePartnerShare: (...args: unknown[]) => updatePartnerShare(...args),
}));

const listSubPartnerShares = vi.fn();
const addSubPartnerShare = vi.fn();
const updateSubPartnerShare = vi.fn();

vi.mock("@/lib/subpartner-shares", () => ({
  listSubPartnerShares: (...args: unknown[]) => listSubPartnerShares(...args),
  addSubPartnerShare: (...args: unknown[]) => addSubPartnerShare(...args),
  updateSubPartnerShare: (...args: unknown[]) => updateSubPartnerShare(...args),
}));

const PARTNER: PartnerShare = {
  id: "ps-1",
  partnerId: "partner-a",
  projectId: "project-1",
  name: "Partner A",
  sharePercent: "60" as Percent,
  userId: null,
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const SUB_PARTNER: SubPartnerShare = {
  id: "sps-1",
  subPartnerId: "sub-1",
  partnerId: "partner-a",
  projectId: "project-1",
  name: "Sub One",
  sharePercent: "30" as Percent,
  userId: null,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  listPartnerShares.mockReset().mockResolvedValue({ shares: [PARTNER], total: "60" });
  addPartnerShare.mockReset();
  updatePartnerShare.mockReset();
  listSubPartnerShares.mockReset().mockResolvedValue({ shares: [SUB_PARTNER], total: "30" });
  addSubPartnerShare.mockReset();
  updateSubPartnerShare.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SharesPage hierarchy rendering (spec-partner-hierarchy-cards, 2026-09-26)", () => {
  it("nests a violet sub-partner card inside the teal partner card behind the rail, once expanded", async () => {
    const user = userEvent.setup();
    render(<SharesPage />);

    await screen.findByText("Partner A");
    await user.click(screen.getByRole("button", { name: /Sub-partners/ }));
    await screen.findByText("Sub One");

    const partnerCard = screen.getByText("Partner A").closest(".nb-person-card") as HTMLElement;
    const subCard = screen.getByText("Sub One").closest(".nb-person-card") as HTMLElement;

    expect(partnerCard.className).toContain("nb-person-card-partner");
    expect(subCard.className).toContain("nb-person-card-sub");
    expect(partnerCard.contains(subCard)).toBe(true);
    expect(subCard.parentElement?.className).toContain("nb-person-nest");
  });
});

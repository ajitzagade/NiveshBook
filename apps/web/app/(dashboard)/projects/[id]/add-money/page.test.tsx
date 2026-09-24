// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PartnerShouldPay } from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import type { ShouldPayResponse } from "@/lib/should-pay";
import AddMoneyPage from "./page";

/**
 * Focused regression coverage for the two review-flagged bugs in this page
 * (spec-3-2's Review Triage Log, rows 1-2) -- not full-page coverage, which
 * is a separate, pre-existing gap (row 5). Mirrors `app/SessionList.test.tsx`'s
 * pattern for testing a client component with hooks/fetch.
 */

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-1" }),
}));

const listInvestmentRequirements = vi.fn();
const addInvestmentRequirement = vi.fn();

vi.mock("@/lib/investment-requirements", () => ({
  listInvestmentRequirements: (...args: unknown[]) => listInvestmentRequirements(...args),
  addInvestmentRequirement: (...args: unknown[]) => addInvestmentRequirement(...args),
}));

const getShouldPay = vi.fn();

vi.mock("@/lib/should-pay", () => ({
  getShouldPay: (...args: unknown[]) => getShouldPay(...args),
}));

const REQUIREMENT = {
  id: "req-1",
  projectId: "project-1",
  amount: "1000000",
  requirementDate: "2026-10-01",
  createdAt: new Date().toISOString(),
};

const PARTNER_WITH_SUBS: PartnerShouldPay = {
  partnerId: "a",
  name: "A",
  sharePercent: "50" as Percent,
  shouldPay: "500000" as Money,
  ownShouldPay: "250000" as Money,
  subPartners: [
    {
      subPartnerId: "sub1",
      name: "Sub1",
      sharePercent: "12.5" as Percent,
      shouldPay: "125000" as Money,
    },
    {
      subPartnerId: "sub2",
      name: "Sub2",
      sharePercent: "12.5" as Percent,
      shouldPay: "125000" as Money,
    },
  ],
};

const SHOULD_PAY_RESPONSE: ShouldPayResponse = { partners: [PARTNER_WITH_SUBS] };

async function renderAndExpand() {
  const user = userEvent.setup();
  render(<AddMoneyPage />);

  await screen.findByText("2026-10-01");
  await user.click(screen.getByRole("button", { name: "Should Pay" }));
  return user;
}

/**
 * `screen.getByText` only matches a node whose own text isn't split across
 * child elements (here, "Own: " is a text node followed by a nested
 * `<Amount>` `<span>`) -- so an exact-string match never finds it. Matches
 * on the concatenated `textContent` of a single `<p>` element instead.
 */
function findParagraphContaining(text: string): HTMLElement {
  return screen.getByText((_, element) => {
    if (element?.tagName !== "P") return false;
    return (element.textContent ?? "").includes(text);
  });
}

describe("AddMoneyPage -- Should Pay expand (regression, spec-3-2 Review Triage rows 1-2)", () => {
  beforeEach(() => {
    listInvestmentRequirements.mockReset().mockResolvedValue({ requirements: [REQUIREMENT] });
    addInvestmentRequirement.mockReset();
    getShouldPay.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a Partner's ownShouldPay as a distinct value from their pooled shouldPay total, not the same number reused for both (row 1)", async () => {
    getShouldPay.mockResolvedValue(SHOULD_PAY_RESPONSE);

    await renderAndExpand();

    // The pooled total (ownShouldPay + Σ subShouldPay = 250000 + 125000 +
    // 125000 = 500000) still appears, once -- the ShareRow action amount.
    await waitFor(() => {
      expect(screen.getByText("₹5,00,000")).toBeInTheDocument();
    });

    // The Partner's own retained amount is called out on its own distinct
    // line, never conflated with the pooled total above.
    expect(findParagraphContaining("Own: ₹2,50,000")).toBeInTheDocument();

    // The worked-example hint must describe ownShouldPay ("A's normal share
    // is ₹2,50,000"), never the pooled total ("₹5,00,000") -- otherwise a
    // reader double-counts what's already been delegated to Sub-partners.
    const hint = findParagraphContaining("normal share is");
    expect(hint.textContent).toContain("₹2,50,000");
    expect(hint.textContent).not.toContain("₹5,00,000");

    // Exactly one place shows the pooled total (₹5,00,000) -- the ShareRow
    // action amount -- confirming the hint/"Own" line don't also show it.
    expect(screen.getAllByText("₹5,00,000")).toHaveLength(1);
  });

  it("does not get stuck on 'Loading…' forever after collapsing before the fetch resolves, then re-expanding (row 2)", async () => {
    let releaseFirstFetch: (() => void) | undefined;
    getShouldPay
      .mockImplementationOnce(
        () =>
          new Promise<ShouldPayResponse>((resolve) => {
            releaseFirstFetch = () => resolve(SHOULD_PAY_RESPONSE);
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(SHOULD_PAY_RESPONSE));

    const user = await renderAndExpand();

    // The first fetch is still in flight -- the panel shows the loading state.
    expect(screen.getByText("Loading Should Pay…")).toBeInTheDocument();
    expect(getShouldPay).toHaveBeenCalledTimes(1);

    // Collapse before that fetch ever resolves.
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Loading Should Pay…")).not.toBeInTheDocument();

    // Re-expand -- this must trigger a brand-new fetch (not read the stale
    // "loading" state left over from the abandoned first attempt).
    await user.click(screen.getByRole("button", { name: "Should Pay" }));
    expect(getShouldPay).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(findParagraphContaining("Own: ₹2,50,000")).toBeInTheDocument();
    });
    expect(screen.queryByText("Loading Should Pay…")).not.toBeInTheDocument();

    // The first (abandoned) fetch resolving late must not resurrect a stale
    // render -- the panel should still show the second fetch's loaded data.
    releaseFirstFetch?.();
    await Promise.resolve();
    expect(findParagraphContaining("Own: ₹2,50,000")).toBeInTheDocument();
  });
});

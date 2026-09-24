import { describe, it, expect } from "vitest";
import type { Money, Percent } from "@niveshbook/types";
import type { PartnerInvestmentAdjustment } from "./investment-adjustment";
import { ShareNotFoundError } from "./investment-transaction";
import { extractInvestmentStatus } from "./investment-status";

/**
 * A synthetic tree, shaped exactly like `computeInvestmentAdjustment`'s own
 * output (this module's pure `extractInvestmentStatus` doesn't itself
 * calculate anything -- it only extracts one entry from an already-computed
 * tree), constructed by hand so these tests can exercise the extraction/
 * find-by-id logic in isolation from the calculation that produces it --
 * mirrors `recommended-amount.test.ts`'s precedent of testing the
 * extraction/merge step separately from its calculation.
 *
 * This is **not** a literal reproduction of the AC's worked-example input
 * numbers ("Partner A pays 3,75,000") -- Review Triage Log row 1 confirmed
 * that particular input is arithmetically impossible: `resolveAndUpsertAdjustment`
 * (Story 3.4, unmodified) compares a Partner's own row against the
 * *aggregate* Should Pay (Own + all current Sub-partners = 5,00,000 here),
 * so 3,75,000 paid against a 5,00,000 aggregate can only ever yield
 * `"pending"`, never `"extra_paid"`. This fixture instead uses 6,25,000 paid
 * (internally consistent: 6,25,000 - 5,00,000 = 1,25,000 extra) so the
 * `adjustmentType`/`adjustmentAmount` values below are actually reachable via
 * real `compareMoney`/`subtractMoney` arithmetic, while still landing on the
 * AC's exact stated *output* per party -- A: Extra Paid 1,25,000, Sub1:
 * Pending 1,25,000, Sub2: No Adjustment -- which is what these tests verify
 * `extractInvestmentStatus` correctly surfaces.
 */
function workedExampleTree(): PartnerInvestmentAdjustment[] {
  return [
    {
      partnerId: "partner-a",
      name: "Partner A",
      sharePercent: "50" as Percent,
      shouldPay: "500000" as Money,
      ownShouldPay: "250000" as Money,
      actualPaid: "625000" as Money,
      adjustmentType: "extra_paid",
      adjustmentAmount: "125000" as Money,
      subPartners: [
        {
          subPartnerId: "sub-1",
          name: "Sub1",
          sharePercent: "12.5" as Percent,
          shouldPay: "125000" as Money,
          actualPaid: "0" as Money,
          adjustmentType: "pending",
          adjustmentAmount: "125000" as Money,
        },
        {
          subPartnerId: "sub-2",
          name: "Sub2",
          sharePercent: "12.5" as Percent,
          shouldPay: "125000" as Money,
          actualPaid: "125000" as Money,
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        },
      ],
    },
    {
      partnerId: "partner-b",
      name: "Partner B",
      sharePercent: "50" as Percent,
      shouldPay: "500000" as Money,
      ownShouldPay: "500000" as Money,
      actualPaid: "0" as Money,
      adjustmentType: "pending",
      adjustmentAmount: "500000" as Money,
      subPartners: [],
    },
  ];
}

describe("extractInvestmentStatus", () => {
  it("AC worked example: Partner A's own view shows Extra Paid 1,25,000 with nested Sub1 Pending and Sub2 No Adjustment", () => {
    const tree = workedExampleTree();

    const partnerA = extractInvestmentStatus("partner", "partner-a", tree);

    expect(partnerA.partnerId).toBe("partner-a");
    expect(partnerA.adjustmentType).toBe("extra_paid");
    expect(partnerA.adjustmentAmount).toBe("125000");
    expect(partnerA.subPartners).toHaveLength(2);

    const sub1 = partnerA.subPartners.find((s) => s.subPartnerId === "sub-1");
    expect(sub1?.adjustmentType).toBe("pending");
    expect(sub1?.adjustmentAmount).toBe("125000");

    const sub2 = partnerA.subPartners.find((s) => s.subPartnerId === "sub-2");
    expect(sub2?.adjustmentType).toBe("none");
    expect(sub2?.adjustmentAmount).toBe("0");
  });

  it("a Sub-partner's own view returns ONLY their single entry -- not their parent Partner's data, not a sibling's", () => {
    const tree = workedExampleTree();

    const sub1 = extractInvestmentStatus("sub_partner", "sub-1", tree);

    expect(sub1).toEqual({
      subPartnerId: "sub-1",
      name: "Sub1",
      sharePercent: "12.5",
      shouldPay: "125000",
      actualPaid: "0",
      adjustmentType: "pending",
      adjustmentAmount: "125000",
    });
    // Never the parent Partner's fields (e.g. `partnerId`, `subPartners`) --
    // and never Sub2's `adjustmentType`/`adjustmentAmount` either.
    expect(sub1).not.toHaveProperty("partnerId");
    expect(sub1).not.toHaveProperty("subPartners");
  });

  it("a co-Partner's shareId still resolves to that Partner's own entry (privacy is `authorize()`'s job at the route layer, not this pure extraction step)", () => {
    const tree = workedExampleTree();

    const partnerB = extractInvestmentStatus("partner", "partner-b", tree);

    expect(partnerB.partnerId).toBe("partner-b");
    expect(partnerB.adjustmentType).toBe("pending");
    expect(partnerB.adjustmentAmount).toBe("500000");
  });

  it("throws ShareNotFoundError (reused unchanged from Story 3.3) when a partner shareId matches nothing in the tree", () => {
    const tree = workedExampleTree();

    expect(() => extractInvestmentStatus("partner", "nonexistent", tree)).toThrow(ShareNotFoundError);
  });

  it("throws ShareNotFoundError when a sub_partner shareId matches nothing in the tree", () => {
    const tree = workedExampleTree();

    expect(() => extractInvestmentStatus("sub_partner", "nonexistent", tree)).toThrow(ShareNotFoundError);
  });

  it("throws ShareNotFoundError for a sub_partner shareId that only exists as a *Partner*'s id (never conflates the two identity spaces)", () => {
    const tree = workedExampleTree();

    expect(() => extractInvestmentStatus("sub_partner", "partner-a", tree)).toThrow(ShareNotFoundError);
  });
});

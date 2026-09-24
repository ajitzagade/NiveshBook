import { describe, it, expect } from "vitest";
import type { Money, Percent } from "@niveshbook/types";
import type { PartnerWithdrawalAdjustment } from "./withdrawal-adjustment";
import { WithdrawalShareNotFoundError } from "./withdrawal-transaction";
import { extractWithdrawalStatus } from "./withdrawal-status";

/**
 * A synthetic tree, shaped exactly like `computeWithdrawalAdjustment`'s own
 * output (this module's pure `extractWithdrawalStatus` doesn't itself
 * calculate anything -- it only extracts one entry from an already-computed
 * tree), constructed by hand so these tests can exercise the extraction/
 * find-by-id logic in isolation from the calculation that produces it --
 * mirrors `investment-status.test.ts`'s `workedExampleTree` precedent one
 * ledger over.
 *
 * Reproduces the AC's exact worked example: Partner A Can Take 1,25,000
 * (takes it all -- no adjustment), Sub1 Can Take 62,500 (takes 0 -- Keep for
 * Later 62,500), Sub2 Can Take 62,500 (takes it all -- no adjustment) --
 * recorded independently, neither blocking nor forcing the other.
 */
function workedExampleTree(): PartnerWithdrawalAdjustment[] {
  return [
    {
      partnerId: "partner-a",
      name: "Partner A",
      sharePercent: "100" as Percent,
      canTake: "125000" as Money,
      taken: "125000" as Money,
      adjustmentType: "none",
      adjustmentAmount: "0" as Money,
      subPartners: [
        {
          subPartnerId: "sub-1",
          name: "Sub1",
          sharePercent: "50" as Percent,
          canTake: "62500" as Money,
          taken: "0" as Money,
          adjustmentType: "keep_for_later",
          adjustmentAmount: "62500" as Money,
        },
        {
          subPartnerId: "sub-2",
          name: "Sub2",
          sharePercent: "50" as Percent,
          canTake: "62500" as Money,
          taken: "62500" as Money,
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        },
      ],
    },
    {
      partnerId: "partner-b",
      name: "Partner B",
      sharePercent: "0" as Percent,
      canTake: "0" as Money,
      taken: "0" as Money,
      adjustmentType: "none",
      adjustmentAmount: "0" as Money,
      subPartners: [],
    },
  ];
}

describe("extractWithdrawalStatus", () => {
  it("AC worked example: Sub1's own view shows Keep for Later 62,500", () => {
    const tree = workedExampleTree();

    const sub1 = extractWithdrawalStatus("sub_partner", "sub-1", tree);

    expect(sub1).toEqual({
      subPartnerId: "sub-1",
      name: "Sub1",
      sharePercent: "50",
      canTake: "62500",
      taken: "0",
      adjustmentType: "keep_for_later",
      adjustmentAmount: "62500",
    });
    expect(sub1).not.toHaveProperty("partnerId");
    expect(sub1).not.toHaveProperty("subPartners");
  });

  it("AC worked example: Sub2's own view shows no adjustment (none) -- neither blocks nor forces Sub1's independent Keep for Later", () => {
    const tree = workedExampleTree();

    const sub2 = extractWithdrawalStatus("sub_partner", "sub-2", tree);

    expect(sub2.adjustmentType).toBe("none");
    expect(sub2.adjustmentAmount).toBe("0");
  });

  it("Partner A's own view includes their nested current Sub-partners (Sub1 Keep for Later, Sub2 none)", () => {
    const tree = workedExampleTree();

    const partnerA = extractWithdrawalStatus("partner", "partner-a", tree);

    expect(partnerA.partnerId).toBe("partner-a");
    expect(partnerA.adjustmentType).toBe("none");
    expect(partnerA.subPartners).toHaveLength(2);

    const sub1 = partnerA.subPartners.find((s) => s.subPartnerId === "sub-1");
    expect(sub1?.adjustmentType).toBe("keep_for_later");
    expect(sub1?.adjustmentAmount).toBe("62500");

    const sub2 = partnerA.subPartners.find((s) => s.subPartnerId === "sub-2");
    expect(sub2?.adjustmentType).toBe("none");
    expect(sub2?.adjustmentAmount).toBe("0");
  });

  it("a Partner with zero current Sub-partners returns subPartners: []", () => {
    const tree = workedExampleTree();

    const partnerB = extractWithdrawalStatus("partner", "partner-b", tree);

    expect(partnerB.subPartners).toEqual([]);
  });

  it("a co-Partner's shareId still resolves to that Partner's own entry (privacy is `authorize()`'s job at the route layer, not this pure extraction step)", () => {
    const tree = workedExampleTree();

    const partnerB = extractWithdrawalStatus("partner", "partner-b", tree);

    expect(partnerB.partnerId).toBe("partner-b");
  });

  it("throws WithdrawalShareNotFoundError (reused unchanged from Story 4.2) when a partner shareId matches nothing in the tree", () => {
    const tree = workedExampleTree();

    expect(() => extractWithdrawalStatus("partner", "nonexistent", tree)).toThrow(
      WithdrawalShareNotFoundError,
    );
  });

  it("throws WithdrawalShareNotFoundError when a sub_partner shareId matches nothing in the tree", () => {
    const tree = workedExampleTree();

    expect(() => extractWithdrawalStatus("sub_partner", "nonexistent", tree)).toThrow(
      WithdrawalShareNotFoundError,
    );
  });

  it("throws WithdrawalShareNotFoundError for a sub_partner shareId that only exists as a *Partner*'s id (never conflates the two identity spaces)", () => {
    const tree = workedExampleTree();

    expect(() => extractWithdrawalStatus("sub_partner", "partner-a", tree)).toThrow(
      WithdrawalShareNotFoundError,
    );
  });
});

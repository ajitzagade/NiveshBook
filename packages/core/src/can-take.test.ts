import { describe, it, expect } from "vitest";
import type { Money, PartnerShare, Percent, SubPartnerShare } from "@niveshbook/types";
import { sumMoney } from "./decimal-math";
import {
  computeCanTake,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
} from "./can-take";

function makePartner(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: "project-1",
    name: "Partner A",
    sharePercent: "50" as Percent,
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSub(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  return {
    id: "sub-row-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: "project-1",
    name: "Sub 1",
    sharePercent: "12.5" as Percent,
    userId: null,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeCanTake", () => {
  it("AC: even 3-way Partner split (50/30/20) of ₹5,00,000 available to withdraw", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];

    const result = computeCanTake("500000" as Money, partners, {});

    expect(result).toHaveLength(3);
    const byId = Object.fromEntries(result.map((p) => [p.partnerId, p]));
    expect(byId.a?.canTake).toBe("250000");
    expect(byId.a?.ownCanTake).toBe("250000");
    expect(byId.b?.canTake).toBe("150000");
    expect(byId.c?.canTake).toBe("100000");
  });

  it("nested split: Partner A's Sub-partners Sub1=12.5%, Sub2=12.5% (A's own share stays 50%) -- ownCanTake + subs sum to A's full 50% share of the total", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];
    const subsByPartnerId = {
      a: [
        makeSub({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "12.5" as Percent }),
        makeSub({ subPartnerId: "sub2", partnerId: "a", name: "Sub2", sharePercent: "12.5" as Percent }),
      ],
    };

    const result = computeCanTake("500000" as Money, partners, subsByPartnerId);

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.ownCanTake).toBe("125000");
    expect(a?.subPartners).toEqual([
      { subPartnerId: "sub1", name: "Sub1", sharePercent: "12.5", canTake: "62500" },
      { subPartnerId: "sub2", name: "Sub2", sharePercent: "12.5", canTake: "62500" },
    ]);
    expect(a?.canTake).toBe("250000");
  });

  it("uneven split (33.33/33.33/33.34) -- every value sums to exactly the available amount, largest-remainder allocated", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "33.33" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "33.33" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "33.34" as Percent }),
    ];

    const result = computeCanTake("500000" as Money, partners, {});

    expect(sumMoney(result.map((p) => p.canTake))).toBe("500000");
  });

  it("every returned Can Take value (every ownCanTake plus every sub canTake) sums to exactly the available amount, incl. Sub-partners", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];
    const subsByPartnerId = {
      a: [
        makeSub({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "12.5" as Percent }),
        makeSub({ subPartnerId: "sub2", partnerId: "a", name: "Sub2", sharePercent: "12.5" as Percent }),
      ],
    };

    const result = computeCanTake("500000" as Money, partners, subsByPartnerId);

    const everyLeafAmount = result.flatMap((p) => [p.ownCanTake, ...p.subPartners.map((s) => s.canTake)]);
    expect(sumMoney(everyLeafAmount)).toBe("500000");
  });

  it("zero-investment case: no money ever invested -- available-to-withdraw is ₹0, every Can Take value is ₹0", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];

    const result = computeCanTake("0" as Money, partners, {});

    expect(result).toHaveLength(3);
    for (const partner of result) {
      expect(partner.canTake).toBe("0");
      expect(partner.ownCanTake).toBe("0");
    }
  });

  it("gives a Partner with no current Sub-partners an ownCanTake equal to their full share, and an empty subPartners list", () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

    const result = computeCanTake("500000" as Money, partners, {});

    expect(result[0]?.ownCanTake).toBe("500000");
    expect(result[0]?.canTake).toBe("500000");
    expect(result[0]?.subPartners).toEqual([]);
  });

  it("gives a fully-suballocated Partner (subs == own share) an ownCanTake of exactly 0", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "50" as Percent })],
    };

    const result = computeCanTake("500000" as Money, partners, subsByPartnerId);

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.ownCanTake).toBe("0");
    expect(a?.subPartners[0]?.canTake).toBe("250000");
    expect(a?.canTake).toBe("250000");
  });

  it("throws PartnerSharesNotFullyAllocatedError when Partner Shares sum under 100%", () => {
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "30" as Percent }),
    ];

    expect(() => computeCanTake("500000" as Money, partners, {})).toThrow(
      PartnerSharesNotFullyAllocatedError,
    );
  });

  it("throws PartnerSharesNotFullyAllocatedError when Partner Shares sum over 100%", () => {
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "60" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "50" as Percent }),
    ];

    expect(() => computeCanTake("500000" as Money, partners, {})).toThrow(
      PartnerSharesNotFullyAllocatedError,
    );
  });

  it("throws PartnerSharesNotFullyAllocatedError for a Project with no Partner Shares yet (0% != 100%)", () => {
    expect(() => computeCanTake("500000" as Money, [], {})).toThrow(
      PartnerSharesNotFullyAllocatedError,
    );
  });

  it("throws CanTakeSubPartnerSharesOverAllocatedError when a Partner's Sub-partners exceed their own share", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [
        makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "30" as Percent }),
        makeSub({ subPartnerId: "sub2", partnerId: "a", sharePercent: "30" as Percent }),
      ],
    };

    expect(() => computeCanTake("500000" as Money, partners, subsByPartnerId)).toThrow(
      CanTakeSubPartnerSharesOverAllocatedError,
    );
  });

  it("checks the over-allocation precondition before ever calling splitMoneyByPercents -- Partner Shares still total exactly 100%, only the Sub-partner allocation is invalid", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" as Percent })],
    };

    expect(() => computeCanTake("500000" as Money, partners, subsByPartnerId)).toThrow(
      CanTakeSubPartnerSharesOverAllocatedError,
    );
  });

  it("CanTakeSubPartnerSharesOverAllocatedError's message names the over-allocated Partner", () => {
    const partners = [makePartner({ partnerId: "a", name: "Amelia", sharePercent: "100" as Percent })];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "100.0001" as Percent })],
    };

    expect(() => computeCanTake("500000" as Money, partners, subsByPartnerId)).toThrow(/Amelia/);
  });
});

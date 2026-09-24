import { describe, it, expect } from "vitest";
import type { InvestmentRequirement, Money, PartnerShare, Percent, SubPartnerShare } from "@niveshbook/types";
import { sumMoney } from "./decimal-math";
import {
  computeShouldPay,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
} from "./should-pay";

function makeRequirement(overrides: Partial<InvestmentRequirement> = {}): InvestmentRequirement {
  return {
    id: "req-1",
    projectId: "project-1",
    amount: "1000000" as Money,
    requirementDate: "2026-10-01",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

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

describe("computeShouldPay", () => {
  it("AC1: even 3-way Partner split (50/30/20) of ₹10,00,000", () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];

    const result = computeShouldPay(requirement, partners, {});

    expect(result).toHaveLength(3);
    const byId = Object.fromEntries(result.map((p) => [p.partnerId, p]));
    expect(byId.a?.shouldPay).toBe("500000");
    expect(byId.a?.ownShouldPay).toBe("500000");
    expect(byId.b?.shouldPay).toBe("300000");
    expect(byId.c?.shouldPay).toBe("200000");
  });

  it("AC2: Partner A's internal split (own 25%, Sub1 12.5%, Sub2 12.5%) -- A's own share stays 50%", () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
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

    const result = computeShouldPay(requirement, partners, subsByPartnerId);

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.ownShouldPay).toBe("250000");
    expect(a?.subPartners).toEqual([
      { subPartnerId: "sub1", name: "Sub1", sharePercent: "12.5", shouldPay: "125000" },
      { subPartnerId: "sub2", name: "Sub2", sharePercent: "12.5", shouldPay: "125000" },
    ]);
    expect(a?.shouldPay).toBe("500000");
  });

  it("AC3: uneven split (33.33/33.33/33.34) -- every value sums to exactly the requirement amount, largest-remainder allocated", () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "33.33" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "33.33" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "33.34" as Percent }),
    ];

    const result = computeShouldPay(requirement, partners, {});

    expect(sumMoney(result.map((p) => p.shouldPay))).toBe("1000000");
  });

  it("every returned Should Pay value (every ownShouldPay plus every sub shouldPay) sums to exactly the requirement amount, incl. Sub-partners", () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
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

    const result = computeShouldPay(requirement, partners, subsByPartnerId);

    const everyLeafAmount = result.flatMap((p) => [p.ownShouldPay, ...p.subPartners.map((s) => s.shouldPay)]);
    expect(sumMoney(everyLeafAmount)).toBe("1000000");
  });

  it("gives a Partner with no current Sub-partners an ownShouldPay equal to their full share, and an empty subPartners list", () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent }),
    ];

    const result = computeShouldPay(requirement, partners, {});

    expect(result[0]?.ownShouldPay).toBe("1000000");
    expect(result[0]?.shouldPay).toBe("1000000");
    expect(result[0]?.subPartners).toEqual([]);
  });

  it("gives a fully-suballocated Partner (subs == own share) an ownShouldPay of exactly 0", () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "50" as Percent })],
    };

    const result = computeShouldPay(requirement, partners, subsByPartnerId);

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.ownShouldPay).toBe("0");
    expect(a?.subPartners[0]?.shouldPay).toBe("500000");
    expect(a?.shouldPay).toBe("500000");
  });

  it("throws SharesNotFullyAllocatedError when Partner Shares sum under 100%", () => {
    const requirement = makeRequirement();
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "30" as Percent }),
    ];

    expect(() => computeShouldPay(requirement, partners, {})).toThrow(SharesNotFullyAllocatedError);
  });

  it("throws SharesNotFullyAllocatedError when Partner Shares sum over 100%", () => {
    const requirement = makeRequirement();
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "60" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "50" as Percent }),
    ];

    expect(() => computeShouldPay(requirement, partners, {})).toThrow(SharesNotFullyAllocatedError);
  });

  it("throws SharesNotFullyAllocatedError for a Project with no Partner Shares yet (0% != 100%)", () => {
    const requirement = makeRequirement();

    expect(() => computeShouldPay(requirement, [], {})).toThrow(SharesNotFullyAllocatedError);
  });

  it("throws SubPartnerSharesOverAllocatedError when a Partner's Sub-partners exceed their own share", () => {
    const requirement = makeRequirement();
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

    expect(() => computeShouldPay(requirement, partners, subsByPartnerId)).toThrow(
      SubPartnerSharesOverAllocatedError,
    );
  });

  it("checks the over-allocation precondition before ever calling splitMoneyByPercents -- Partner Shares still total exactly 100%, only the Sub-partner allocation is invalid", () => {
    // Partner Shares alone (50/50) are fully allocated -- only A's own
    // Sub-partners (60% under a 50% share) are over-allocated. Proves the
    // two preconditions are checked independently, not just "total != 100".
    const requirement = makeRequirement();
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" as Percent })],
    };

    expect(() => computeShouldPay(requirement, partners, subsByPartnerId)).toThrow(
      SubPartnerSharesOverAllocatedError,
    );
  });

  it("SubPartnerSharesOverAllocatedError's message names the over-allocated Partner", () => {
    const requirement = makeRequirement();
    const partners = [makePartner({ partnerId: "a", name: "Amelia", sharePercent: "100" as Percent })];
    // A Sub-partner's own share can never literally exceed 100% via
    // `toPercent`'s validation, but a small overage on top of a Partner's
    // own 100% is enough to prove the over-allocation path and the error
    // message naming -- bypass `toPercent` the same way `should-pay.ts`
    // itself bypasses it for a synthetic "0" retained percent.
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "100.0001" as Percent })],
    };

    expect(() => computeShouldPay(requirement, partners, subsByPartnerId)).toThrow(/Amelia/);
  });
});

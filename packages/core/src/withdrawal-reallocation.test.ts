import { describe, it, expect } from "vitest";
import type { Money, PartnerShare, Percent, SubPartnerShare, WithdrawalReallocation, WithdrawalReallocationAllocation } from "@niveshbook/types";
import { sumMoney } from "./decimal-math";
import { PartnerSharesNotFullyAllocatedError, CanTakeSubPartnerSharesOverAllocatedError } from "./can-take";
import {
  computeWithdrawalReallocationSplit,
  computeEffectiveCanTake,
  sumDeclinedByShare,
  sumUnconsumedBonusForShare,
  resolveBonusToConsume,
  planReallocationBonusConsumption,
  WithdrawalReallocationDecliningShareNotFoundError,
  WithdrawalReallocationNoRecipientsError,
  ReallocationBonusInsufficientError,
} from "./withdrawal-reallocation";

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

function makeReallocation(overrides: Partial<WithdrawalReallocation> = {}): WithdrawalReallocation {
  return {
    id: "realloc-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "a",
    declinedAmount: "100000" as Money,
    notes: null,
    status: "active",
    createdByUserId: "user-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAllocation(overrides: Partial<WithdrawalReallocationAllocation> = {}): WithdrawalReallocationAllocation {
  return {
    id: "alloc-1",
    reallocationId: "realloc-1",
    partyType: "partner",
    shareId: "b",
    allocatedAmount: "60000" as Money,
    consumedAmount: "0" as Money,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeWithdrawalReallocationSplit", () => {
  it("splits a Partner's decline pro-rata across the other current Partners by relative Share %", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];

    const result = computeWithdrawalReallocationSplit("partner", "a", "100000" as Money, partners, {});

    expect(result).toHaveLength(2);
    const byShareId = Object.fromEntries(result.map((leg) => [leg.shareId, leg]));
    // B(30) and C(20) split 100000 in a 30:20 ratio -- 60000/40000.
    expect(byShareId.b).toEqual({ partyType: "partner", shareId: "b", allocatedAmount: "60000" });
    expect(byShareId.c).toEqual({ partyType: "partner", shareId: "c", allocatedAmount: "40000" });
  });

  it("sums every allocated leg to exactly the declined amount, even when the remaining weights don't total 100", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "33.33" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "33.33" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "33.34" as Percent }),
    ];

    const result = computeWithdrawalReallocationSplit("partner", "a", "100" as Money, partners, {});

    expect(sumMoney(result.map((leg) => leg.allocatedAmount))).toBe("100");
  });

  it("includes a Partner's own retained-share leaf as a recipient even when a Sub-partner of a different Partner declines", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      b: [makeSub({ subPartnerId: "sub1", partnerId: "b", name: "Sub1", sharePercent: "50" as Percent })],
    };

    const result = computeWithdrawalReallocationSplit(
      "sub_partner",
      "sub1",
      "100000" as Money,
      partners,
      subsByPartnerId,
    );

    // Recipients: A's own leaf (retained 50) and B's own retained leaf (50 - 50 = 0).
    expect(result).toHaveLength(2);
    const byShareId = Object.fromEntries(result.map((leg) => [leg.shareId, leg]));
    expect(byShareId.a).toEqual({ partyType: "partner", shareId: "a", allocatedAmount: "100000" });
    expect(byShareId.b).toEqual({ partyType: "partner", shareId: "b", allocatedAmount: "0" });
  });

  it("excludes exactly the declining leaf, not every leaf of the same partyType", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "25" as Percent })],
    };

    const result = computeWithdrawalReallocationSplit("partner", "a", "100000" as Money, partners, subsByPartnerId);

    const shareIds = result.map((leg) => leg.shareId).sort();
    expect(shareIds).toEqual(["b", "sub1"]);
  });

  it("throws WithdrawalReallocationDecliningShareNotFoundError for a shareId that isn't a current Partner or Sub-partner", () => {
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "50" as Percent }),
    ];

    expect(() =>
      computeWithdrawalReallocationSplit("partner", "not-a-real-share", "1000" as Money, partners, {}),
    ).toThrow(WithdrawalReallocationDecliningShareNotFoundError);
  });

  it("throws WithdrawalReallocationNoRecipientsError when the declining leaf is the only current leaf in the Project", () => {
    const partners = [makePartner({ partnerId: "a", sharePercent: "100" as Percent })];

    expect(() => computeWithdrawalReallocationSplit("partner", "a", "1000" as Money, partners, {})).toThrow(
      WithdrawalReallocationNoRecipientsError,
    );
  });

  it("throws WithdrawalReallocationNoRecipientsError (not an uncaught SplitWeightTotalError) when the only recipient leaf has a retained weight of exactly zero -- a Partner fully sub-allocated to a single Sub-partner who declines", () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "100" as Percent })],
    };

    // Recipients = [Partner A's own retained leaf, weight "0"] -- non-empty,
    // but nobody in it can actually receive anything.
    expect(() =>
      computeWithdrawalReallocationSplit("sub_partner", "sub1", "1000" as Money, partners, subsByPartnerId),
    ).toThrow(WithdrawalReallocationNoRecipientsError);
  });

  it("throws PartnerSharesNotFullyAllocatedError when Partner Shares don't sum to 100%, reusing can-take's own error class", () => {
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "30" as Percent }),
    ];

    expect(() => computeWithdrawalReallocationSplit("partner", "a", "1000" as Money, partners, {})).toThrow(
      PartnerSharesNotFullyAllocatedError,
    );
  });

  it("throws CanTakeSubPartnerSharesOverAllocatedError when a Partner's Sub-partners exceed their own share, reusing can-take's own error class", () => {
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

    expect(() =>
      computeWithdrawalReallocationSplit("partner", "b", "1000" as Money, partners, subsByPartnerId),
    ).toThrow(CanTakeSubPartnerSharesOverAllocatedError);
  });
});

describe("computeEffectiveCanTake", () => {
  it("returns the base Can Take unchanged when there are no reallocations at all", () => {
    const result = computeEffectiveCanTake("500000" as Money, "partner", "a", [], []);
    expect(result).toBe("500000");
  });

  it("subtracts this share's own active declined amount", () => {
    const reallocations = [makeReallocation({ partyType: "partner", shareId: "a", declinedAmount: "100000" as Money })];

    const result = computeEffectiveCanTake("500000" as Money, "partner", "a", reallocations, []);

    expect(result).toBe("400000");
  });

  it("adds this share's unconsumed bonus as a recipient", () => {
    const allocations = [
      makeAllocation({ partyType: "partner", shareId: "b", allocatedAmount: "60000" as Money, consumedAmount: "0" as Money }),
    ];

    const result = computeEffectiveCanTake("300000" as Money, "partner", "b", [], allocations);

    expect(result).toBe("360000");
  });

  it("adds only the unconsumed remainder of a partially-consumed bonus leg", () => {
    const allocations = [
      makeAllocation({
        partyType: "partner",
        shareId: "b",
        allocatedAmount: "60000" as Money,
        consumedAmount: "25000" as Money,
      }),
    ];

    const result = computeEffectiveCanTake("300000" as Money, "partner", "b", [], allocations);

    expect(result).toBe("335000");
  });

  it("ignores reallocations/allocations belonging to a different (partyType, shareId)", () => {
    const reallocations = [makeReallocation({ partyType: "partner", shareId: "a", declinedAmount: "100000" as Money })];
    const allocations = [makeAllocation({ partyType: "sub_partner", shareId: "sub1", allocatedAmount: "60000" as Money })];

    const result = computeEffectiveCanTake("300000" as Money, "partner", "b", reallocations, allocations);

    expect(result).toBe("300000");
  });

  it("sums multiple active declines against the same share", () => {
    const reallocations = [
      makeReallocation({ id: "r1", partyType: "partner", shareId: "a", declinedAmount: "50000" as Money }),
      makeReallocation({ id: "r2", partyType: "partner", shareId: "a", declinedAmount: "30000" as Money }),
    ];

    const result = computeEffectiveCanTake("500000" as Money, "partner", "a", reallocations, []);

    expect(result).toBe("420000");
  });

  it("sums multiple unconsumed bonus legs for the same recipient across different declines", () => {
    const allocations = [
      makeAllocation({ id: "leg1", reallocationId: "r1", partyType: "partner", shareId: "b", allocatedAmount: "20000" as Money }),
      makeAllocation({ id: "leg2", reallocationId: "r2", partyType: "partner", shareId: "b", allocatedAmount: "15000" as Money }),
    ];

    const result = computeEffectiveCanTake("300000" as Money, "partner", "b", [], allocations);

    expect(result).toBe("335000");
  });

  it("floors at '0' rather than going negative if declined somehow exceeded base Can Take", () => {
    const reallocations = [makeReallocation({ partyType: "partner", shareId: "a", declinedAmount: "600000" as Money })];

    const result = computeEffectiveCanTake("500000" as Money, "partner", "a", reallocations, []);

    expect(result).toBe("0");
  });

  it("combines a decline and a received bonus for the same share in the same computation", () => {
    // A partner declines part of their own Can Take, but is simultaneously a
    // recipient of a different decline elsewhere in the Project.
    const reallocations = [makeReallocation({ partyType: "partner", shareId: "a", declinedAmount: "50000" as Money })];
    const allocations = [makeAllocation({ partyType: "partner", shareId: "a", allocatedAmount: "20000" as Money })];

    const result = computeEffectiveCanTake("500000" as Money, "partner", "a", reallocations, allocations);

    expect(result).toBe("470000");
  });
});

describe("sumDeclinedByShare", () => {
  it("sums active declines for the matching share, ignoring others", () => {
    const reallocations = [
      makeReallocation({ id: "r1", partyType: "partner", shareId: "a", declinedAmount: "50000" as Money }),
      makeReallocation({ id: "r2", partyType: "partner", shareId: "a", declinedAmount: "30000" as Money }),
      makeReallocation({ id: "r3", partyType: "partner", shareId: "b", declinedAmount: "10000" as Money }),
    ];

    expect(sumDeclinedByShare(reallocations, "partner", "a")).toBe("80000");
  });

  it("returns '0' when there are no matching declines", () => {
    expect(sumDeclinedByShare([], "partner", "a")).toBe("0");
  });
});

describe("sumUnconsumedBonusForShare", () => {
  it("sums each leg's unconsumed remainder for the matching recipient", () => {
    const allocations = [
      makeAllocation({ id: "leg1", partyType: "partner", shareId: "b", allocatedAmount: "20000" as Money, consumedAmount: "5000" as Money }),
      makeAllocation({ id: "leg2", partyType: "partner", shareId: "b", allocatedAmount: "15000" as Money, consumedAmount: "0" as Money }),
      makeAllocation({ id: "leg3", partyType: "partner", shareId: "c", allocatedAmount: "9000" as Money }),
    ];

    expect(sumUnconsumedBonusForShare(allocations, "partner", "b")).toBe("30000");
  });

  it("returns '0' when there are no matching legs", () => {
    expect(sumUnconsumedBonusForShare([], "partner", "b")).toBe("0");
  });
});

describe("resolveBonusToConsume", () => {
  it("is '0' when requestedAmount doesn't exceed reducedCanTake -- bonus never touched for a normal withdrawal", () => {
    expect(resolveBonusToConsume("200000" as Money, "250000" as Money, "50000" as Money)).toBe("0");
  });

  it("is '0' at an exact match (requestedAmount === reducedCanTake)", () => {
    expect(resolveBonusToConsume("250000" as Money, "250000" as Money, "50000" as Money)).toBe("0");
  });

  it("draws exactly the excess over reducedCanTake when that excess fits within the bonus", () => {
    expect(resolveBonusToConsume("270000" as Money, "250000" as Money, "50000" as Money)).toBe("20000");
  });

  it("caps at the full bonus when the excess exceeds it (the rest is genuinely-extra, not bonus-linked)", () => {
    expect(resolveBonusToConsume("400000" as Money, "250000" as Money, "50000" as Money)).toBe("50000");
  });

  it("is '0' when there is no bonus at all", () => {
    expect(resolveBonusToConsume("400000" as Money, "250000" as Money, "0" as Money)).toBe("0");
  });
});

describe("planReallocationBonusConsumption", () => {
  it("draws entirely from the single leg when it covers the full amount", () => {
    const legs = [{ id: "leg1", allocatedAmount: "60000" as Money, consumedAmount: "0" as Money }];

    const plan = planReallocationBonusConsumption(legs, "40000" as Money);

    expect(plan).toEqual([{ id: "leg1", newConsumedAmount: "40000" }]);
  });

  it("draws FIFO across multiple legs, oldest first, spilling into the next once one is exhausted", () => {
    const legs = [
      { id: "leg1", allocatedAmount: "20000" as Money, consumedAmount: "0" as Money },
      { id: "leg2", allocatedAmount: "50000" as Money, consumedAmount: "0" as Money },
    ];

    const plan = planReallocationBonusConsumption(legs, "35000" as Money);

    expect(plan).toEqual([
      { id: "leg1", newConsumedAmount: "20000" },
      { id: "leg2", newConsumedAmount: "15000" },
    ]);
  });

  it("skips a fully-consumed leg and draws from the next one", () => {
    const legs = [
      { id: "leg1", allocatedAmount: "20000" as Money, consumedAmount: "20000" as Money },
      { id: "leg2", allocatedAmount: "50000" as Money, consumedAmount: "0" as Money },
    ];

    const plan = planReallocationBonusConsumption(legs, "10000" as Money);

    expect(plan).toEqual([{ id: "leg2", newConsumedAmount: "10000" }]);
  });

  it("tops up an already-partially-consumed leg using its current remainder, not its original allocated amount", () => {
    const legs = [{ id: "leg1", allocatedAmount: "60000" as Money, consumedAmount: "25000" as Money }];

    const plan = planReallocationBonusConsumption(legs, "35000" as Money);

    expect(plan).toEqual([{ id: "leg1", newConsumedAmount: "60000" }]);
  });

  it("returns an empty plan for a zero amount to consume, touching no legs", () => {
    const legs = [{ id: "leg1", allocatedAmount: "60000" as Money, consumedAmount: "0" as Money }];

    const plan = planReallocationBonusConsumption(legs, "0" as Money);

    expect(plan).toEqual([]);
  });

  it("omits legs the consumption never reaches, once earlier legs cover the full amount", () => {
    const legs = [
      { id: "leg1", allocatedAmount: "50000" as Money, consumedAmount: "0" as Money },
      { id: "leg2", allocatedAmount: "50000" as Money, consumedAmount: "0" as Money },
    ];

    const plan = planReallocationBonusConsumption(legs, "20000" as Money);

    expect(plan).toEqual([{ id: "leg1", newConsumedAmount: "20000" }]);
  });

  it("throws ReallocationBonusInsufficientError when the legs' combined unconsumed remainder is less than the amount requested", () => {
    const legs = [{ id: "leg1", allocatedAmount: "20000" as Money, consumedAmount: "0" as Money }];

    expect(() => planReallocationBonusConsumption(legs, "50000" as Money)).toThrow(
      ReallocationBonusInsufficientError,
    );
  });
});

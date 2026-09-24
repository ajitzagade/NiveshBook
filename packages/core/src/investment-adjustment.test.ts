import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  InvestmentAdjustment,
  InvestmentRequirement,
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
} from "@niveshbook/types";
import { toMoney } from "./decimal-math";
import { SharesNotFullyAllocatedError, SubPartnerSharesOverAllocatedError } from "./should-pay";
import type { UpsertInvestmentAdjustmentInput } from "./investment-adjustment-port";
import { computeInvestmentAdjustment, shareKey } from "./investment-adjustment";

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

/** A fake `InvestmentAdjustmentPort.upsert` that just echoes back a full row shaped from the input -- lets every test assert both the returned tree and the exact upsert calls made, without a real DB. */
function makeUpsertMock() {
  let counter = 0;
  const upsert = vi.fn(async (input: UpsertInvestmentAdjustmentInput): Promise<InvestmentAdjustment> => {
    counter += 1;
    return {
      id: `adj-${counter}`,
      projectId: input.projectId,
      partyType: input.partyType,
      shareId: input.shareId,
      requirementId: input.requirementId,
      shouldPay: input.shouldPay,
      actualPaid: input.actualPaid,
      adjustmentType: input.adjustmentType,
      adjustmentAmount: input.adjustmentAmount,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  });
  return upsert;
}

describe("shareKey", () => {
  it("combines partyType and shareId into a single composite key", () => {
    expect(shareKey("partner", "partner-1")).toBe("partner:partner-1");
    expect(shareKey("sub_partner", "sub-1")).toBe("sub_partner:sub-1");
  });

  it("keeps a Partner and a Sub-partner with the same shareId distinct", () => {
    expect(shareKey("partner", "shared-id")).not.toBe(shareKey("sub_partner", "shared-id"));
  });
});

describe("computeInvestmentAdjustment", () => {
  let upsert: ReturnType<typeof makeUpsertMock>;

  beforeEach(() => {
    upsert = makeUpsertMock();
  });

  it("AC: Partner A, Should Pay 5,00,000, transactions summing to 7,00,000 -> Extra Paid 2,00,000", async () => {
    const requirement = makeRequirement({ amount: "500000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const transactionsByShareKey = {
      [shareKey("partner", "a")]: ["500000", "200000"].map(toMoney),
    };

    const result = await computeInvestmentAdjustment(requirement, partners, {}, transactionsByShareKey, {
      investmentAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.shouldPay).toBe("500000");
    expect(a?.actualPaid).toBe("700000");
    expect(a?.adjustmentType).toBe("extra_paid");
    expect(a?.adjustmentAmount).toBe("200000");
  });

  it("AC: Partner C, Should Pay 2,00,000, no transactions recorded -> Pending 2,00,000", async () => {
    const requirement = makeRequirement({ amount: "200000" as Money });
    const partners = [makePartner({ partnerId: "c", name: "C", sharePercent: "100" as Percent })];

    const result = await computeInvestmentAdjustment(requirement, partners, {}, {}, {
      investmentAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    const c = result.find((p) => p.partnerId === "c");
    expect(c?.shouldPay).toBe("200000");
    expect(c?.actualPaid).toBe("0");
    expect(c?.adjustmentType).toBe("pending");
    expect(c?.adjustmentAmount).toBe("200000");
  });

  it("AC: Partner B, Should Pay 3,00,000, transactions summing to exactly 3,00,000 -> No Adjustment", async () => {
    const requirement = makeRequirement({ amount: "300000" as Money });
    const partners = [makePartner({ partnerId: "b", name: "B", sharePercent: "100" as Percent })];
    const transactionsByShareKey = {
      [shareKey("partner", "b")]: ["300000"].map(toMoney),
    };

    const result = await computeInvestmentAdjustment(requirement, partners, {}, transactionsByShareKey, {
      investmentAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    const b = result.find((p) => p.partnerId === "b");
    expect(b?.adjustmentType).toBe("none");
    expect(b?.adjustmentAmount).toBe("0");
  });

  it("zero transactions and one explicit amount:'0' transaction for a share produce IDENTICAL results (both Actual Paid = 0)", async () => {
    const requirement = makeRequirement({ amount: "200000" as Money });
    const partners = [makePartner({ partnerId: "c", name: "C", sharePercent: "100" as Percent })];

    const noneRecorded = await computeInvestmentAdjustment(requirement, partners, {}, {}, {
      investmentAdjustments: { upsert: makeUpsertMock(), listByProjectId: vi.fn() },
    });
    const explicitZero = await computeInvestmentAdjustment(
      requirement,
      partners,
      {},
      { [shareKey("partner", "c")]: ["0"].map(toMoney) },
      { investmentAdjustments: { upsert: makeUpsertMock(), listByProjectId: vi.fn() } },
    );

    // Compare only the domain-meaningful fields -- `id`/`updatedAt`/`createdAt`
    // are minted per-call by the (mocked) port and aren't part of this
    // equivalence claim.
    const relevant = (adjustment: (typeof noneRecorded)[number]) => ({
      shouldPay: adjustment.shouldPay,
      actualPaid: adjustment.actualPaid,
      adjustmentType: adjustment.adjustmentType,
      adjustmentAmount: adjustment.adjustmentAmount,
    });
    expect(relevant(noneRecorded[0] as (typeof noneRecorded)[number])).toEqual(
      relevant(explicitZero[0] as (typeof explicitZero)[number]),
    );
    expect(noneRecorded[0]?.actualPaid).toBe("0");
    expect(explicitZero[0]?.actualPaid).toBe("0");
    expect(noneRecorded[0]?.adjustmentType).toBe("pending");
    expect(explicitZero[0]?.adjustmentType).toBe("pending");
  });

  it("computes a Sub-partner's adjustment against its own (partyType, shareId) -- distinct from its parent Partner's own row", async () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      // Partner A's own retained share is now 0% (fully suballocated) --
      // A's *own* row's shouldPay is still the aggregate total (ownShouldPay
      // + Sub 1's shouldPay = 0 + 500000 = 500000), matching Story 3.3's
      // `buildTransactionSnapshot` precedent (a Partner-row transaction's
      // `shouldPaySnapshot` is the same aggregate, never `ownShouldPay` alone).
      a: [makeSub({ subPartnerId: "sub-1", partnerId: "a", name: "Sub 1", sharePercent: "50" as Percent })],
    };
    const transactionsByShareKey = {
      [shareKey("partner", "a")]: ["500000"].map(toMoney), // matches A's own row's shouldPay (500000) exactly -> none
      [shareKey("sub_partner", "sub-1")]: ["400000"].map(toMoney), // Sub 1's shouldPay is 500000 -> pending 100000
    };

    const result = await computeInvestmentAdjustment(
      requirement,
      partners,
      subsByPartnerId,
      transactionsByShareKey,
      { investmentAdjustments: { upsert, listByProjectId: vi.fn() } },
    );

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.ownShouldPay).toBe("0");
    expect(a?.shouldPay).toBe("500000");
    expect(a?.actualPaid).toBe("500000");
    expect(a?.adjustmentType).toBe("none");

    const sub = a?.subPartners.find((s) => s.subPartnerId === "sub-1");
    expect(sub?.shouldPay).toBe("500000");
    expect(sub?.actualPaid).toBe("400000");
    expect(sub?.adjustmentType).toBe("pending");
    expect(sub?.adjustmentAmount).toBe("100000");
  });

  it("upserts exactly one row per Partner and per Sub-partner, keyed by (partyType, shareId, projectId)", async () => {
    const requirement = makeRequirement({ projectId: "project-1", id: "req-1", amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub-1", partnerId: "a", name: "Sub 1", sharePercent: "50" as Percent })],
    };

    await computeInvestmentAdjustment(requirement, partners, subsByPartnerId, {}, {
      investmentAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        requirementId: "req-1",
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        partyType: "sub_partner",
        shareId: "sub-1",
        requirementId: "req-1",
      }),
    );
  });

  it("re-viewing the same requirement with no new transactions in between calls upsert again with the identical values -- no duplicate, no drift", async () => {
    const requirement = makeRequirement({ amount: "500000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const transactionsByShareKey = { [shareKey("partner", "a")]: ["300000"].map(toMoney) };

    await computeInvestmentAdjustment(requirement, partners, {}, transactionsByShareKey, {
      investmentAdjustments: { upsert, listByProjectId: vi.fn() },
    });
    await computeInvestmentAdjustment(requirement, partners, {}, transactionsByShareKey, {
      investmentAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = upsert.mock.calls;
    expect(firstCall?.[0]).toEqual(secondCall?.[0]);
  });

  it("a new transaction recorded between two views changes the second view's Actual Paid/adjustment", async () => {
    const requirement = makeRequirement({ amount: "500000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

    const first = await computeInvestmentAdjustment(
      requirement,
      partners,
      {},
      { [shareKey("partner", "a")]: ["300000"].map(toMoney) },
      { investmentAdjustments: { upsert, listByProjectId: vi.fn() } },
    );
    const second = await computeInvestmentAdjustment(
      requirement,
      partners,
      {},
      { [shareKey("partner", "a")]: ["300000", "200000"].map(toMoney) },
      { investmentAdjustments: { upsert, listByProjectId: vi.fn() } },
    );

    expect(first[0]?.actualPaid).toBe("300000");
    expect(first[0]?.adjustmentType).toBe("pending");
    expect(second[0]?.actualPaid).toBe("500000");
    expect(second[0]?.adjustmentType).toBe("none");
  });

  it("lets SharesNotFullyAllocatedError propagate unchanged, before ever calling upsert", async () => {
    const requirement = makeRequirement();
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "30" as Percent }),
    ];

    await expect(
      computeInvestmentAdjustment(requirement, partners, {}, {}, { investmentAdjustments: { upsert, listByProjectId: vi.fn() } }),
    ).rejects.toThrow(SharesNotFullyAllocatedError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lets SubPartnerSharesOverAllocatedError propagate unchanged, before ever calling upsert", async () => {
    const requirement = makeRequirement();
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" as Percent })],
    };

    await expect(
      computeInvestmentAdjustment(requirement, partners, subsByPartnerId, {}, {
        investmentAdjustments: { upsert, listByProjectId: vi.fn() },
      }),
    ).rejects.toThrow(SubPartnerSharesOverAllocatedError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns the persisted row's values (from the port), not merely the freshly-computed ones", async () => {
    const requirement = makeRequirement({ amount: "500000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const persistingUpsert = vi.fn(async (): Promise<InvestmentAdjustment> => ({
      id: "adj-persisted",
      projectId: "project-1",
      partyType: "partner",
      shareId: "a",
      requirementId: "req-1",
      shouldPay: "500000" as Money,
      actualPaid: "999999" as Money, // deliberately different from what a fresh computation would produce
      adjustmentType: "extra_paid",
      adjustmentAmount: "499999" as Money,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }));

    const result = await computeInvestmentAdjustment(requirement, partners, {}, {}, {
      investmentAdjustments: { upsert: persistingUpsert, listByProjectId: vi.fn() },
    });

    expect(result[0]?.actualPaid).toBe("999999");
    expect(result[0]?.adjustmentType).toBe("extra_paid");
    expect(result[0]?.adjustmentAmount).toBe("499999");
  });
});

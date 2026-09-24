import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Money, PartnerShare, Percent, SubPartnerShare, WithdrawalAdjustment } from "@niveshbook/types";
import { toMoney } from "./decimal-math";
import { PartnerSharesNotFullyAllocatedError, CanTakeSubPartnerSharesOverAllocatedError } from "./can-take";
import type { UpsertWithdrawalAdjustmentInput } from "./withdrawal-adjustment-port";
import { computeWithdrawalAdjustment, withdrawalShareKey } from "./withdrawal-adjustment";

const PROJECT_ID = "project-1";

function makePartner(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
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
    projectId: PROJECT_ID,
    name: "Sub 1",
    sharePercent: "12.5" as Percent,
    userId: null,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A fake `WithdrawalAdjustmentPort.upsert` that just echoes back a full row shaped from the input -- lets every test assert both the returned tree and the exact upsert calls made, without a real DB. */
function makeUpsertMock() {
  let counter = 0;
  const upsert = vi.fn(
    async (input: UpsertWithdrawalAdjustmentInput): Promise<WithdrawalAdjustment> => {
      counter += 1;
      return {
        id: `adj-${counter}`,
        projectId: input.projectId,
        partyType: input.partyType,
        shareId: input.shareId,
        canTake: input.canTake,
        taken: input.taken,
        adjustmentType: input.adjustmentType,
        adjustmentAmount: input.adjustmentAmount,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    },
  );
  return upsert;
}

describe("withdrawalShareKey", () => {
  it("combines partyType and shareId into a single composite key", () => {
    expect(withdrawalShareKey("partner", "partner-1")).toBe("partner:partner-1");
    expect(withdrawalShareKey("sub_partner", "sub-1")).toBe("sub_partner:sub-1");
  });

  it("keeps a Partner and a Sub-partner with the same shareId distinct", () => {
    expect(withdrawalShareKey("partner", "shared-id")).not.toBe(withdrawalShareKey("sub_partner", "shared-id"));
  });
});

describe("computeWithdrawalAdjustment", () => {
  let upsert: ReturnType<typeof makeUpsertMock>;

  beforeEach(() => {
    upsert = makeUpsertMock();
  });

  it("AC: Partner B, Can Take 1,50,000, Taken 0 -> Keep for Later 1,50,000", async () => {
    const partners = [makePartner({ partnerId: "b", name: "B", sharePercent: "100" as Percent })];

    const result = await computeWithdrawalAdjustment(PROJECT_ID, "150000" as Money, partners, {}, {}, {
      withdrawalAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    const b = result.find((p) => p.partnerId === "b");
    expect(b?.canTake).toBe("150000");
    expect(b?.taken).toBe("0");
    expect(b?.adjustmentType).toBe("keep_for_later");
    expect(b?.adjustmentAmount).toBe("150000");
  });

  it("AC: Partner A, Can Take 2,50,000, Taken 2,50,000 -> no Keep for Later balance (none)", async () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const takenByShareKey = { [withdrawalShareKey("partner", "a")]: ["250000"].map(toMoney) };

    const result = await computeWithdrawalAdjustment(
      PROJECT_ID,
      "250000" as Money,
      partners,
      {},
      takenByShareKey,
      { withdrawalAdjustments: { upsert, listByProjectId: vi.fn() } },
    );

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.adjustmentType).toBe("none");
    expect(a?.adjustmentAmount).toBe("0");
  });

  it("Over-take: Can Take 1,50,000, Taken 3,00,000 -> Extra Taken 1,50,000 (accepted per Story 4.2's no-cap decision)", async () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const takenByShareKey = { [withdrawalShareKey("partner", "a")]: ["300000"].map(toMoney) };

    const result = await computeWithdrawalAdjustment(
      PROJECT_ID,
      "150000" as Money,
      partners,
      {},
      takenByShareKey,
      { withdrawalAdjustments: { upsert, listByProjectId: vi.fn() } },
    );

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.taken).toBe("300000");
    expect(a?.adjustmentType).toBe("extra_taken");
    expect(a?.adjustmentAmount).toBe("150000");
  });

  it("Multiple Take Now transactions for one share are summed: 50,000 + 25,000 = 75,000 Taken", async () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const takenByShareKey = {
      [withdrawalShareKey("partner", "a")]: ["50000", "25000"].map(toMoney),
    };

    const result = await computeWithdrawalAdjustment(
      PROJECT_ID,
      "150000" as Money,
      partners,
      {},
      takenByShareKey,
      { withdrawalAdjustments: { upsert, listByProjectId: vi.fn() } },
    );

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.taken).toBe("75000");
    expect(a?.adjustmentType).toBe("keep_for_later");
    expect(a?.adjustmentAmount).toBe("75000");
  });

  it("no transactions yet -- Taken = 0, Keep for Later = full Can Take", async () => {
    const partners = [makePartner({ partnerId: "c", name: "C", sharePercent: "100" as Percent })];

    const result = await computeWithdrawalAdjustment(PROJECT_ID, "100000" as Money, partners, {}, {}, {
      withdrawalAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    const c = result.find((p) => p.partnerId === "c");
    expect(c?.taken).toBe("0");
    expect(c?.adjustmentType).toBe("keep_for_later");
    expect(c?.adjustmentAmount).toBe("100000");
  });

  it("zero transactions and one explicit amount:'0' transaction for a share produce IDENTICAL results (both Taken = 0)", async () => {
    const partners = [makePartner({ partnerId: "c", name: "C", sharePercent: "100" as Percent })];

    const noneRecorded = await computeWithdrawalAdjustment(PROJECT_ID, "100000" as Money, partners, {}, {}, {
      withdrawalAdjustments: { upsert: makeUpsertMock(), listByProjectId: vi.fn() },
    });
    const explicitZero = await computeWithdrawalAdjustment(
      PROJECT_ID,
      "100000" as Money,
      partners,
      {},
      { [withdrawalShareKey("partner", "c")]: ["0"].map(toMoney) },
      { withdrawalAdjustments: { upsert: makeUpsertMock(), listByProjectId: vi.fn() } },
    );

    const relevant = (adjustment: (typeof noneRecorded)[number]) => ({
      canTake: adjustment.canTake,
      taken: adjustment.taken,
      adjustmentType: adjustment.adjustmentType,
      adjustmentAmount: adjustment.adjustmentAmount,
    });
    expect(relevant(noneRecorded[0] as (typeof noneRecorded)[number])).toEqual(
      relevant(explicitZero[0] as (typeof explicitZero)[number]),
    );
  });

  it("computes a Sub-partner's adjustment against its own (partyType, shareId) -- distinct from its parent Partner's own row", async () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub-1", partnerId: "a", name: "Sub 1", sharePercent: "50" as Percent })],
    };
    const takenByShareKey = {
      [withdrawalShareKey("partner", "a")]: ["500000"].map(toMoney), // A's own row's canTake is 500000 -> none
      [withdrawalShareKey("sub_partner", "sub-1")]: ["400000"].map(toMoney), // Sub 1's canTake is 500000 -> keep_for_later 100000
    };

    const result = await computeWithdrawalAdjustment(
      PROJECT_ID,
      "1000000" as Money,
      partners,
      subsByPartnerId,
      takenByShareKey,
      { withdrawalAdjustments: { upsert, listByProjectId: vi.fn() } },
    );

    const a = result.find((p) => p.partnerId === "a");
    expect(a?.canTake).toBe("500000");
    expect(a?.taken).toBe("500000");
    expect(a?.adjustmentType).toBe("none");

    const sub = a?.subPartners.find((s) => s.subPartnerId === "sub-1");
    expect(sub?.canTake).toBe("500000");
    expect(sub?.taken).toBe("400000");
    expect(sub?.adjustmentType).toBe("keep_for_later");
    expect(sub?.adjustmentAmount).toBe("100000");
  });

  it("upserts exactly one row per Partner and per Sub-partner, keyed by (partyType, shareId, projectId) -- never requirementId", async () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub-1", partnerId: "a", name: "Sub 1", sharePercent: "50" as Percent })],
    };

    await computeWithdrawalAdjustment(PROJECT_ID, "1000000" as Money, partners, subsByPartnerId, {}, {
      withdrawalAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, partyType: "partner", shareId: "a" }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, partyType: "sub_partner", shareId: "sub-1" }),
    );
    for (const call of upsert.mock.calls) {
      expect(call[0]).not.toHaveProperty("requirementId");
    }
  });

  it("re-viewing with no new transactions in between calls upsert again with the identical values -- no duplicate, no drift", async () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const takenByShareKey = { [withdrawalShareKey("partner", "a")]: ["30000"].map(toMoney) };

    await computeWithdrawalAdjustment(PROJECT_ID, "150000" as Money, partners, {}, takenByShareKey, {
      withdrawalAdjustments: { upsert, listByProjectId: vi.fn() },
    });
    await computeWithdrawalAdjustment(PROJECT_ID, "150000" as Money, partners, {}, takenByShareKey, {
      withdrawalAdjustments: { upsert, listByProjectId: vi.fn() },
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = upsert.mock.calls;
    expect(firstCall?.[0]).toEqual(secondCall?.[0]);
  });

  it("a new Take Now recorded between two views changes the second view's Taken/adjustment (row is updated, not duplicated)", async () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

    const first = await computeWithdrawalAdjustment(
      PROJECT_ID,
      "150000" as Money,
      partners,
      {},
      { [withdrawalShareKey("partner", "a")]: ["50000"].map(toMoney) },
      { withdrawalAdjustments: { upsert, listByProjectId: vi.fn() } },
    );
    const second = await computeWithdrawalAdjustment(
      PROJECT_ID,
      "150000" as Money,
      partners,
      {},
      { [withdrawalShareKey("partner", "a")]: ["50000", "100000"].map(toMoney) },
      { withdrawalAdjustments: { upsert, listByProjectId: vi.fn() } },
    );

    expect(first[0]?.taken).toBe("50000");
    expect(first[0]?.adjustmentType).toBe("keep_for_later");
    expect(second[0]?.taken).toBe("150000");
    expect(second[0]?.adjustmentType).toBe("none");
  });

  it("lets PartnerSharesNotFullyAllocatedError propagate unchanged, before ever calling upsert", async () => {
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "30" as Percent }),
    ];

    await expect(
      computeWithdrawalAdjustment(PROJECT_ID, "100000" as Money, partners, {}, {}, {
        withdrawalAdjustments: { upsert, listByProjectId: vi.fn() },
      }),
    ).rejects.toThrow(PartnerSharesNotFullyAllocatedError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lets CanTakeSubPartnerSharesOverAllocatedError propagate unchanged, before ever calling upsert", async () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" as Percent })],
    };

    await expect(
      computeWithdrawalAdjustment(PROJECT_ID, "100000" as Money, partners, subsByPartnerId, {}, {
        withdrawalAdjustments: { upsert, listByProjectId: vi.fn() },
      }),
    ).rejects.toThrow(CanTakeSubPartnerSharesOverAllocatedError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns the persisted row's values (from the port), not merely the freshly-computed ones", async () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const persistingUpsert = vi.fn(async (): Promise<WithdrawalAdjustment> => ({
      id: "adj-persisted",
      projectId: PROJECT_ID,
      partyType: "partner",
      shareId: "a",
      canTake: "500000" as Money,
      taken: "999999" as Money, // deliberately different from what a fresh computation would produce
      adjustmentType: "extra_taken",
      adjustmentAmount: "499999" as Money,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }));

    const result = await computeWithdrawalAdjustment(PROJECT_ID, "500000" as Money, partners, {}, {}, {
      withdrawalAdjustments: { upsert: persistingUpsert, listByProjectId: vi.fn() },
    });

    expect(result[0]?.taken).toBe("999999");
    expect(result[0]?.adjustmentType).toBe("extra_taken");
    expect(result[0]?.adjustmentAmount).toBe("499999");
  });
});

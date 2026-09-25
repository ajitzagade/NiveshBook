import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  InvestmentAdjustment,
  InvestmentRequirement,
  Money,
  PartnerShare,
  Percent,
  RecommendedAmount,
  SubPartnerShare,
} from "@niveshbook/types";
import { toMoney } from "./decimal-math";
import { SharesNotFullyAllocatedError, SubPartnerSharesOverAllocatedError } from "./should-pay";
import { computeInvestmentAdjustment, shareKey } from "./investment-adjustment";
import type { InvestmentAdjustmentPort, UpsertInvestmentAdjustmentInput } from "./investment-adjustment-port";
import type { RecommendedAmountPort, SnapshotRecommendedAmountInput } from "./recommended-amount-port";
import { mergeRecommendedAmounts, snapshotRecommendedAmounts } from "./recommended-amount";
import type { PartnerShouldPay } from "./should-pay";

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

function makeAdjustment(overrides: Partial<InvestmentAdjustment> = {}): InvestmentAdjustment {
  return {
    id: "adj-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "partner-1",
    requirementId: "prev-req",
    shouldPay: "500000" as Money,
    actualPaid: "500000" as Money,
    adjustmentType: "none",
    adjustmentAmount: "0" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function byShareKey(adjustments: readonly InvestmentAdjustment[]): Record<string, InvestmentAdjustment> {
  const result: Record<string, InvestmentAdjustment> = {};
  for (const adjustment of adjustments) {
    result[shareKey(adjustment.partyType, adjustment.shareId)] = adjustment;
  }
  return result;
}

/** A fake `RecommendedAmountPort.snapshotAll` that echoes back a full row per input -- lets every test assert both the returned tree and the exact batch `snapshotAll` call made, without a real DB. */
function makeSnapshotAllMock() {
  let counter = 0;
  const snapshotAll = vi.fn(async (inputs: SnapshotRecommendedAmountInput[]): Promise<RecommendedAmount[]> => {
    return inputs.map((input) => {
      counter += 1;
      return {
        id: `ra-${counter}`,
        requirementId: input.requirementId,
        projectId: input.projectId,
        partyType: input.partyType,
        shareId: input.shareId,
        baseAmount: input.baseAmount,
        previousPending: input.previousPending,
        previousExtraPaid: input.previousExtraPaid,
        recommendedAmount: input.recommendedAmount,
        createdAt: new Date().toISOString(),
      };
    });
  });
  return snapshotAll;
}

/**
 * In-memory fake of `RecommendedAmountPort`, mirroring `packages/db`'s
 * `snapshotAll`-writes-the-whole-batch-in-one-transaction semantics --
 * `snapshotAll` only ever pushes to the backing store after every input in
 * the batch has been validated, exactly like `database.transaction(...)`
 * either commits the whole batch or rolls back none of it. Used by the
 * race-condition-avoidance test below, where a real `findByRequirementId`
 * round-trip matters.
 */
function makeFakeRecommendedAmountPort(): RecommendedAmountPort {
  const rows: RecommendedAmount[] = [];
  let counter = 0;
  return {
    async snapshotAll(inputs) {
      const newRows = inputs.map((input) => {
        counter += 1;
        return { id: `ra-${counter}`, createdAt: new Date().toISOString(), ...input };
      });
      // Only committed to the backing store once every row in the batch is
      // ready -- mirrors a transaction's atomic commit point.
      rows.push(...newRows);
      return newRows;
    },
    async findByRequirementId(requirementId) {
      return rows.filter((row) => row.requirementId === requirementId);
    },
  };
}

/** In-memory fake of `InvestmentAdjustmentPort`, mirroring `packages/db`'s upsert-keyed-by-(partyType,shareId,projectId) semantics -- used by the race-condition-avoidance test below. */
function makeFakeInvestmentAdjustmentPort(): InvestmentAdjustmentPort {
  const store = new Map<string, InvestmentAdjustment>();
  let counter = 0;
  return {
    async upsert(input: UpsertInvestmentAdjustmentInput) {
      counter += 1;
      const key = `${input.projectId}:${shareKey(input.partyType, input.shareId)}`;
      const existing = store.get(key);
      const row: InvestmentAdjustment = {
        id: existing?.id ?? `adj-${counter}`,
        projectId: input.projectId,
        partyType: input.partyType,
        shareId: input.shareId,
        requirementId: input.requirementId,
        shouldPay: input.shouldPay,
        actualPaid: input.actualPaid,
        adjustmentType: input.adjustmentType,
        adjustmentAmount: input.adjustmentAmount,
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      store.set(key, row);
      return row;
    },
    async listByProjectId(projectId: string) {
      return [...store.values()].filter((row) => row.projectId === projectId);
    },
    async listAll() {
      return [...store.values()];
    },
  };
}

describe("snapshotRecommendedAmounts", () => {
  let snapshotAll: ReturnType<typeof makeSnapshotAllMock>;

  beforeEach(() => {
    snapshotAll = makeSnapshotAllMock();
  });

  it("AC worked example: A=50%/B=30%/C=20%, previous round A Extra Paid 2,00,000 / B No Adjustment / C Pending 2,00,000, new requirement 10,00,000 -> Recommended A=3,00,000 B=3,00,000 C=4,00,000", async () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];
    const previousAdjustments = byShareKey([
      makeAdjustment({
        partyType: "partner",
        shareId: "a",
        adjustmentType: "extra_paid",
        adjustmentAmount: "200000" as Money,
      }),
      makeAdjustment({
        partyType: "partner",
        shareId: "b",
        adjustmentType: "none",
        adjustmentAmount: "0" as Money,
      }),
      makeAdjustment({
        partyType: "partner",
        shareId: "c",
        adjustmentType: "pending",
        adjustmentAmount: "200000" as Money,
      }),
    ]);

    const result = await snapshotRecommendedAmounts(requirement, partners, {}, previousAdjustments, {
      recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() },
    });

    const a = result.find((r) => r.shareId === "a");
    const b = result.find((r) => r.shareId === "b");
    const c = result.find((r) => r.shareId === "c");
    expect(a?.baseAmount).toBe("500000");
    expect(a?.previousExtraPaid).toBe("200000");
    expect(a?.previousPending).toBe("0");
    expect(a?.recommendedAmount).toBe("300000");

    expect(b?.baseAmount).toBe("300000");
    expect(b?.previousExtraPaid).toBe("0");
    expect(b?.previousPending).toBe("0");
    expect(b?.recommendedAmount).toBe("300000");

    expect(c?.baseAmount).toBe("200000");
    expect(c?.previousPending).toBe("200000");
    expect(c?.previousExtraPaid).toBe("0");
    expect(c?.recommendedAmount).toBe("400000");
  });

  it("clamps recommendedAmount to '0' (never negative) when a previous Extra Paid exceeds the new baseAmount", async () => {
    const requirement = makeRequirement({ amount: "100000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const previousAdjustments = byShareKey([
      makeAdjustment({
        partyType: "partner",
        shareId: "a",
        adjustmentType: "extra_paid",
        adjustmentAmount: "500000" as Money,
      }),
    ]);

    const result = await snapshotRecommendedAmounts(requirement, partners, {}, previousAdjustments, {
      recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() },
    });

    const a = result.find((r) => r.shareId === "a");
    expect(a?.baseAmount).toBe("100000");
    expect(a?.previousExtraPaid).toBe("500000");
    expect(a?.recommendedAmount).toBe("0");
  });

  it("the first-ever requirement for a Project (no previous investment_adjustments rows at all) -> previousPending/previousExtraPaid both '0', recommendedAmount === baseAmount, for every share", async () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "60" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "40" as Percent }),
    ];

    const result = await snapshotRecommendedAmounts(requirement, partners, {}, {}, {
      recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() },
    });

    for (const row of result) {
      expect(row.previousPending).toBe("0");
      expect(row.previousExtraPaid).toBe("0");
      expect(row.recommendedAmount).toBe(row.baseAmount);
    }
  });

  it("a previous 'none' adjustment yields previousPending/previousExtraPaid both '0', recommendedAmount === baseAmount", async () => {
    const requirement = makeRequirement({ amount: "300000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const previousAdjustments = byShareKey([
      makeAdjustment({ partyType: "partner", shareId: "a", adjustmentType: "none", adjustmentAmount: "0" as Money }),
    ]);

    const result = await snapshotRecommendedAmounts(requirement, partners, {}, previousAdjustments, {
      recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() },
    });

    const a = result.find((r) => r.shareId === "a");
    expect(a?.previousPending).toBe("0");
    expect(a?.previousExtraPaid).toBe("0");
    expect(a?.recommendedAmount).toBe(a?.baseAmount);
  });

  it("snapshots a Sub-partner against its own (partyType, shareId) -- distinct carry-forward from its parent Partner's own row", async () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub-1", partnerId: "a", name: "Sub 1", sharePercent: "50" as Percent })],
    };
    const previousAdjustments = byShareKey([
      makeAdjustment({
        partyType: "sub_partner",
        shareId: "sub-1",
        adjustmentType: "pending",
        adjustmentAmount: "50000" as Money,
      }),
    ]);

    const result = await snapshotRecommendedAmounts(requirement, partners, subsByPartnerId, previousAdjustments, {
      recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() },
    });

    const sub = result.find((r) => r.partyType === "sub_partner" && r.shareId === "sub-1");
    expect(sub?.baseAmount).toBe("500000");
    expect(sub?.previousPending).toBe("50000");
    expect(sub?.recommendedAmount).toBe("550000");

    const partnerOwn = result.find((r) => r.partyType === "partner" && r.shareId === "a");
    expect(partnerOwn?.previousPending).toBe("0");
  });

  it("calls snapshotAll exactly ONCE, with one input per Partner and per Sub-partner (never a per-share loop calling a single-row method N times) -- the atomicity guarantee this story's fix relies on", async () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub-1", partnerId: "a", name: "Sub 1", sharePercent: "50" as Percent })],
    };

    await snapshotRecommendedAmounts(requirement, partners, subsByPartnerId, {}, {
      recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() },
    });

    // Exactly one call to the port, not one call per share -- the whole
    // batch is handed to `snapshotAll` in a single array, so `packages/db`'s
    // implementation can write it all inside one DB transaction.
    expect(snapshotAll).toHaveBeenCalledTimes(1);
    const [inputs] = snapshotAll.mock.calls[0] as [SnapshotRecommendedAmountInput[]];
    expect(inputs).toHaveLength(3);
    expect(inputs.map((i) => `${i.partyType}:${i.shareId}`).sort()).toEqual(
      ["partner:a", "partner:b", "sub_partner:sub-1"].sort(),
    );
  });

  it("calls snapshotAll -- never an upsert -- with the requirement's own id/projectId threaded through every input in the batch", async () => {
    const requirement = makeRequirement({ id: "req-42", projectId: "project-42", amount: "500000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

    await snapshotRecommendedAmounts(requirement, partners, {}, {}, { recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() } });

    expect(snapshotAll).toHaveBeenCalledWith([
      expect.objectContaining({ requirementId: "req-42", projectId: "project-42", partyType: "partner", shareId: "a" }),
    ]);
  });

  it("writes all Recommended Amount rows atomically -- a batch write failure leaves NO rows for the requirement (never a partial snapshot)", async () => {
    const requirement = makeRequirement({ id: "req-atomic", amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];

    // Simulates `packages/db`'s `database.transaction(...)` rolling back
    // entirely on a failure partway through the batch insert (e.g. a
    // transient connection error) -- a real transactional implementation
    // never partially commits rows before throwing, so this fake doesn't
    // either.
    const rows: RecommendedAmount[] = [];
    const failingSnapshotAll = vi.fn(
      async (_inputs: SnapshotRecommendedAmountInput[]): Promise<RecommendedAmount[]> => {
        throw new Error("simulated transient connection error partway through the batch insert");
      },
    );
    const findByRequirementId = vi.fn(async (requirementId: string) =>
      rows.filter((r) => r.requirementId === requirementId),
    );

    await expect(
      snapshotRecommendedAmounts(requirement, partners, {}, {}, {
        recommendedAmounts: { snapshotAll: failingSnapshotAll, findByRequirementId },
      }),
    ).rejects.toThrow("simulated transient connection error");

    // Called exactly once, with the full 2-share batch -- proving by
    // construction that there is no possibility of a partial write from
    // `snapshotRecommendedAmounts`'s own side (it never loops calling a
    // single-row method).
    expect(failingSnapshotAll).toHaveBeenCalledTimes(1);
    const [inputs] = failingSnapshotAll.mock.calls[0] as [SnapshotRecommendedAmountInput[]];
    expect(inputs).toHaveLength(2);

    // Nothing was committed -- no partial rows exist for this requirement.
    const after = await findByRequirementId("req-atomic");
    expect(after).toEqual([]);
  });

  it("lets SharesNotFullyAllocatedError propagate unchanged, before ever calling snapshot", async () => {
    const requirement = makeRequirement();
    const partners = [
      makePartner({ partnerId: "a", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", sharePercent: "30" as Percent }),
    ];

    await expect(
      snapshotRecommendedAmounts(requirement, partners, {}, {}, { recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() } }),
    ).rejects.toThrow(SharesNotFullyAllocatedError);
    expect(snapshotAll).not.toHaveBeenCalled();
  });

  it("lets SubPartnerSharesOverAllocatedError propagate unchanged, before ever calling snapshot", async () => {
    const requirement = makeRequirement();
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" as Percent })],
    };

    await expect(
      snapshotRecommendedAmounts(requirement, partners, subsByPartnerId, {}, {
        recommendedAmounts: { snapshotAll, findByRequirementId: vi.fn() },
      }),
    ).rejects.toThrow(SubPartnerSharesOverAllocatedError);
    expect(snapshotAll).not.toHaveBeenCalled();
  });
});

describe("mergeRecommendedAmounts", () => {
  function makePartnerShouldPay(overrides: Partial<PartnerShouldPay> = {}): PartnerShouldPay {
    return {
      partnerId: "a",
      name: "A",
      sharePercent: "50" as Percent,
      shouldPay: "500000" as Money,
      ownShouldPay: "500000" as Money,
      subPartners: [],
      ...overrides,
    };
  }

  it("merges recommendedAmount/previousPending/previousExtraPaid into a Partner's entry when a matching RecommendedAmount exists", () => {
    const partners = [makePartnerShouldPay()];
    const recommendedAmounts: RecommendedAmount[] = [
      {
        id: "ra-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        baseAmount: "500000" as Money,
        previousPending: "0" as Money,
        previousExtraPaid: "200000" as Money,
        recommendedAmount: "300000" as Money,
        createdAt: new Date().toISOString(),
      },
    ];

    const merged = mergeRecommendedAmounts(partners, recommendedAmounts);

    expect(merged[0]?.recommendedAmount).toBe("300000");
    expect(merged[0]?.previousPending).toBe("0");
    expect(merged[0]?.previousExtraPaid).toBe("200000");
    // Every original PartnerShouldPay field survives the merge unchanged.
    expect(merged[0]?.shouldPay).toBe("500000");
    expect(merged[0]?.name).toBe("A");
  });

  it("merges into a nested Sub-partner's entry independently of its parent Partner", () => {
    const partners = [
      makePartnerShouldPay({
        subPartners: [
          {
            subPartnerId: "sub-1",
            name: "Sub 1",
            sharePercent: "25" as Percent,
            shouldPay: "250000" as Money,
          },
        ],
      }),
    ];
    const recommendedAmounts: RecommendedAmount[] = [
      {
        id: "ra-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "sub_partner",
        shareId: "sub-1",
        baseAmount: "250000" as Money,
        previousPending: "50000" as Money,
        previousExtraPaid: "0" as Money,
        recommendedAmount: "300000" as Money,
        createdAt: new Date().toISOString(),
      },
    ];

    const merged = mergeRecommendedAmounts(partners, recommendedAmounts);

    expect(merged[0]?.recommendedAmount).toBeUndefined();
    expect(merged[0]?.subPartners[0]?.recommendedAmount).toBe("300000");
    expect(merged[0]?.subPartners[0]?.previousPending).toBe("50000");
  });

  it("leaves recommendedAmount/previousPending/previousExtraPaid undefined for a pre-existing requirement with no recommended_amounts rows -- no error, no crash", () => {
    const partners = [makePartnerShouldPay()];

    const merged = mergeRecommendedAmounts(partners, []);

    expect(merged[0]?.recommendedAmount).toBeUndefined();
    expect(merged[0]?.previousPending).toBeUndefined();
    expect(merged[0]?.previousExtraPaid).toBeUndefined();
    expect(merged[0]?.shouldPay).toBe("500000");
  });

  it("leaves recommendedAmount undefined (but still merges previousPending/previousExtraPaid) when the snapshot's recommendedAmount is numerically equal to shouldPay -- the first-ever-requirement/no-carry-forward case, decimal-safe against numeric(14,2)'s zero-padding", () => {
    const partners = [makePartnerShouldPay({ shouldPay: "500000" as Money })];
    const recommendedAmounts: RecommendedAmount[] = [
      {
        id: "ra-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        baseAmount: "500000" as Money,
        previousPending: "0" as Money,
        previousExtraPaid: "0" as Money,
        // Simulates the value round-tripping through Postgres's numeric(14,2)
        // column -- padded, but numerically identical to shouldPay ("500000").
        recommendedAmount: "500000.00" as Money,
        createdAt: new Date().toISOString(),
      },
    ];

    const merged = mergeRecommendedAmounts(partners, recommendedAmounts);

    expect(merged[0]?.recommendedAmount).toBeUndefined();
    expect(merged[0]?.previousPending).toBe("0");
    expect(merged[0]?.previousExtraPaid).toBe("0");
  });
});

describe("race-condition avoidance: viewing the new requirement's own /adjustments endpoint never retroactively changes an already-snapshotted recommended_amounts row", () => {
  it("demonstrates the core guarantee this story exists for", async () => {
    const investmentAdjustments = makeFakeInvestmentAdjustmentPort();
    const recommendedAmounts = makeFakeRecommendedAmountPort();

    // A previous round already established Partner A as Extra Paid 2,00,000
    // (simulating an earlier view of that round's `GET .../adjustments`).
    await investmentAdjustments.upsert({
      projectId: "project-1",
      partyType: "partner",
      shareId: "a",
      requirementId: "prev-req",
      shouldPay: toMoney("500000"),
      actualPaid: toMoney("700000"),
      adjustmentType: "extra_paid",
      adjustmentAmount: toMoney("200000"),
    });

    const newRequirement = makeRequirement({ id: "new-req", amount: "1000000" as Money });
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

    // Route-layer step at creation time: read investment_adjustments' still-
    // intact previous-round row, then snapshot.
    const previousAdjustments = await investmentAdjustments.listByProjectId("project-1");
    await snapshotRecommendedAmounts(newRequirement, partners, {}, byShareKey(previousAdjustments), {
      recommendedAmounts,
    });

    const before = await recommendedAmounts.findByRequirementId("new-req");
    expect(before.find((r) => r.shareId === "a")?.recommendedAmount).toBe("800000"); // 1000000 (A's 100% Should Pay against the new requirement) - 200000 (previous Extra Paid)

    // Now simulate an Owner/Admin viewing the *new* requirement's own
    // `GET .../adjustments` (Story 3.4) -- this upserts (OVERWRITES)
    // investment_adjustments' single current row for A, e.g. because A
    // hasn't paid anything yet against the new requirement.
    await computeInvestmentAdjustment(newRequirement, partners, {}, {}, { investmentAdjustments });

    const overwritten = await investmentAdjustments.listByProjectId("project-1");
    expect(overwritten.find((a) => a.shareId === "a")?.adjustmentType).toBe("pending");
    expect(overwritten.find((a) => a.shareId === "a")?.requirementId).toBe("new-req");
    expect(overwritten.find((a) => a.shareId === "a")?.adjustmentAmount).toBe("1000000");

    // The already-snapshotted Recommended Amount for the new requirement is
    // completely unaffected by that overwrite.
    const after = await recommendedAmounts.findByRequirementId("new-req");
    expect(after).toEqual(before);
    expect(after.find((r) => r.shareId === "a")?.recommendedAmount).toBe("800000");
  });
});

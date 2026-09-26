import { describe, it, expect, vi } from "vitest";
import type {
  InvestmentAdjustment,
  InvestmentRequirement,
  InvestmentTransaction,
  Money,
  PartnerShare,
  Percent,
  RecommendedAmount,
  SubPartnerShare,
} from "@niveshbook/types";
import type { UpsertInvestmentAdjustmentInput } from "./investment-adjustment-port";
import {
  assembleMyInvestments,
  resolveMyInvestmentShares,
  type MyInvestmentsDeps,
  type MyInvestmentsRawData,
} from "./my-investments";

const now = new Date().toISOString();

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Asha",
    sharePercent: "100" as Percent,
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeSubPartnerShare(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  return {
    id: "sub-row-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Bala",
    sharePercent: "40" as Percent,
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeRequirement(overrides: Partial<InvestmentRequirement> = {}): InvestmentRequirement {
  return {
    id: "req-1",
    projectId: "project-a",
    amount: "1000000" as Money,
    requirementDate: "2026-09-01",
    createdAt: now,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "itx-1",
    requirementId: "req-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "100" as Percent,
    shouldPaySnapshot: "1000000" as Money,
    amount: "1000000" as Money,
    transactionDate: "2026-09-02",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: now,
    ...overrides,
  };
}

function makeRecommendedAmount(overrides: Partial<RecommendedAmount> = {}): RecommendedAmount {
  return {
    id: "rec-1",
    requirementId: "req-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    baseAmount: "600000" as Money,
    previousPending: "50000" as Money,
    previousExtraPaid: "0" as Money,
    recommendedAmount: "650000" as Money,
    createdAt: now,
    ...overrides,
  };
}

/**
 * Fake deps: the adjustment port's `upsert` echoes its input back as the
 * persisted row (mirroring `computeInvestmentAdjustment`'s "the persisted
 * row's values are returned" contract); requirements/transactions/
 * recommended-amounts are looked up from plain fixture maps.
 */
function makeDeps(fixtures: {
  requirementsByProjectId?: Record<string, InvestmentRequirement[]>;
  transactionsByRequirementId?: Record<string, InvestmentTransaction[]>;
  recommendedByRequirementId?: Record<string, RecommendedAmount[]>;
}): MyInvestmentsDeps {
  return {
    investmentRequirements: {
      listByProjectId: vi.fn(async (projectId: string) => {
        // eslint-disable-next-line security/detect-object-injection -- test fixture lookup
        return fixtures.requirementsByProjectId?.[projectId] ?? [];
      }),
    },
    investmentTransactions: {
      listByRequirementId: vi.fn(async (requirementId: string) => {
        // eslint-disable-next-line security/detect-object-injection -- test fixture lookup
        return fixtures.transactionsByRequirementId?.[requirementId] ?? [];
      }),
    },
    recommendedAmounts: {
      findByRequirementId: vi.fn(async (requirementId: string) => {
        // eslint-disable-next-line security/detect-object-injection -- test fixture lookup
        return fixtures.recommendedByRequirementId?.[requirementId] ?? [];
      }),
    },
    investmentAdjustments: {
      upsert: vi.fn(async (input: UpsertInvestmentAdjustmentInput): Promise<InvestmentAdjustment> => {
        return { id: `adj-${input.partyType}-${input.shareId}`, updatedAt: now, createdAt: now, ...input };
      }),
      listByProjectId: vi.fn(),
      listAll: vi.fn(),
    },
  };
}

const PROJECT_NAMES = { "project-a": "Project A", "project-b": "Project B" };

describe("resolveMyInvestmentShares", () => {
  const partnerShares = [
    makePartnerShare({ id: "p1", partnerId: "partner-1", userId: "user-1" }),
    makePartnerShare({ id: "p2", partnerId: "partner-2", userId: "someone-else", name: "Deepa" }),
    makePartnerShare({ id: "p3", partnerId: "partner-3", userId: null, name: "Unlinked" }),
  ];
  const subPartnerShares = [
    makeSubPartnerShare({ id: "s1", subPartnerId: "sub-1", projectId: "project-b", userId: "USER-1" }),
    makeSubPartnerShare({ id: "s2", subPartnerId: "sub-2", userId: "third-user", name: "Chetan" }),
  ];

  it("owner_admin selects every current share in both lists", () => {
    const result = resolveMyInvestmentShares("owner_admin", "owner-1", partnerShares, subPartnerShares);
    expect(result.partnerShares).toHaveLength(3);
    expect(result.subPartnerShares).toHaveLength(2);
  });

  it("a non-admin actor selects only their own userId's rows -- from BOTH lists, case-insensitively (the multi-role pool case)", () => {
    const result = resolveMyInvestmentShares("partner", "user-1", partnerShares, subPartnerShares);
    expect(result.partnerShares.map((share) => share.partnerId)).toEqual(["partner-1"]);
    // "USER-1" matches "user-1" -- mirrors resolveMoneyHistoryScope's convention.
    expect(result.subPartnerShares.map((share) => share.subPartnerId)).toEqual(["sub-1"]);
  });

  it("an actor with zero linked shares selects nothing (never the userId:null rows)", () => {
    const result = resolveMyInvestmentShares("sub_partner", "ghost", partnerShares, subPartnerShares);
    expect(result.partnerShares).toEqual([]);
    expect(result.subPartnerShares).toEqual([]);
  });
});

describe("assembleMyInvestments", () => {
  it("partner with shares in 2 of 4 projects: only those 2 projects, own numbers only", async () => {
    const raw: MyInvestmentsRawData = {
      allCurrentPartnerShares: [
        makePartnerShare({ id: "p1", partnerId: "partner-1", projectId: "project-a", userId: "user-1", sharePercent: "60" as Percent }),
        makePartnerShare({ id: "p2", partnerId: "partner-2", projectId: "project-a", userId: "someone-else", name: "Deepa", sharePercent: "40" as Percent }),
        makePartnerShare({ id: "p3", partnerId: "partner-3", projectId: "project-b", userId: "user-1", name: "Asha", sharePercent: "100" as Percent }),
        makePartnerShare({ id: "p4", partnerId: "partner-4", projectId: "project-c", userId: "someone-else", name: "Deepa" }),
        makePartnerShare({ id: "p5", partnerId: "partner-5", projectId: "project-d", userId: null, name: "Unlinked" }),
      ],
      allCurrentSubPartnerShares: [],
      projectNamesById: { ...PROJECT_NAMES, "project-c": "Project C", "project-d": "Project D" },
    };
    const deps = makeDeps({
      requirementsByProjectId: {
        "project-a": [makeRequirement({ id: "req-1", projectId: "project-a", amount: "1000000" as Money })],
      },
      transactionsByRequirementId: {
        "req-1": [
          makeTransaction({ id: "t1", shareId: "partner-1", amount: "400000" as Money }),
          // Another partner's payment -- must never surface in the actor's entry.
          makeTransaction({ id: "t2", shareId: "partner-2", amount: "999999" as Money }),
          // Cancelled -- excluded before computation (Story 3.8's filter).
          makeTransaction({ id: "t3", shareId: "partner-1", amount: "77777" as Money, status: "cancelled" }),
        ],
      },
    });

    const entries = await assembleMyInvestments("partner", "user-1", raw, deps);

    expect(entries.map((entry) => entry.projectId)).toEqual(["project-a", "project-b"]);
    expect(entries.map((entry) => entry.projectName)).toEqual(["Project A", "Project B"]);
    expect(entries.every((entry) => entry.role === "partner")).toBe(true);

    const projectA = entries[0]!;
    expect(projectA.sharePercent).toBe("60");
    expect(projectA.requirements).toHaveLength(1);
    // Own numbers: 60% of 1000000 = 600000 should-pay, 400000 paid, 200000 pending.
    expect(projectA.requirements[0]).toMatchObject({
      requirementId: "req-1",
      requirementDate: "2026-09-01",
      requirementAmount: "1000000",
      status: {
        shouldPay: "600000",
        actualPaid: "400000",
        adjustmentType: "pending",
        adjustmentAmount: "200000",
      },
    });
    // No other-party names or amounts anywhere in the response (FR10).
    expect(JSON.stringify(entries)).not.toContain("Deepa");
    expect(JSON.stringify(entries)).not.toContain("999999");

    // Project B has no requirements yet -- entry still present, empty list.
    expect(entries[1]!.requirements).toEqual([]);
  });

  it("sub-partner in 1 project: own slice only -- no sibling or parent figures", async () => {
    const raw: MyInvestmentsRawData = {
      allCurrentPartnerShares: [
        makePartnerShare({ id: "p1", partnerId: "partner-1", projectId: "project-a", name: "Asha", sharePercent: "100" as Percent }),
      ],
      allCurrentSubPartnerShares: [
        makeSubPartnerShare({ id: "s1", subPartnerId: "sub-1", partnerId: "partner-1", projectId: "project-a", userId: "user-9", sharePercent: "40" as Percent }),
        makeSubPartnerShare({ id: "s2", subPartnerId: "sub-2", partnerId: "partner-1", projectId: "project-a", userId: "sibling", name: "Chetan", sharePercent: "10" as Percent }),
      ],
      projectNamesById: PROJECT_NAMES,
    };
    const deps = makeDeps({
      requirementsByProjectId: {
        "project-a": [makeRequirement({ id: "req-1", amount: "1000000" as Money })],
      },
      transactionsByRequirementId: {
        "req-1": [
          makeTransaction({ id: "t1", partyType: "sub_partner", shareId: "sub-1", amount: "450000" as Money }),
          makeTransaction({ id: "t2", partyType: "partner", shareId: "partner-1", amount: "111111" as Money }),
        ],
      },
    });

    const entries = await assembleMyInvestments("sub_partner", "user-9", raw, deps);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      projectId: "project-a",
      role: "sub_partner",
      shareId: "sub-1",
      name: "Bala",
      sharePercent: "40",
    });
    // 40% of 1000000 = 400000 should-pay, 450000 paid -> extra_paid 50000.
    expect(entries[0]!.requirements[0]!.status).toMatchObject({
      shouldPay: "400000",
      actualPaid: "450000",
      adjustmentType: "extra_paid",
      adjustmentAmount: "50000",
    });
    // Neither the sibling's name/percent nor the parent Partner's figures leak (FR10).
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("Chetan");
    expect(serialized).not.toContain("Asha");
    expect(serialized).not.toContain("111111");
  });

  it("owner_admin: every project, every party -- partner and sub-partner entries alike, deterministically sorted", async () => {
    const raw: MyInvestmentsRawData = {
      allCurrentPartnerShares: [
        makePartnerShare({ id: "p1", partnerId: "partner-1", projectId: "project-b", name: "Asha", userId: null }),
        makePartnerShare({ id: "p2", partnerId: "partner-2", projectId: "project-a", name: "Deepa", userId: "u2", sharePercent: "100" as Percent }),
      ],
      allCurrentSubPartnerShares: [
        makeSubPartnerShare({ id: "s1", subPartnerId: "sub-1", partnerId: "partner-2", projectId: "project-a", name: "Bala", userId: null }),
      ],
      projectNamesById: PROJECT_NAMES,
    };
    const deps = makeDeps({});

    const entries = await assembleMyInvestments("owner_admin", "owner-1", raw, deps);

    expect(entries.map((entry) => [entry.projectName, entry.role, entry.name])).toEqual([
      ["Project A", "partner", "Deepa"],
      ["Project A", "sub_partner", "Bala"],
      ["Project B", "partner", "Asha"],
    ]);
  });

  it("no current shares: empty list (the page's EmptyState case), zero port reads", async () => {
    const deps = makeDeps({});
    const entries = await assembleMyInvestments(
      "partner",
      "user-1",
      { allCurrentPartnerShares: [], allCurrentSubPartnerShares: [], projectNamesById: {} },
      deps,
    );

    expect(entries).toEqual([]);
    expect(deps.investmentRequirements.listByProjectId).not.toHaveBeenCalled();
  });

  it("merges the Recommended Amount snapshot only when it differs from the own should-pay", async () => {
    const raw: MyInvestmentsRawData = {
      allCurrentPartnerShares: [
        makePartnerShare({ id: "p1", partnerId: "partner-1", projectId: "project-a", userId: "user-1", sharePercent: "60" as Percent }),
        makePartnerShare({ id: "p2", partnerId: "partner-2", projectId: "project-a", userId: "user-1", name: "Asha 2", sharePercent: "40" as Percent }),
      ],
      allCurrentSubPartnerShares: [],
      projectNamesById: PROJECT_NAMES,
    };
    const deps = makeDeps({
      requirementsByProjectId: {
        "project-a": [makeRequirement({ id: "req-1", amount: "1000000" as Money })],
      },
      recommendedByRequirementId: {
        "req-1": [
          // Differs from partner-1's own 600000 should-pay -> surfaces.
          makeRecommendedAmount({ id: "r1", shareId: "partner-1", recommendedAmount: "650000" as Money }),
          // Equals partner-2's own 400000 should-pay -> omitted as noise.
          makeRecommendedAmount({ id: "r2", shareId: "partner-2", recommendedAmount: "400000" as Money }),
        ],
      },
    });

    const entries = await assembleMyInvestments("partner", "user-1", raw, deps);

    const first = entries.find((entry) => entry.shareId === "partner-1")!;
    const second = entries.find((entry) => entry.shareId === "partner-2")!;
    expect(first.requirements[0]!.status?.recommendedAmount).toBe("650000");
    expect(second.requirements[0]!.status).not.toHaveProperty("recommendedAmount");
  });

  it("a Project whose shares are not fully allocated yields status: null for its requirements, never a throw across the whole list", async () => {
    const raw: MyInvestmentsRawData = {
      allCurrentPartnerShares: [
        // 60% alone -- computeShouldPay's SharesNotFullyAllocatedError case.
        makePartnerShare({ id: "p1", partnerId: "partner-1", projectId: "project-a", userId: "user-1", sharePercent: "60" as Percent }),
        makePartnerShare({ id: "p2", partnerId: "partner-2", projectId: "project-b", userId: "user-1", sharePercent: "100" as Percent }),
      ],
      allCurrentSubPartnerShares: [],
      projectNamesById: PROJECT_NAMES,
    };
    const deps = makeDeps({
      requirementsByProjectId: {
        "project-a": [makeRequirement({ id: "req-1", projectId: "project-a" })],
        "project-b": [makeRequirement({ id: "req-2", projectId: "project-b", amount: "500000" as Money })],
      },
      transactionsByRequirementId: {
        "req-2": [makeTransaction({ id: "t1", requirementId: "req-2", projectId: "project-b", shareId: "partner-2", amount: "500000" as Money })],
      },
    });

    const entries = await assembleMyInvestments("partner", "user-1", raw, deps);

    expect(entries).toHaveLength(2);
    const broken = entries.find((entry) => entry.projectId === "project-a")!;
    const healthy = entries.find((entry) => entry.projectId === "project-b")!;
    expect(broken.requirements).toHaveLength(1);
    expect(broken.requirements[0]!.status).toBeNull();
    expect(healthy.requirements[0]!.status).toMatchObject({
      shouldPay: "500000",
      actualPaid: "500000",
      adjustmentType: "none",
      adjustmentAmount: "0",
    });
  });
});

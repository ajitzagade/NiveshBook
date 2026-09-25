import { describe, it, expect } from "vitest";
import type {
  AvailableBalance,
  InvestmentAdjustment,
  InvestmentTransaction,
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
  WithdrawalAdjustment,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { assemblePartnerDashboard, type PartnerDashboardRawData } from "./partner-dashboard";

function makeInvestmentTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "inv-1",
    requirementId: "req-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "100" as Percent,
    shouldPaySnapshot: "1000000" as Money,
    amount: "1000000" as Money,
    transactionDate: "2026-09-01",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWithdrawalTransaction(overrides: Partial<WithdrawalTransaction> = {}): WithdrawalTransaction {
  return {
    id: "wd-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "100" as Percent,
    canTakeSnapshot: "1000000" as Money,
    amount: "500000" as Money,
    transactionDate: "2026-09-10",
    paymentMode: "cash",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAvailableBalance(overrides: Partial<AvailableBalance> = {}): AvailableBalance {
  return {
    id: "bal-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    balance: "0" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInvestmentAdjustment(overrides: Partial<InvestmentAdjustment> = {}): InvestmentAdjustment {
  return {
    id: "adj-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    requirementId: "req-1",
    shouldPay: "100000" as Money,
    actualPaid: "60000" as Money,
    adjustmentType: "pending",
    adjustmentAmount: "40000" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWithdrawalAdjustment(overrides: Partial<WithdrawalAdjustment> = {}): WithdrawalAdjustment {
  return {
    id: "wadj-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    canTake: "100000" as Money,
    taken: "60000" as Money,
    adjustmentType: "keep_for_later",
    adjustmentAmount: "40000" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "share-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Asha",
    sharePercent: "100" as Percent,
    userId: "user-asha",
    subPartnerVisibilityGrant: false,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSubPartnerShare(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  return {
    id: "sub-share-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Bala",
    sharePercent: "50" as Percent,
    userId: null,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRaw(overrides: Partial<PartnerDashboardRawData> = {}): PartnerDashboardRawData {
  return {
    investmentTransactions: [],
    withdrawalTransactions: [],
    availableBalances: [],
    investmentAdjustments: [],
    withdrawalAdjustments: [],
    currentPartnerShares: [],
    currentSubPartnerShares: [],
    projectNamesById: { "project-a": "Project A" },
    ...overrides,
  };
}

const ACTOR = "user-asha";

describe("assemblePartnerDashboard", () => {
  it("Partner with activity in one Project (AC): all data points shown, scoped to that Partner only", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR, sharePercent: "60" as Percent })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "partner-1", amount: "700000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", shareId: "partner-1", amount: "200000" as Money }),
      ],
      availableBalances: [makeAvailableBalance({ id: "bal-1", shareId: "partner-1", balance: "50000" as Money })],
      investmentAdjustments: [
        makeInvestmentAdjustment({ id: "adj-1", shareId: "partner-1", adjustmentType: "pending", adjustmentAmount: "30000" as Money }),
      ],
      withdrawalAdjustments: [
        makeWithdrawalAdjustment({ id: "wadj-1", shareId: "partner-1", adjustmentType: "keep_for_later", adjustmentAmount: "15000" as Money }),
      ],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toEqual([
      { projectId: "project-a", projectName: "Project A", partnerId: "partner-1", sharePercent: "60" },
    ]);
    expect(result.totalMoneyAdded).toBe("700000");
    expect(result.totalMoneyWithdrawn).toBe("200000");
    expect(result.totalAvailableBalance).toBe("50000");
    expect(result.totalPending).toBe("30000");
    expect(result.totalExtraPaid).toBe("0");
    expect(result.totalKeepForLater).toBe("15000");
    expect(result.totalExtraTaken).toBe("0");
    expect(result.mySubPartners).toEqual([]);
  });

  it("Partner linked to multiple Projects: myProjects shows one row per Project; the 6 aggregate totals sum across all of them", () => {
    const raw = makeRaw({
      currentPartnerShares: [
        makePartnerShare({ id: "s1", partnerId: "partner-1", projectId: "project-a", userId: ACTOR }),
        makePartnerShare({ id: "s2", partnerId: "partner-2", projectId: "project-b", userId: ACTOR }),
        makePartnerShare({ id: "s3", partnerId: "partner-3", projectId: "project-c", userId: ACTOR }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", projectId: "project-a", shareId: "partner-1", amount: "100000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", projectId: "project-b", shareId: "partner-2", amount: "200000" as Money }),
        makeInvestmentTransaction({ id: "inv-3", projectId: "project-c", shareId: "partner-3", amount: "300000" as Money }),
      ],
      projectNamesById: { "project-a": "Project A", "project-b": "Project B", "project-c": "Project C" },
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toHaveLength(3);
    expect(result.myProjects.map((row) => row.projectName).sort()).toEqual(["Project A", "Project B", "Project C"]);
    expect(result.totalMoneyAdded).toBe("600000");
  });

  it("Partner with no activity yet: aggregate totals are all '0'; myProjects still shows the linked Project", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR })],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toHaveLength(1);
    expect(result.totalMoneyAdded).toBe("0");
    expect(result.totalMoneyWithdrawn).toBe("0");
    expect(result.totalAvailableBalance).toBe("0");
    expect(result.totalPending).toBe("0");
    expect(result.totalExtraPaid).toBe("0");
    expect(result.totalKeepForLater).toBe("0");
    expect(result.totalExtraTaken).toBe("0");
  });

  it("Partner with Sub-partners: mySubPartners lists both, regardless of subPartnerVisibilityGrant", () => {
    const raw = makeRaw({
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", userId: ACTOR, subPartnerVisibilityGrant: false }),
      ],
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1", name: "Bala" }),
        makeSubPartnerShare({ subPartnerId: "sub-2", partnerId: "partner-1", name: "Chetan" }),
      ],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.mySubPartners).toHaveLength(2);
    expect(result.mySubPartners.map((row) => row.name).sort()).toEqual(["Bala", "Chetan"]);
  });

  it("Partner with no Sub-partners: mySubPartners is an empty array, not a crash", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR })],
    });

    expect(() => assemblePartnerDashboard(ACTOR, raw)).not.toThrow();
    const result = assemblePartnerDashboard(ACTOR, raw);
    expect(result.mySubPartners).toEqual([]);
  });

  it("Pending/Extra Paid summed separately by adjustmentType, never netted (AD-4)", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR })],
      investmentAdjustments: [
        makeInvestmentAdjustment({
          id: "adj-1",
          requirementId: "req-1",
          shareId: "partner-1",
          adjustmentType: "pending",
          adjustmentAmount: "40000" as Money,
        }),
        makeInvestmentAdjustment({
          id: "adj-2",
          requirementId: "req-2",
          shareId: "partner-1",
          adjustmentType: "extra_paid",
          adjustmentAmount: "15000" as Money,
        }),
        makeInvestmentAdjustment({
          id: "adj-3",
          requirementId: "req-3",
          shareId: "partner-1",
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        }),
      ],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.totalPending).toBe("40000");
    expect(result.totalExtraPaid).toBe("15000");
  });

  it("Keep for Later/Extra Taken summed separately by adjustmentType, never netted (AD-4)", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR })],
      withdrawalAdjustments: [
        makeWithdrawalAdjustment({
          id: "wadj-1",
          shareId: "partner-1",
          adjustmentType: "keep_for_later",
          adjustmentAmount: "25000" as Money,
        }),
        makeWithdrawalAdjustment({
          id: "wadj-2",
          shareId: "partner-1",
          adjustmentType: "extra_taken",
          adjustmentAmount: "10000" as Money,
        }),
      ],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.totalKeepForLater).toBe("25000");
    expect(result.totalExtraTaken).toBe("10000");
  });

  it("excludes cancelled investment/withdrawal transactions from every aggregate sum", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "partner-1", amount: "500000" as Money, status: "active" }),
        makeInvestmentTransaction({ id: "inv-2", shareId: "partner-1", amount: "999999" as Money, status: "cancelled" }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", shareId: "partner-1", amount: "100000" as Money, status: "active" }),
        makeWithdrawalTransaction({ id: "wd-2", shareId: "partner-1", amount: "888888" as Money, status: "cancelled" }),
      ],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.totalMoneyAdded).toBe("500000");
    expect(result.totalMoneyWithdrawn).toBe("100000");
  });

  it("scoping: excludes another Partner's own current Partner Share (different userId) entirely -- not in myProjects, not in totals", () => {
    const raw = makeRaw({
      currentPartnerShares: [
        makePartnerShare({ id: "s1", partnerId: "partner-1", userId: ACTOR }),
        makePartnerShare({ id: "s2", partnerId: "partner-2", userId: "user-someone-else", name: "Deepa" }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "partner-1", amount: "100000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", shareId: "partner-2", amount: "999999" as Money }),
      ],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toHaveLength(1);
    expect(result.myProjects[0]?.partnerId).toBe("partner-1");
    expect(result.totalMoneyAdded).toBe("100000");
  });

  it("scoping: excludes an unlinked current Partner Share (userId: null) -- never matches any actor", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: null })],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toEqual([]);
    expect(result.totalMoneyAdded).toBe("0");
  });

  it("scoping: a Sub-partner's own transactions (partyType: 'sub_partner') under the actor's own Partner Share are NEVER rolled into the actor's totals -- this story's own dashboard, unlike Story 5.4's, keeps Sub-partner money separate", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR })],
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1" })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", partyType: "partner", shareId: "partner-1", amount: "100000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", partyType: "sub_partner", shareId: "sub-1", amount: "500000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", partyType: "sub_partner", shareId: "sub-1", amount: "20000" as Money }),
      ],
      availableBalances: [
        makeAvailableBalance({ id: "bal-1", partyType: "sub_partner", shareId: "sub-1", balance: "5000" as Money }),
      ],
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    // Only the Partner's own 100000 counts -- the Sub-partner's 500000 investment, 20000 withdrawal, and 5000 balance are all excluded.
    expect(result.totalMoneyAdded).toBe("100000");
    expect(result.totalMoneyWithdrawn).toBe("0");
    expect(result.totalAvailableBalance).toBe("0");
    // But the Sub-partner still shows up structurally in mySubPartners.
    expect(result.mySubPartners).toHaveLength(1);
  });

  it("falls back to 'Unknown Project' when projectNamesById has no entry, for both myProjects and mySubPartners", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", projectId: "ghost-project", userId: ACTOR })],
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1", projectId: "ghost-project" }),
      ],
      projectNamesById: {},
    });

    const result = assemblePartnerDashboard(ACTOR, raw);

    expect(result.myProjects[0]?.projectName).toBe("Unknown Project");
    expect(result.mySubPartners[0]?.projectName).toBe("Unknown Project");
  });

  it("case-insensitive userId match, mirroring resolveMoneyHistoryScope()'s own convention", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: "USER-ASHA" })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "partner-1", amount: "100000" as Money }),
      ],
    });

    const result = assemblePartnerDashboard("user-asha", raw);

    expect(result.myProjects).toHaveLength(1);
    expect(result.totalMoneyAdded).toBe("100000");
  });
});

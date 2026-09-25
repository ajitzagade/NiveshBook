import { describe, it, expect } from "vitest";
import type {
  AvailableBalance,
  InvestmentAdjustment,
  InvestmentTransaction,
  Money,
  Percent,
  SubPartnerShare,
  WithdrawalAdjustment,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { assembleSubPartnerDashboard, type SubPartnerDashboardRawData } from "./sub-partner-dashboard";

function makeInvestmentTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "inv-1",
    requirementId: "req-1",
    projectId: "project-a",
    partyType: "sub_partner",
    shareId: "sub-1",
    sharePercentSnapshot: "50" as Percent,
    shouldPaySnapshot: "500000" as Money,
    amount: "500000" as Money,
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
    partyType: "sub_partner",
    shareId: "sub-1",
    sharePercentSnapshot: "50" as Percent,
    canTakeSnapshot: "500000" as Money,
    amount: "200000" as Money,
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
    partyType: "sub_partner",
    shareId: "sub-1",
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
    partyType: "sub_partner",
    shareId: "sub-1",
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
    partyType: "sub_partner",
    shareId: "sub-1",
    canTake: "100000" as Money,
    taken: "60000" as Money,
    adjustmentType: "keep_for_later",
    adjustmentAmount: "40000" as Money,
    updatedAt: new Date().toISOString(),
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
    userId: "user-bala",
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRaw(overrides: Partial<SubPartnerDashboardRawData> = {}): SubPartnerDashboardRawData {
  return {
    investmentTransactions: [],
    withdrawalTransactions: [],
    availableBalances: [],
    investmentAdjustments: [],
    withdrawalAdjustments: [],
    currentSubPartnerShares: [],
    projectNamesById: { "project-a": "Project A" },
    ...overrides,
  };
}

const ACTOR = "user-bala";

describe("assembleSubPartnerDashboard", () => {
  it("Sub-partner with activity in one Project (AC): all data points shown, scoped to that Sub-partner only", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", userId: ACTOR, sharePercent: "40" as Percent }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "sub-1", amount: "500000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", shareId: "sub-1", amount: "200000" as Money }),
      ],
      availableBalances: [makeAvailableBalance({ id: "bal-1", shareId: "sub-1", balance: "30000" as Money })],
      investmentAdjustments: [
        makeInvestmentAdjustment({ id: "adj-1", shareId: "sub-1", adjustmentType: "pending", adjustmentAmount: "10000" as Money }),
      ],
      withdrawalAdjustments: [
        makeWithdrawalAdjustment({ id: "wadj-1", shareId: "sub-1", adjustmentType: "keep_for_later", adjustmentAmount: "5000" as Money }),
      ],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toEqual([
      { projectId: "project-a", projectName: "Project A", subPartnerId: "sub-1", sharePercent: "40" },
    ]);
    expect(result.totalMoneyAdded).toBe("500000");
    expect(result.totalMoneyWithdrawn).toBe("200000");
    expect(result.totalAvailableBalance).toBe("30000");
    expect(result.totalPending).toBe("10000");
    expect(result.totalExtraPaid).toBe("0");
    expect(result.totalKeepForLater).toBe("5000");
    expect(result.totalExtraTaken).toBe("0");
  });

  it("Sub-partner linked to multiple Projects/Partners: myProjects shows one row per Project; the 6 aggregate totals sum across all of them", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [
        makeSubPartnerShare({ id: "s1", subPartnerId: "sub-1", partnerId: "partner-1", projectId: "project-a", userId: ACTOR }),
        makeSubPartnerShare({ id: "s2", subPartnerId: "sub-2", partnerId: "partner-2", projectId: "project-b", userId: ACTOR }),
        makeSubPartnerShare({ id: "s3", subPartnerId: "sub-3", partnerId: "partner-3", projectId: "project-c", userId: ACTOR }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", projectId: "project-a", shareId: "sub-1", amount: "100000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", projectId: "project-b", shareId: "sub-2", amount: "200000" as Money }),
        makeInvestmentTransaction({ id: "inv-3", projectId: "project-c", shareId: "sub-3", amount: "300000" as Money }),
      ],
      projectNamesById: { "project-a": "Project A", "project-b": "Project B", "project-c": "Project C" },
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toHaveLength(3);
    expect(result.myProjects.map((row) => row.projectName).sort()).toEqual(["Project A", "Project B", "Project C"]);
    expect(result.totalMoneyAdded).toBe("600000");
  });

  it("Sub-partner with no activity yet: aggregate totals are all '0'; myProjects still shows the linked Project", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", userId: ACTOR })],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toHaveLength(1);
    expect(result.totalMoneyAdded).toBe("0");
    expect(result.totalMoneyWithdrawn).toBe("0");
    expect(result.totalAvailableBalance).toBe("0");
    expect(result.totalPending).toBe("0");
    expect(result.totalExtraPaid).toBe("0");
    expect(result.totalKeepForLater).toBe("0");
    expect(result.totalExtraTaken).toBe("0");
  });

  it("Pending/Extra Paid summed separately by adjustmentType, never netted (AD-4)", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", userId: ACTOR })],
      investmentAdjustments: [
        makeInvestmentAdjustment({
          id: "adj-1",
          requirementId: "req-1",
          shareId: "sub-1",
          adjustmentType: "pending",
          adjustmentAmount: "40000" as Money,
        }),
        makeInvestmentAdjustment({
          id: "adj-2",
          requirementId: "req-2",
          shareId: "sub-1",
          adjustmentType: "extra_paid",
          adjustmentAmount: "15000" as Money,
        }),
        makeInvestmentAdjustment({
          id: "adj-3",
          requirementId: "req-3",
          shareId: "sub-1",
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        }),
      ],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.totalPending).toBe("40000");
    expect(result.totalExtraPaid).toBe("15000");
  });

  it("Keep for Later/Extra Taken summed separately by adjustmentType, never netted (AD-4)", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", userId: ACTOR })],
      withdrawalAdjustments: [
        makeWithdrawalAdjustment({
          id: "wadj-1",
          shareId: "sub-1",
          adjustmentType: "keep_for_later",
          adjustmentAmount: "25000" as Money,
        }),
        makeWithdrawalAdjustment({
          id: "wadj-2",
          shareId: "sub-1",
          adjustmentType: "extra_taken",
          adjustmentAmount: "10000" as Money,
        }),
      ],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.totalKeepForLater).toBe("25000");
    expect(result.totalExtraTaken).toBe("10000");
  });

  it("excludes cancelled investment/withdrawal transactions from every aggregate sum", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", userId: ACTOR })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "sub-1", amount: "500000" as Money, status: "active" }),
        makeInvestmentTransaction({ id: "inv-2", shareId: "sub-1", amount: "999999" as Money, status: "cancelled" }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", shareId: "sub-1", amount: "100000" as Money, status: "active" }),
        makeWithdrawalTransaction({ id: "wd-2", shareId: "sub-1", amount: "888888" as Money, status: "cancelled" }),
      ],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.totalMoneyAdded).toBe("500000");
    expect(result.totalMoneyWithdrawn).toBe("100000");
  });

  it("scoping: excludes another Sub-partner's own current Sub-partner Share (different userId) entirely -- not in myProjects, not in totals", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [
        makeSubPartnerShare({ id: "s1", subPartnerId: "sub-1", userId: ACTOR }),
        makeSubPartnerShare({ id: "s2", subPartnerId: "sub-2", userId: "user-someone-else", name: "Chetan" }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "sub-1", amount: "100000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", shareId: "sub-2", amount: "999999" as Money }),
      ],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toHaveLength(1);
    expect(result.myProjects[0]?.subPartnerId).toBe("sub-1");
    expect(result.totalMoneyAdded).toBe("100000");
  });

  it("scoping: excludes an unlinked current Sub-partner Share (userId: null) -- never matches any actor", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", userId: null })],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toEqual([]);
    expect(result.totalMoneyAdded).toBe("0");
  });

  it("scoping: a parent Partner's own transactions (partyType: 'partner') on the same shareId-shaped Project are NEVER rolled into the actor's totals (Decisions #4)", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1", userId: ACTOR })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", partyType: "sub_partner", shareId: "sub-1", amount: "100000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", partyType: "partner", shareId: "partner-1", amount: "5000000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", partyType: "partner", shareId: "partner-1", amount: "200000" as Money }),
      ],
      availableBalances: [
        makeAvailableBalance({ id: "bal-1", partyType: "partner", shareId: "partner-1", balance: "50000" as Money }),
      ],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    // Only the Sub-partner's own 100000 counts -- the parent Partner's 5000000 investment, 200000 withdrawal, and 50000 balance are all excluded.
    expect(result.totalMoneyAdded).toBe("100000");
    expect(result.totalMoneyWithdrawn).toBe("0");
    expect(result.totalAvailableBalance).toBe("0");
  });

  it("scoping: a sibling Sub-partner's own transactions (different subPartnerId, same parent Partner) are NEVER rolled into the actor's totals or myProjects (Decisions #4)", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [
        makeSubPartnerShare({ id: "s1", subPartnerId: "sub-1", partnerId: "partner-1", projectId: "project-a", userId: ACTOR }),
        makeSubPartnerShare({ id: "s2", subPartnerId: "sub-2", partnerId: "partner-1", projectId: "project-a", name: "Chetan", userId: "user-chetan" }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "sub-1", amount: "100000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", shareId: "sub-2", amount: "999999" as Money }),
      ],
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.myProjects).toHaveLength(1);
    expect(result.totalMoneyAdded).toBe("100000");
  });

  it("falls back to 'Unknown Project' when projectNamesById has no entry", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", projectId: "ghost-project", userId: ACTOR }),
      ],
      projectNamesById: {},
    });

    const result = assembleSubPartnerDashboard(ACTOR, raw);

    expect(result.myProjects[0]?.projectName).toBe("Unknown Project");
  });

  it("case-insensitive userId match, mirroring assemblePartnerDashboard()'s/resolveMoneyHistoryScope()'s own convention", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", userId: "USER-BALA" })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "sub-1", amount: "100000" as Money }),
      ],
    });

    const result = assembleSubPartnerDashboard("user-bala", raw);

    expect(result.myProjects).toHaveLength(1);
    expect(result.totalMoneyAdded).toBe("100000");
  });
});

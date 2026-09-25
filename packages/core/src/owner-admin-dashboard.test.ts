import { describe, it, expect } from "vitest";
import type {
  AvailableBalance,
  InvestmentTransaction,
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { assembleOwnerAdminDashboard, type OwnerAdminDashboardRawData } from "./owner-admin-dashboard";

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

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "share-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Asha",
    sharePercent: "100" as Percent,
    userId: null,
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

function makeRaw(overrides: Partial<OwnerAdminDashboardRawData> = {}): OwnerAdminDashboardRawData {
  return {
    investmentTransactions: [],
    withdrawalTransactions: [],
    availableBalances: [],
    currentPartnerShares: [],
    currentSubPartnerShares: [],
    projectNamesById: { "project-a": "Project A" },
    ...overrides,
  };
}

describe("assembleOwnerAdminDashboard", () => {
  it("zero-activity case: no Projects/transactions -- all 4 system-wide numbers are '0', partnerOverview is []", () => {
    const result = assembleOwnerAdminDashboard(makeRaw());

    expect(result.totalProjectMoney).toBe("0");
    expect(result.totalAdded).toBe("0");
    expect(result.totalWithdrawn).toBe("0");
    expect(result.totalAvailableBalance).toBe("0");
    expect(result.partnerOverview).toEqual([]);
  });

  it("sums Total Added/Total Withdrawn/Available Balance system-wide, across multiple Projects", () => {
    const raw = makeRaw({
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", projectId: "project-a", amount: "700000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", projectId: "project-b", amount: "300000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", projectId: "project-a", amount: "200000" as Money }),
      ],
      availableBalances: [
        makeAvailableBalance({ id: "bal-1", projectId: "project-a", balance: "50000" as Money }),
        makeAvailableBalance({ id: "bal-2", projectId: "project-b", balance: "25000" as Money }),
      ],
    });

    const result = assembleOwnerAdminDashboard(raw);

    expect(result.totalAdded).toBe("1000000");
    expect(result.totalWithdrawn).toBe("200000");
    expect(result.totalAvailableBalance).toBe("75000");
  });

  it("Total Project Money, healthy data: Added > Withdrawn -- subtractMoney(totalAdded, totalWithdrawn)", () => {
    const raw = makeRaw({
      investmentTransactions: [makeInvestmentTransaction({ amount: "1000000" as Money })],
      withdrawalTransactions: [makeWithdrawalTransaction({ amount: "400000" as Money })],
    });

    const result = assembleOwnerAdminDashboard(raw);

    expect(result.totalProjectMoney).toBe("600000");
  });

  it("Total Project Money, data-integrity edge case: Withdrawn >= Added -- clamped to '0', never throws", () => {
    const raw = makeRaw({
      investmentTransactions: [makeInvestmentTransaction({ amount: "300000" as Money })],
      withdrawalTransactions: [makeWithdrawalTransaction({ amount: "800000" as Money })],
    });

    expect(() => assembleOwnerAdminDashboard(raw)).not.toThrow();
    const result = assembleOwnerAdminDashboard(raw);
    expect(result.totalProjectMoney).toBe("0");
  });

  it("Total Project Money, exact-equal edge case: Withdrawn === Added -- clamped to '0' via the >= branch, never throws", () => {
    const raw = makeRaw({
      investmentTransactions: [makeInvestmentTransaction({ amount: "500000" as Money })],
      withdrawalTransactions: [makeWithdrawalTransaction({ amount: "500000" as Money })],
    });

    const result = assembleOwnerAdminDashboard(raw);
    expect(result.totalProjectMoney).toBe("0");
  });

  it("excludes cancelled investment/withdrawal transactions from every system-wide sum", () => {
    const raw = makeRaw({
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", amount: "500000" as Money, status: "active" }),
        makeInvestmentTransaction({ id: "inv-2", amount: "999999" as Money, status: "cancelled" }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", amount: "100000" as Money, status: "active" }),
        makeWithdrawalTransaction({ id: "wd-2", amount: "888888" as Money, status: "cancelled" }),
      ],
    });

    const result = assembleOwnerAdminDashboard(raw);

    expect(result.totalAdded).toBe("500000");
    expect(result.totalWithdrawn).toBe("100000");
    expect(result.totalProjectMoney).toBe("400000");
  });

  it("partner-wise overview: one row per current Partner Share, with its own Invested/Withdrawn/Available Balance totals", () => {
    const raw = makeRaw({
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", name: "Asha", projectId: "project-a" }),
        makePartnerShare({
          id: "share-2",
          partnerId: "partner-2",
          name: "Chetan",
          projectId: "project-b",
        }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", partyType: "partner", shareId: "partner-1", amount: "300000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", partyType: "partner", shareId: "partner-2", amount: "150000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", partyType: "partner", shareId: "partner-1", amount: "50000" as Money }),
      ],
      availableBalances: [
        makeAvailableBalance({ id: "bal-1", partyType: "partner", shareId: "partner-1", balance: "20000" as Money }),
      ],
      projectNamesById: { "project-a": "Project A", "project-b": "Project B" },
    });

    const result = assembleOwnerAdminDashboard(raw);

    expect(result.partnerOverview).toHaveLength(2);
    const asha = result.partnerOverview.find((row) => row.partnerId === "partner-1");
    const chetan = result.partnerOverview.find((row) => row.partnerId === "partner-2");

    expect(asha).toMatchObject({
      name: "Asha",
      projectId: "project-a",
      projectName: "Project A",
      invested: "300000",
      withdrawn: "50000",
      availableBalance: "20000",
      netPosition: "250000",
    });
    expect(chetan).toMatchObject({
      name: "Chetan",
      projectId: "project-b",
      projectName: "Project B",
      invested: "150000",
      withdrawn: "0",
      availableBalance: "0",
      netPosition: "150000",
    });
  });

  it("netPosition: invested - withdrawn per partner, clamped to '0' when withdrawn exceeds invested (mirrors totalProjectMoney's own clamp one row down)", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", name: "Asha" })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", partyType: "partner", shareId: "partner-1", amount: "100000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", partyType: "partner", shareId: "partner-1", amount: "700000" as Money }),
      ],
    });

    expect(() => assembleOwnerAdminDashboard(raw)).not.toThrow();
    const result = assembleOwnerAdminDashboard(raw);
    expect(result.partnerOverview[0]?.netPosition).toBe("0");
  });

  it("rolls a Sub-partner's own activity into their PARENT Partner's totals -- the Sub-partner gets no own row", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", name: "Asha", projectId: "project-a" })],
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1", projectId: "project-a", name: "Bala" }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", partyType: "partner", shareId: "partner-1", amount: "300000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", partyType: "sub_partner", shareId: "sub-1", amount: "100000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", partyType: "sub_partner", shareId: "sub-1", amount: "40000" as Money }),
      ],
      availableBalances: [
        makeAvailableBalance({ id: "bal-1", partyType: "sub_partner", shareId: "sub-1", balance: "15000" as Money }),
      ],
    });

    const result = assembleOwnerAdminDashboard(raw);

    // Exactly one row -- the Sub-partner never gets its own.
    expect(result.partnerOverview).toHaveLength(1);
    const row = result.partnerOverview[0];
    expect(row?.partnerId).toBe("partner-1");
    // 300000 (own) + 100000 (rolled-up sub-partner) = 400000
    expect(row?.invested).toBe("400000");
    // 0 (own) + 40000 (rolled-up sub-partner) = 40000
    expect(row?.withdrawn).toBe("40000");
    // 0 (own) + 15000 (rolled-up sub-partner) = 15000
    expect(row?.availableBalance).toBe("15000");
    // netPosition = 400000 - 40000 = 360000, computed from the already-rolled-up totals.
    expect(row?.netPosition).toBe("360000");

    // Still counted in the system-wide totals too, regardless of party type.
    expect(result.totalAdded).toBe("400000");
    expect(result.totalWithdrawn).toBe("40000");
    expect(result.totalAvailableBalance).toBe("15000");
  });

  it("a current Partner Share with zero recorded activity still gets its own row, all '0's -- not omitted", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", name: "Asha" })],
    });

    const result = assembleOwnerAdminDashboard(raw);

    expect(result.partnerOverview).toEqual([
      {
        partnerId: "partner-1",
        name: "Asha",
        projectId: "project-a",
        projectName: "Project A",
        invested: "0",
        withdrawn: "0",
        availableBalance: "0",
        netPosition: "0",
      },
    ]);
  });

  it("falls back to 'Unknown Project' when projectNamesById has no entry for a Partner Share's projectId", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", projectId: "ghost-project" })],
      projectNamesById: {},
    });

    const result = assembleOwnerAdminDashboard(raw);

    expect(result.partnerOverview[0]?.projectName).toBe("Unknown Project");
  });

  it("skips a Sub-partner's rows whose parent Partner can't be resolved (data-integrity edge case) rather than throwing", () => {
    const raw = makeRaw({
      currentPartnerShares: [],
      currentSubPartnerShares: [],
      investmentTransactions: [
        makeInvestmentTransaction({ partyType: "sub_partner", shareId: "orphan-sub", amount: "50000" as Money }),
      ],
    });

    expect(() => assembleOwnerAdminDashboard(raw)).not.toThrow();
    const result = assembleOwnerAdminDashboard(raw);
    // Still counted system-wide (it's an active investment transaction regardless of grouping)...
    expect(result.totalAdded).toBe("50000");
    // ...but contributes to no partner-wise overview row, since there are none.
    expect(result.partnerOverview).toEqual([]);
  });

  /**
   * Review finding (2026-09-25): distinct from the "orphan-sub" test above --
   * that one has NO `SubPartnerShare` at all (so `resolveOverviewPartnerId`
   * itself returns `null`, the Sub-partner's `shareId` never even resolves to
   * a `partnerId`). Here the `SubPartnerShare` DOES exist and DOES resolve to
   * a `partnerId` (its `parentPartnerIdBySubPartnerId` lookup succeeds), but
   * that `partnerId` has no matching row in `currentPartnerShares` (e.g. the
   * parent Partner Share was superseded/removed after the Sub-partner's own
   * row was last written) -- a genuinely different code path. Documented,
   * intended behavior (mirrors `money-history.ts`'s own "skip, stay in the
   * total" precedent for an unresolvable parent link): the money is still
   * bucketed under that orphaned `partnerId` in the accumulator maps and so
   * still counts toward every system-wide sum, but `partnerOverview` only
   * ever iterates `currentPartnerShares` -- so it silently produces no row
   * for it.
   */
  it("a resolvable Sub-partner whose parent partnerId has no current Partner Share: counted system-wide, but produces no partnerOverview row", () => {
    const raw = makeRaw({
      currentPartnerShares: [], // the parent Partner Share is gone/superseded
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "vanished-partner", projectId: "project-a" }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", partyType: "sub_partner", shareId: "sub-1", amount: "70000" as Money }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", partyType: "sub_partner", shareId: "sub-1", amount: "10000" as Money }),
      ],
      availableBalances: [
        makeAvailableBalance({ id: "bal-1", partyType: "sub_partner", shareId: "sub-1", balance: "5000" as Money }),
      ],
    });

    const result = assembleOwnerAdminDashboard(raw);

    // Counted system-wide -- the rollup resolved to a real (if orphaned) partnerId, no different from any other active row.
    expect(result.totalAdded).toBe("70000");
    expect(result.totalWithdrawn).toBe("10000");
    expect(result.totalAvailableBalance).toBe("5000");
    // But no partnerOverview row exists for it -- currentPartnerShares is empty, so there's nothing to attach it to.
    expect(result.partnerOverview).toEqual([]);
  });

  /**
   * Review finding (2026-09-25): the spec's own Verification section claims
   * this exact scenario is covered, but no prior test in this file combined
   * a cancelled transaction with a per-partner assertion (only incidental,
   * unlabeled coverage existed in `apps/web`'s page-test fixture, built for a
   * different purpose). Proves the SAME filtered `activeInvestments`/
   * `activeWithdrawals` arrays feeding the system-wide sums are also what
   * feeds the per-partner grouping -- no separate, potentially-diverging
   * filter path for the per-partner case.
   */
  it("excludes a cancelled transaction from a specific partner's own row (not just the system-wide totals)", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", name: "Asha" })],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", partyType: "partner", shareId: "partner-1", amount: "200000" as Money, status: "active" }),
        makeInvestmentTransaction({ id: "inv-2", partyType: "partner", shareId: "partner-1", amount: "999999" as Money, status: "cancelled" }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", partyType: "partner", shareId: "partner-1", amount: "50000" as Money, status: "active" }),
        makeWithdrawalTransaction({ id: "wd-2", partyType: "partner", shareId: "partner-1", amount: "888888" as Money, status: "cancelled" }),
      ],
    });

    const result = assembleOwnerAdminDashboard(raw);

    expect(result.partnerOverview).toHaveLength(1);
    expect(result.partnerOverview[0]?.invested).toBe("200000");
    expect(result.partnerOverview[0]?.withdrawn).toBe("50000");
  });
});

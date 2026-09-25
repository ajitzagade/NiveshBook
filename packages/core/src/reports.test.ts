import { describe, it, expect } from "vitest";
import type {
  AvailableBalance,
  InvestmentTransaction,
  Money,
  MoneyHistoryEntry,
  PartnerShare,
  Percent,
  Project,
  SubPartnerShare,
  WithdrawalTransaction,
} from "@niveshbook/types";
import {
  assembleAvailableBalanceReport,
  assemblePartnerReport,
  assemblePaymentModeReport,
  assembleProjectMoneyReport,
  assembleSubPartnerReport,
  type AvailableBalanceReportRawData,
  type PartnerReportRawData,
  type ProjectMoneyReportRawData,
  type SubPartnerReportRawData,
} from "./reports";

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
    sharePercent: "60" as Percent,
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
    sharePercent: "20" as Percent,
    userId: null,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-a",
    name: "Project A",
    description: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<MoneyHistoryEntry> = {}): MoneyHistoryEntry {
  return {
    id: "entry-1",
    type: "money_added",
    date: "2026-09-01",
    projectId: "project-a",
    projectName: "Project A",
    partyType: "partner",
    shareId: "partner-1",
    personName: "Asha",
    amount: "100000" as Money,
    paymentMode: "neft",
    from: null,
    to: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    ...overrides,
  };
}

const ACTOR = "user-asha";
const OTHER_PARTNER_ACTOR = "user-carol";
const SUB_ACTOR = "user-bala";

describe("assemblePaymentModeReport", () => {
  it("groups already-assembled entries by paymentMode, summing amount per mode", () => {
    const entries: MoneyHistoryEntry[] = [
      makeEntry({ id: "e1", paymentMode: "neft", amount: "100000" as Money }),
      makeEntry({ id: "e2", paymentMode: "neft", amount: "50000" as Money }),
      makeEntry({ id: "e3", paymentMode: "cash", amount: "20000" as Money, type: "money_withdrawn" }),
    ];

    const result = assemblePaymentModeReport(entries);

    expect(result).toEqual([
      { paymentMode: "neft", totalAmount: "150000", entryCount: 2 },
      { paymentMode: "cash", totalAmount: "20000", entryCount: 1 },
    ]);
  });

  it("skips entries with paymentMode: null (e.g. moved_to_project/adjustment) rather than erroring", () => {
    const entries: MoneyHistoryEntry[] = [
      makeEntry({ id: "e1", paymentMode: null, type: "moved_to_project" }),
      makeEntry({ id: "e2", paymentMode: null, type: "adjustment" }),
      makeEntry({ id: "e3", paymentMode: "upi", amount: "5000" as Money }),
    ];

    const result = assemblePaymentModeReport(entries);

    expect(result).toEqual([{ paymentMode: "upi", totalAmount: "5000", entryCount: 1 }]);
  });

  it("returns [] for an empty entry list", () => {
    expect(assemblePaymentModeReport([])).toEqual([]);
  });
});

describe("assembleProjectMoneyReport", () => {
  function makeRaw(overrides: Partial<ProjectMoneyReportRawData> = {}): ProjectMoneyReportRawData {
    return {
      investmentTransactions: [],
      withdrawalTransactions: [],
      availableBalances: [],
      currentPartnerShares: [],
      currentSubPartnerShares: [],
      projects: [makeProject()],
      ...overrides,
    };
  }

  it("owner_admin: one row per every Project, system-wide sums across every party", () => {
    const raw = makeRaw({
      projects: [makeProject({ id: "project-a", name: "Project A" }), makeProject({ id: "project-b", name: "Project B" })],
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", projectId: "project-a", userId: ACTOR }),
        makePartnerShare({ partnerId: "partner-2", projectId: "project-b", userId: OTHER_PARTNER_ACTOR }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", projectId: "project-a", shareId: "partner-1", amount: "100000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", projectId: "project-b", shareId: "partner-2", amount: "200000" as Money }),
      ],
    });

    const result = assembleProjectMoneyReport("owner_admin", "owner-1", raw);

    expect(result).toEqual([
      { projectId: "project-a", projectName: "Project A", totalAdded: "100000", totalWithdrawn: "0", totalAvailableBalance: "0" },
      { projectId: "project-b", projectName: "Project B", totalAdded: "200000", totalWithdrawn: "0", totalAvailableBalance: "0" },
    ]);
  });

  it("3 current Shares across 3 Projects (AC): partner gets exactly 3 rows, their own money per Project", () => {
    const raw = makeRaw({
      projects: [
        makeProject({ id: "project-a", name: "Project A" }),
        makeProject({ id: "project-b", name: "Project B" }),
        makeProject({ id: "project-c", name: "Project C" }),
      ],
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", projectId: "project-a", userId: ACTOR }),
        makePartnerShare({ partnerId: "partner-2", projectId: "project-b", userId: ACTOR }),
        makePartnerShare({ partnerId: "partner-3", projectId: "project-c", userId: ACTOR }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-a", projectId: "project-a", shareId: "partner-1", amount: "10000" as Money }),
        makeInvestmentTransaction({ id: "inv-b", projectId: "project-b", shareId: "partner-2", amount: "20000" as Money }),
        makeInvestmentTransaction({ id: "inv-c", projectId: "project-c", shareId: "partner-3", amount: "30000" as Money }),
      ],
    });

    const result = assembleProjectMoneyReport("partner", ACTOR, raw);

    expect(result).toHaveLength(3);
    expect(result.map((row) => row.totalAdded).sort()).toEqual(["10000", "20000", "30000"]);
  });

  it("never leaks another Partner's money on a shared Project (highest-stakes property)", () => {
    const raw = makeRaw({
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", projectId: "project-a", userId: ACTOR }),
        makePartnerShare({ partnerId: "partner-2", projectId: "project-a", userId: OTHER_PARTNER_ACTOR }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-mine", projectId: "project-a", shareId: "partner-1", amount: "111" as Money }),
        makeInvestmentTransaction({ id: "inv-theirs", projectId: "project-a", shareId: "partner-2", amount: "999999" as Money }),
      ],
    });

    const result = assembleProjectMoneyReport("partner", ACTOR, raw);

    expect(result).toEqual([
      { projectId: "project-a", projectName: "Project A", totalAdded: "111", totalWithdrawn: "0", totalAvailableBalance: "0" },
    ]);
  });

  it("a sub_partner with no current Share anywhere gets []", () => {
    const raw = makeRaw();

    expect(assembleProjectMoneyReport("sub_partner", SUB_ACTOR, raw)).toEqual([]);
  });

  // Review finding (Medium-High): the prior test above only proves the
  // trivial all-empty case, which passes regardless of whether the actual
  // sub_partner filtering logic works at all. This is the real,
  // populated-data proof the spec's own I/O matrix calls for ("3 rows for
  // partner/sub_partner") -- a genuinely distinct partyType/shareId
  // combination, mirroring `assembleSubPartnerReport`'s own thorough 3-role
  // coverage and the identical 111-vs-999999 mismatched-amount pattern the
  // "never leaks another Partner's money" test above uses.
  it("sub_partner: their own Project Money rows, never another party's money on the same Project", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1", projectId: "project-a", userId: SUB_ACTOR }),
      ],
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", projectId: "project-a", userId: OTHER_PARTNER_ACTOR }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({
          id: "inv-mine",
          projectId: "project-a",
          partyType: "sub_partner",
          shareId: "sub-1",
          amount: "222" as Money,
        }),
        makeInvestmentTransaction({
          id: "inv-not-mine",
          projectId: "project-a",
          partyType: "partner",
          shareId: "partner-1",
          amount: "999999" as Money,
        }),
      ],
    });

    const result = assembleProjectMoneyReport("sub_partner", SUB_ACTOR, raw);

    expect(result).toEqual([
      { projectId: "project-a", projectName: "Project A", totalAdded: "222", totalWithdrawn: "0", totalAvailableBalance: "0" },
    ]);
  });
});

describe("assemblePartnerReport", () => {
  function makeRaw(overrides: Partial<PartnerReportRawData> = {}): PartnerReportRawData {
    return {
      investmentTransactions: [],
      withdrawalTransactions: [],
      availableBalances: [],
      currentPartnerShares: [],
      projectNamesById: { "project-a": "Project A" },
      ...overrides,
    };
  }

  it("owner_admin: every current Partner Share system-wide", () => {
    const raw = makeRaw({
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", userId: ACTOR }),
        makePartnerShare({ partnerId: "partner-2", userId: OTHER_PARTNER_ACTOR }),
      ],
    });

    expect(assemblePartnerReport("owner_admin", "owner-1", raw)).toHaveLength(2);
  });

  it("partner: only their own current Partner Share(s), never another Partner's", () => {
    const raw = makeRaw({
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", userId: ACTOR, name: "Asha" }),
        makePartnerShare({ partnerId: "partner-2", userId: OTHER_PARTNER_ACTOR, name: "Carol" }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-1", shareId: "partner-1", amount: "5000" as Money }),
        makeInvestmentTransaction({ id: "inv-2", shareId: "partner-2", amount: "999999" as Money }),
      ],
    });

    const result = assemblePartnerReport("partner", ACTOR, raw);

    expect(result).toEqual([
      {
        partnerId: "partner-1",
        name: "Asha",
        projectId: "project-a",
        projectName: "Project A",
        sharePercent: "60",
        totalAdded: "5000",
        totalWithdrawn: "0",
        totalAvailableBalance: "0",
      },
    ]);
  });

  it("sums totalWithdrawn/totalAvailableBalance alongside totalAdded for a visible share", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR, name: "Asha" })],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "wd-1", shareId: "partner-1", amount: "2000" as Money }),
      ],
      availableBalances: [makeAvailableBalance({ id: "bal-1", shareId: "partner-1", balance: "300" as Money })],
    });

    const result = assemblePartnerReport("partner", ACTOR, raw);

    expect(result[0]?.totalWithdrawn).toBe("2000");
    expect(result[0]?.totalAvailableBalance).toBe("300");
  });

  it("a sub_partner generating the Partner report gets [] -- falls out of the shareId filter naturally, not a special case (Decision #5 regression)", () => {
    const raw = makeRaw({
      currentPartnerShares: [
        makePartnerShare({ partnerId: "partner-1", userId: ACTOR }),
        makePartnerShare({ partnerId: "partner-2", userId: OTHER_PARTNER_ACTOR }),
      ],
    });

    const result = assemblePartnerReport("sub_partner", SUB_ACTOR, raw);

    expect(result).toEqual([]);
  });
});

describe("assembleSubPartnerReport", () => {
  function makeRaw(overrides: Partial<SubPartnerReportRawData> = {}): SubPartnerReportRawData {
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

  it("owner_admin: every current Sub-partner Share system-wide", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1" }),
        makeSubPartnerShare({ subPartnerId: "sub-2", partnerId: "partner-2" }),
      ],
    });

    expect(assembleSubPartnerReport("owner_admin", "owner-1", raw)).toHaveLength(2);
  });

  it("partner with 2 current linked Sub-partners: rows for both, with their own money -- never a sibling Partner's Sub-partners", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR })],
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1", name: "Bala" }),
        makeSubPartnerShare({ subPartnerId: "sub-2", partnerId: "partner-1", name: "Chetan" }),
        // a sibling Partner's own Sub-partner -- must never appear
        makeSubPartnerShare({ subPartnerId: "sub-99", partnerId: "partner-other", name: "Rival Sub" }),
      ],
      investmentTransactions: [
        makeInvestmentTransaction({
          id: "inv-1",
          partyType: "sub_partner",
          shareId: "sub-1",
          amount: "7000" as Money,
        }),
        // Review finding (Low): the excluded sibling's Sub-partner now
        // carries a real, large, distinctly-mismatched amount (mirrors the
        // 111-vs-999999 pattern every other aggregate report's own
        // isolation test already uses) -- proves the exclusion is genuinely
        // by ownership, not merely "this row happened to have no money
        // attached" (which would pass even with a broken filter, as long as
        // the excluded share's own row was empty).
        makeInvestmentTransaction({
          id: "inv-rival",
          partyType: "sub_partner",
          shareId: "sub-99",
          amount: "999999" as Money,
        }),
      ],
    });

    const result = assembleSubPartnerReport("partner", ACTOR, raw);

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.subPartnerId).sort()).toEqual(["sub-1", "sub-2"]);
    expect(result.find((row) => row.subPartnerId === "sub-1")?.totalAdded).toBe("7000");
    expect(result.some((row) => row.subPartnerId === "sub-99")).toBe(false);
  });

  it("sub_partner: exactly their own one row -- never a parent Partner's or sibling Sub-partner's row", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "partner-1", userId: SUB_ACTOR, name: "Bala" }),
        makeSubPartnerShare({ subPartnerId: "sub-2", partnerId: "partner-1", userId: "user-other-sub", name: "Sibling" }),
      ],
    });

    const result = assembleSubPartnerReport("sub_partner", SUB_ACTOR, raw);

    expect(result).toEqual([
      {
        subPartnerId: "sub-1",
        name: "Bala",
        partnerId: "partner-1",
        projectId: "project-a",
        projectName: "Project A",
        sharePercent: "20",
        totalAdded: "0",
        totalWithdrawn: "0",
        totalAvailableBalance: "0",
      },
    ]);
  });
});

describe("assembleAvailableBalanceReport", () => {
  function makeRaw(overrides: Partial<AvailableBalanceReportRawData> = {}): AvailableBalanceReportRawData {
    return {
      availableBalances: [],
      currentPartnerShares: [],
      currentSubPartnerShares: [],
      projectNamesById: { "project-a": "Project A" },
      partnerNamesById: {},
      subPartnerNamesById: {},
      ...overrides,
    };
  }

  it("owner_admin sees every current AvailableBalance row system-wide", () => {
    const raw = makeRaw({
      availableBalances: [
        makeAvailableBalance({ id: "bal-1", partyType: "partner", shareId: "partner-1", balance: "500" as Money }),
        makeAvailableBalance({ id: "bal-2", partyType: "sub_partner", shareId: "sub-1", balance: "700" as Money }),
      ],
    });

    expect(assembleAvailableBalanceReport("owner_admin", "owner-1", raw)).toHaveLength(2);
  });

  it("a partner never sees another party's balance even on a shared Project (highest-stakes property)", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", userId: ACTOR })],
      availableBalances: [
        makeAvailableBalance({ id: "bal-mine", partyType: "partner", shareId: "partner-1", balance: "500" as Money }),
        makeAvailableBalance({ id: "bal-theirs", partyType: "partner", shareId: "partner-2", balance: "999999" as Money }),
      ],
    });

    const result = assembleAvailableBalanceReport("partner", ACTOR, raw);

    expect(result).toHaveLength(1);
    expect(result[0]?.shareId).toBe("partner-1");
    expect(result[0]?.balance).toBe("500");
  });

  // Review finding (Medium): the test immediately above only ever calls
  // this function with `"partner"` -- this is the genuinely distinct
  // `sub_partner`-role case the prior test's own name incorrectly implied
  // was already covered. Mirrors the partner case's exact shape one role
  // over.
  it("a sub_partner never sees another party's balance even on a shared Project", () => {
    const raw = makeRaw({
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", userId: SUB_ACTOR })],
      availableBalances: [
        makeAvailableBalance({ id: "bal-mine", partyType: "sub_partner", shareId: "sub-1", balance: "500" as Money }),
        makeAvailableBalance({ id: "bal-theirs", partyType: "sub_partner", shareId: "sub-2", balance: "999999" as Money }),
      ],
    });

    const result = assembleAvailableBalanceReport("sub_partner", SUB_ACTOR, raw);

    expect(result).toHaveLength(1);
    expect(result[0]?.shareId).toBe("sub-1");
    expect(result[0]?.balance).toBe("500");
  });

  it("checks both share tables (a userId could hold a Partner Share on one Project and a Sub-partner Share on another)", () => {
    const raw = makeRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "partner-1", projectId: "project-a", userId: ACTOR })],
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", projectId: "project-b", userId: ACTOR }),
      ],
      projectNamesById: { "project-a": "Project A", "project-b": "Project B" },
      availableBalances: [
        makeAvailableBalance({ id: "bal-1", partyType: "partner", shareId: "partner-1", projectId: "project-a", balance: "10" as Money }),
        makeAvailableBalance({ id: "bal-2", partyType: "sub_partner", shareId: "sub-1", projectId: "project-b", balance: "20" as Money }),
      ],
    });

    const result = assembleAvailableBalanceReport("partner", ACTOR, raw);

    expect(result).toHaveLength(2);
  });
});

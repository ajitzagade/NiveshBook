import { describe, it, expect } from "vitest";
import type {
  AdjustmentNetting,
  AvailableBalanceSpend,
  InvestmentTransaction,
  Money,
  MoneyMovement,
  Percent,
  PartnerShare,
  SubPartnerShare,
  WithdrawalDestinationAllocation,
  WithdrawalTransaction,
} from "@niveshbook/types";
import {
  assembleMoneyHistory,
  resolveMoneyHistoryScope,
  moneyHistoryPersonNameKey,
  type MoneyHistoryRawData,
  type MoneyHistoryScope,
} from "./money-history";

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

function makeLeg(overrides: Partial<WithdrawalDestinationAllocation> = {}): WithdrawalDestinationAllocation {
  return {
    id: "leg-1",
    withdrawalTransactionId: "wd-1",
    destinationType: "project",
    amount: "100000" as Money,
    destinationProjectId: null,
    personName: null,
    notes: null,
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMovement(overrides: Partial<MoneyMovement> = {}): MoneyMovement {
  return {
    id: "mv-1",
    withdrawalDestinationAllocationId: null,
    availableBalanceSpendId: null,
    sourceProjectId: "project-a",
    destinationProjectId: "project-b",
    destinationInvestmentTransactionId: "inv-1",
    amount: "100000" as Money,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSpend(overrides: Partial<AvailableBalanceSpend> = {}): AvailableBalanceSpend {
  return {
    id: "spend-1",
    sourceProjectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    destinationType: "project",
    destinationProjectId: null,
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    personName: null,
    amount: "30000" as Money,
    notes: null,
    createdAt: "2026-09-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeAdjustmentNetting(overrides: Partial<AdjustmentNetting> = {}): AdjustmentNetting {
  return {
    id: "netting-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    investmentRequirementId: "req-1",
    amount: "50000" as Money,
    notes: null,
    actorUserId: "owner-1",
    createdAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Partner A",
    sharePercent: "100" as Percent,
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeSubPartnerShare(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Sub A",
    sharePercent: "20" as Percent,
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function emptyRaw(overrides: Partial<MoneyHistoryRawData> = {}): MoneyHistoryRawData {
  return {
    investmentTransactions: [],
    withdrawalTransactions: [],
    withdrawalDestinationAllocations: [],
    moneyMovements: [],
    availableBalanceSpends: [],
    adjustmentNettings: [],
    projectNamesById: { "project-a": "Project A", "project-b": "Project B", "project-c": "Project C" },
    // Keyed by `(shareId, projectId)`, via `moneyHistoryPersonNameKey` --
    // review round 2's fix for the name-collapse bug (partner-1/partner-2
    // each covered on both project-a and project-b, so any test combining
    // them doesn't accidentally rely on a shareId-only lookup).
    partnerNamesById: {
      [moneyHistoryPersonNameKey("partner-1", "project-a")]: "Partner A",
      [moneyHistoryPersonNameKey("partner-1", "project-b")]: "Partner A",
      [moneyHistoryPersonNameKey("partner-2", "project-a")]: "Partner B",
      [moneyHistoryPersonNameKey("partner-2", "project-b")]: "Partner B",
    },
    subPartnerNamesById: {
      [moneyHistoryPersonNameKey("sub-1", "project-a")]: "Sub A",
    },
    ...overrides,
  };
}

const UNRESTRICTED: MoneyHistoryScope = { unrestricted: true };

describe("resolveMoneyHistoryScope", () => {
  it("owner_admin resolves unrestricted, regardless of the share lists passed", () => {
    const scope = resolveMoneyHistoryScope("owner_admin", "owner-1", [], []);
    expect(scope).toEqual({ unrestricted: true });
  });

  it("partner resolves the exact set of (partyType, shareId, projectId) triples for their own current Partner Shares, matched case-insensitively", () => {
    const own = makePartnerShare({ partnerId: "partner-1", projectId: "project-a", userId: "USER-1" });
    const otherProject = makePartnerShare({ partnerId: "partner-2", projectId: "project-b", userId: "user-1" });
    const someoneElse = makePartnerShare({ partnerId: "partner-3", projectId: "project-a", userId: "user-2" });

    const scope = resolveMoneyHistoryScope("partner", "user-1", [own, otherProject, someoneElse], []);

    expect(scope.unrestricted).toBe(false);
    if (scope.unrestricted) throw new Error("unreachable");
    expect(scope.shareKeys.has("partner:partner-1:project-a")).toBe(true);
    expect(scope.shareKeys.has("partner:partner-2:project-b")).toBe(true);
    expect(scope.shareKeys.has("partner:partner-3:project-a")).toBe(false);
    expect(scope.shareKeys.size).toBe(2);
  });

  it("sub_partner resolves from allSubPartnerShares, and also picks up any Partner Share independently linked to the same userId", () => {
    const subShare = makeSubPartnerShare({ subPartnerId: "sub-1", projectId: "project-a", userId: "user-9" });
    const alsoAPartner = makePartnerShare({ partnerId: "partner-5", projectId: "project-c", userId: "user-9" });

    const scope = resolveMoneyHistoryScope("sub_partner", "user-9", [alsoAPartner], [subShare]);

    expect(scope.unrestricted).toBe(false);
    if (scope.unrestricted) throw new Error("unreachable");
    expect(scope.shareKeys.has("sub_partner:sub-1:project-a")).toBe(true);
    expect(scope.shareKeys.has("partner:partner-5:project-c")).toBe(true);
  });

  it("returns an empty shareKeys set when nothing matches the actor's userId", () => {
    const other = makePartnerShare({ userId: "someone-else" });
    const scope = resolveMoneyHistoryScope("partner", "user-1", [other], []);

    expect(scope).toEqual({ unrestricted: false, shareKeys: new Set() });
  });
});

describe("assembleMoneyHistory — I/O matrix row: manual Add Money entry (no linked movement)", () => {
  it("produces money_added, from: null", () => {
    const raw = emptyRaw({ investmentTransactions: [makeInvestmentTransaction({ id: "inv-1" })] });

    const [entry] = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entry).toMatchObject({ id: "inv-1", type: "money_added", from: null, to: null });
  });
});

describe("assembleMoneyHistory — I/O matrix row: cross-project movement, destination side", () => {
  it("produces money_added, from: <source Project name>", () => {
    const destination = makeInvestmentTransaction({ id: "inv-dest", projectId: "project-b" });
    const movement = makeMovement({
      sourceProjectId: "project-a",
      destinationProjectId: "project-b",
      destinationInvestmentTransactionId: "inv-dest",
    });
    const raw = emptyRaw({ investmentTransactions: [destination], moneyMovements: [movement] });

    const [entry] = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entry).toMatchObject({ id: "inv-dest", type: "money_added", from: "Project A" });
  });
});

describe("assembleMoneyHistory — I/O matrix row: Withdrawal", () => {
  it("produces money_withdrawn", () => {
    const raw = emptyRaw({ withdrawalTransactions: [makeWithdrawalTransaction({ id: "wd-1" })] });

    const [entry] = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entry).toMatchObject({ id: "wd-1", type: "money_withdrawn", from: null, to: null });
  });
});

describe("assembleMoneyHistory — I/O matrix row: 'project' leg", () => {
  it("produces moved_to_project, to: <destination Project name>, inheriting date/partyType/shareId/paymentMode from the parent withdrawal", () => {
    const withdrawal = makeWithdrawalTransaction({ id: "wd-1", transactionDate: "2026-09-10", paymentMode: "upi" });
    const leg = makeLeg({ id: "leg-project", withdrawalTransactionId: "wd-1", destinationType: "project", destinationProjectId: "project-b" });
    const raw = emptyRaw({ withdrawalTransactions: [withdrawal], withdrawalDestinationAllocations: [leg] });

    // Two entries are produced -- the leg's own AND the parent withdrawal's
    // own "money_withdrawn" entry (this story's I/O matrix: a withdrawal
    // always produces its own entry too) -- select by id, not array position.
    const entry = assembleMoneyHistory(raw, UNRESTRICTED, {}).find((e) => e.id === "leg-project");

    expect(entry).toMatchObject({
      id: "leg-project",
      type: "moved_to_project",
      to: "Project B",
      date: "2026-09-10",
      paymentMode: "upi",
      partyType: "partner",
      shareId: "partner-1",
    });
  });
});

describe("assembleMoneyHistory — I/O matrix row: 'person' leg", () => {
  it("produces given_to_person, to: <personName>", () => {
    const withdrawal = makeWithdrawalTransaction({ id: "wd-1" });
    const leg = makeLeg({ id: "leg-person", withdrawalTransactionId: "wd-1", destinationType: "person", personName: "Ramesh" });
    const raw = emptyRaw({ withdrawalTransactions: [withdrawal], withdrawalDestinationAllocations: [leg] });

    const entry = assembleMoneyHistory(raw, UNRESTRICTED, {}).find((e) => e.id === "leg-person");

    expect(entry).toMatchObject({ id: "leg-person", type: "given_to_person", to: "Ramesh" });
  });
});

describe("assembleMoneyHistory — I/O matrix row: 'available_balance' leg", () => {
  it("produces added_to_available_balance, to: 'Available Balance'", () => {
    const withdrawal = makeWithdrawalTransaction({ id: "wd-1" });
    const leg = makeLeg({ id: "leg-balance", withdrawalTransactionId: "wd-1", destinationType: "available_balance" });
    const raw = emptyRaw({ withdrawalTransactions: [withdrawal], withdrawalDestinationAllocations: [leg] });

    const entry = assembleMoneyHistory(raw, UNRESTRICTED, {}).find((e) => e.id === "leg-balance");

    expect(entry).toMatchObject({ id: "leg-balance", type: "added_to_available_balance", to: "Available Balance" });
  });
});

describe("assembleMoneyHistory — I/O matrix row: 'other' leg", () => {
  it("produces a given_to_person-shaped entry, to: 'Other', notes carries the description -- no 7th type invented", () => {
    const withdrawal = makeWithdrawalTransaction({ id: "wd-1" });
    const leg = makeLeg({
      id: "leg-other",
      withdrawalTransactionId: "wd-1",
      destinationType: "other",
      notes: "Paid vendor invoice #42",
    });
    const raw = emptyRaw({ withdrawalTransactions: [withdrawal], withdrawalDestinationAllocations: [leg] });

    const entry = assembleMoneyHistory(raw, UNRESTRICTED, {}).find((e) => e.id === "leg-other");

    expect(entry).toMatchObject({
      id: "leg-other",
      type: "given_to_person",
      to: "Other",
      notes: "Paid vendor invoice #42",
    });
  });
});

describe("assembleMoneyHistory — I/O matrix row: Available Balance spend, 'project' destination", () => {
  it("produces used_from_available_balance, from: 'Available Balance', to: <destination Project name>", () => {
    const spend = makeSpend({ id: "spend-project", destinationType: "project", destinationProjectId: "project-c" });
    const raw = emptyRaw({ availableBalanceSpends: [spend] });

    const [entry] = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entry).toMatchObject({
      id: "spend-project",
      type: "used_from_available_balance",
      from: "Available Balance",
      to: "Project C",
    });
  });
});

describe("assembleMoneyHistory — I/O matrix row: Available Balance spend, 'person' destination", () => {
  it("produces used_from_available_balance, to: <personName>", () => {
    const spend = makeSpend({ id: "spend-person", destinationType: "person", personName: "Suresh" });
    const raw = emptyRaw({ availableBalanceSpends: [spend] });

    const [entry] = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entry).toMatchObject({ id: "spend-person", type: "used_from_available_balance", to: "Suresh" });
  });
});

describe("assembleMoneyHistory — I/O matrix row: Adjustment Netting (Story 5.3, FR33/FR34, AD-4)", () => {
  it("produces an 'adjustment' entry -- from/to null, notes carries the netting's own notes, no paymentMode, date derived from createdAt", () => {
    const netting = makeAdjustmentNetting({ id: "netting-1", amount: "75000" as Money, notes: "Agreed over call" });
    const raw = emptyRaw({ adjustmentNettings: [netting] });

    const [entry] = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entry).toMatchObject({
      id: "netting-1",
      type: "adjustment",
      date: "2026-09-20",
      projectId: "project-a",
      projectName: "Project A",
      partyType: "partner",
      shareId: "partner-1",
      personName: "Partner A",
      amount: "75000",
      paymentMode: null,
      from: null,
      to: null,
      notes: "Agreed over call",
      status: "active",
      reversalOfTransactionId: null,
    });
  });

  it("is omitted entirely when raw.adjustmentNettings is undefined (non-breaking-additive-field convention, pre-Story-5.3 callers)", () => {
    const raw = emptyRaw({ investmentTransactions: [makeInvestmentTransaction({ id: "inv-1" })] });
    delete (raw as { adjustmentNettings?: unknown }).adjustmentNettings;

    const entries = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entries.map((e) => e.id)).toEqual(["inv-1"]);
  });

  it("sits alongside every other entry type in one unified, sorted list -- never merged/summed with money_added/money_withdrawn", () => {
    const netting = makeAdjustmentNetting({ id: "netting-1", createdAt: "2026-09-25T00:00:00.000Z" });
    const investment = makeInvestmentTransaction({ id: "inv-1", transactionDate: "2026-09-01" });
    const raw = emptyRaw({ adjustmentNettings: [netting], investmentTransactions: [investment] });

    const entries = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entries.map((e) => ({ id: e.id, type: e.type }))).toEqual([
      { id: "netting-1", type: "adjustment" },
      { id: "inv-1", type: "money_added" },
    ]);
  });
});

describe("assembleMoneyHistory — scope", () => {
  it("owner_admin (unrestricted) sees every entry across every Project", () => {
    const raw = emptyRaw({
      investmentTransactions: [
        makeInvestmentTransaction({ id: "inv-a", projectId: "project-a", shareId: "partner-1" }),
        makeInvestmentTransaction({ id: "inv-b", projectId: "project-b", shareId: "partner-2" }),
      ],
    });

    const entries = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entries.map((e) => e.id).sort()).toEqual(["inv-a", "inv-b"]);
  });

  it("a Partner sees only entries matching their own current (partyType, shareId, projectId) triples -- across ALL their Projects, excluding another partner's entries", () => {
    const raw = emptyRaw({
      investmentTransactions: [
        makeInvestmentTransaction({ id: "own-a", projectId: "project-a", shareId: "partner-1" }),
        makeInvestmentTransaction({ id: "own-b", projectId: "project-b", shareId: "partner-1" }),
        makeInvestmentTransaction({ id: "someone-elses", projectId: "project-a", shareId: "partner-2" }),
      ],
    });
    const scope: MoneyHistoryScope = {
      unrestricted: false,
      shareKeys: new Set(["partner:partner-1:project-a", "partner:partner-1:project-b"]),
    };

    const entries = assembleMoneyHistory(raw, scope, {});

    expect(entries.map((e) => e.id).sort()).toEqual(["own-a", "own-b"]);
  });

  it("a Sub-partner sees only entries matching their own current Sub-partner Share triples", () => {
    const raw = emptyRaw({
      withdrawalTransactions: [
        makeWithdrawalTransaction({ id: "own", projectId: "project-a", partyType: "sub_partner", shareId: "sub-1" }),
        makeWithdrawalTransaction({ id: "not-mine", projectId: "project-a", partyType: "partner", shareId: "partner-1" }),
      ],
    });
    const scope: MoneyHistoryScope = {
      unrestricted: false,
      shareKeys: new Set(["sub_partner:sub-1:project-a"]),
    };

    const entries = assembleMoneyHistory(raw, scope, {});

    expect(entries.map((e) => e.id)).toEqual(["own"]);
  });

  it("a cross-project movement's destination-side entry is scoped to the DESTINATION party's own triple, not the source's", () => {
    const destination = makeInvestmentTransaction({ id: "inv-dest", projectId: "project-b", shareId: "partner-2" });
    const movement = makeMovement({
      sourceProjectId: "project-a",
      destinationProjectId: "project-b",
      destinationInvestmentTransactionId: "inv-dest",
    });
    const raw = emptyRaw({ investmentTransactions: [destination], moneyMovements: [movement] });
    const scope: MoneyHistoryScope = {
      unrestricted: false,
      shareKeys: new Set(["partner:partner-2:project-b"]),
    };

    expect(assembleMoneyHistory(raw, scope, {}).map((e) => e.id)).toEqual(["inv-dest"]);
    expect(
      assembleMoneyHistory(
        raw,
        { unrestricted: false, shareKeys: new Set(["partner:partner-1:project-a"]) },
        {},
      ),
    ).toEqual([]);
  });

  // Review round 2 (verification-gap finding #4): the 4 preceding scope
  // tests only exercise investment_transactions-/withdrawal_transactions-
  // derived entries -- the leg-derived types and the available_balance_spends-
  // derived type were only ever exercised under UNRESTRICTED scope. Each
  // entry-building branch applies `isEntryInScope` identically (structurally
  // ruling out a "one branch forgot to filter" bug class, per blind-hunter's
  // finding), but that structural argument deserves its own direct proof per
  // branch, not just an inference from the shared filter call site.
  it("a 'project' leg-derived entry is scoped to its PARENT withdrawal's own (partyType, shareId, projectId) triple", () => {
    const withdrawal = makeWithdrawalTransaction({
      id: "wd-in-scope",
      projectId: "project-a",
      partyType: "partner",
      shareId: "partner-1",
    });
    const otherWithdrawal = makeWithdrawalTransaction({
      id: "wd-out-of-scope",
      projectId: "project-a",
      partyType: "partner",
      shareId: "partner-2",
    });
    const inScopeLeg = makeLeg({
      id: "leg-in-scope",
      withdrawalTransactionId: "wd-in-scope",
      destinationType: "project",
      destinationProjectId: "project-b",
    });
    const outOfScopeLeg = makeLeg({
      id: "leg-out-of-scope",
      withdrawalTransactionId: "wd-out-of-scope",
      destinationType: "project",
      destinationProjectId: "project-b",
    });
    const raw = emptyRaw({
      withdrawalTransactions: [withdrawal, otherWithdrawal],
      withdrawalDestinationAllocations: [inScopeLeg, outOfScopeLeg],
    });
    const scope: MoneyHistoryScope = {
      unrestricted: false,
      shareKeys: new Set(["partner:partner-1:project-a"]),
    };

    const legEntries = assembleMoneyHistory(raw, scope, {}).filter((e) => e.type === "moved_to_project");

    expect(legEntries.map((e) => e.id)).toEqual(["leg-in-scope"]);
  });

  it("a 'person'/'available_balance'/'other' leg-derived entry is scoped identically -- out-of-scope legs are dropped, in-scope ones survive", () => {
    const inScopeWithdrawal = makeWithdrawalTransaction({
      id: "wd-in",
      projectId: "project-a",
      partyType: "partner",
      shareId: "partner-1",
    });
    const outOfScopeWithdrawal = makeWithdrawalTransaction({
      id: "wd-out",
      projectId: "project-b",
      partyType: "partner",
      shareId: "partner-2",
    });
    const personLegIn = makeLeg({ id: "person-in", withdrawalTransactionId: "wd-in", destinationType: "person", personName: "Ramesh" });
    const personLegOut = makeLeg({ id: "person-out", withdrawalTransactionId: "wd-out", destinationType: "person", personName: "Suresh" });
    const balanceLegIn = makeLeg({ id: "balance-in", withdrawalTransactionId: "wd-in", destinationType: "available_balance" });
    const balanceLegOut = makeLeg({ id: "balance-out", withdrawalTransactionId: "wd-out", destinationType: "available_balance" });
    const otherLegIn = makeLeg({ id: "other-in", withdrawalTransactionId: "wd-in", destinationType: "other", notes: "in" });
    const otherLegOut = makeLeg({ id: "other-out", withdrawalTransactionId: "wd-out", destinationType: "other", notes: "out" });
    const raw = emptyRaw({
      withdrawalTransactions: [inScopeWithdrawal, outOfScopeWithdrawal],
      withdrawalDestinationAllocations: [personLegIn, personLegOut, balanceLegIn, balanceLegOut, otherLegIn, otherLegOut],
    });
    const scope: MoneyHistoryScope = {
      unrestricted: false,
      shareKeys: new Set(["partner:partner-1:project-a"]),
    };

    const entries = assembleMoneyHistory(raw, scope, {});
    const ids = entries.map((e) => e.id).sort();

    // "wd-in" itself also produces its own in-scope "money_withdrawn" entry
    // (every withdrawal always does, per the earlier 'project' leg test's
    // identical note) -- alongside the 3 in-scope legs, none of the 3
    // out-of-scope ones.
    expect(ids).toEqual(["balance-in", "other-in", "person-in", "wd-in"]);
  });

  it("an available_balance_spends-derived entry is scoped to its own (partyType, shareId, sourceProjectId) triple", () => {
    const inScopeSpend = makeSpend({
      id: "spend-in-scope",
      sourceProjectId: "project-a",
      partyType: "partner",
      shareId: "partner-1",
      destinationType: "person",
      personName: "Ramesh",
    });
    const outOfScopeSpend = makeSpend({
      id: "spend-out-of-scope",
      sourceProjectId: "project-b",
      partyType: "partner",
      shareId: "partner-2",
      destinationType: "person",
      personName: "Suresh",
    });
    const raw = emptyRaw({ availableBalanceSpends: [inScopeSpend, outOfScopeSpend] });
    const scope: MoneyHistoryScope = {
      unrestricted: false,
      shareKeys: new Set(["partner:partner-1:project-a"]),
    };

    expect(assembleMoneyHistory(raw, scope, {}).map((e) => e.id)).toEqual(["spend-in-scope"]);
  });
});

describe("assembleMoneyHistory — personName resolution is per-Project, not collapsed (review round 2, item #3)", () => {
  it("the SAME partnerId with a DIFFERENT name on two different Projects resolves each entry's personName to its OWN Project's name, not whichever the map happened to build last", () => {
    const raw = emptyRaw({
      investmentTransactions: [
        makeInvestmentTransaction({ id: "on-alpha", projectId: "project-a", shareId: "partner-1" }),
        makeInvestmentTransaction({ id: "on-beta", projectId: "project-b", shareId: "partner-1" }),
      ],
      // The same stable partnerId ("partner-1") legitimately has a different
      // Share name on each Project -- nothing in this schema enforces
      // consistency across a partner's Shares on different Projects.
      partnerNamesById: {
        [moneyHistoryPersonNameKey("partner-1", "project-a")]: "Alpha-side Name",
        [moneyHistoryPersonNameKey("partner-1", "project-b")]: "Beta-side Name",
      },
    });

    const entries = assembleMoneyHistory(raw, UNRESTRICTED, {});
    const onAlpha = entries.find((e) => e.id === "on-alpha");
    const onBeta = entries.find((e) => e.id === "on-beta");

    expect(onAlpha?.personName).toBe("Alpha-side Name");
    expect(onBeta?.personName).toBe("Beta-side Name");
  });
});

describe("assembleMoneyHistory — cancelled/reversal display (review round 2, item #1/#7)", () => {
  it("an investment_transactions cancel: the original (now 'cancelled') and its reversal both appear as distinct entries, the reversal correctly marked", () => {
    const original = makeInvestmentTransaction({ id: "orig", status: "cancelled", reversalOfTransactionId: null });
    const reversal = makeInvestmentTransaction({ id: "rev", status: "cancelled", reversalOfTransactionId: "orig" });
    const raw = emptyRaw({ investmentTransactions: [original, reversal] });

    const entries = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entries).toHaveLength(2);
    const origEntry = entries.find((e) => e.id === "orig");
    const revEntry = entries.find((e) => e.id === "rev");
    expect(origEntry).toMatchObject({ status: "cancelled", reversalOfTransactionId: null });
    expect(revEntry).toMatchObject({ status: "cancelled", reversalOfTransactionId: "orig" });
  });

  it("a withdrawal_transactions cancel mirrors the same shape one ledger over", () => {
    const original = makeWithdrawalTransaction({ id: "orig-wd", status: "cancelled", reversalOfTransactionId: null });
    const reversal = makeWithdrawalTransaction({ id: "rev-wd", status: "cancelled", reversalOfTransactionId: "orig-wd" });
    const raw = emptyRaw({ withdrawalTransactions: [original, reversal] });

    const entries = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entries.find((e) => e.id === "orig-wd")).toMatchObject({ status: "cancelled", reversalOfTransactionId: null });
    expect(entries.find((e) => e.id === "rev-wd")).toMatchObject({ status: "cancelled", reversalOfTransactionId: "orig-wd" });
  });

  it("an active transaction's entry is status: 'active', reversalOfTransactionId: null", () => {
    const raw = emptyRaw({ investmentTransactions: [makeInvestmentTransaction({ id: "active-one" })] });

    const [entry] = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entry).toMatchObject({ status: "active", reversalOfTransactionId: null });
  });

  it("a leg-derived entry inherits 'cancelled' from its PARENT withdrawal's status (no separate leg-level reversal, reversalOfTransactionId always null)", () => {
    const cancelledWithdrawal = makeWithdrawalTransaction({ id: "wd-cancelled", status: "cancelled" });
    const leg = makeLeg({ id: "leg-of-cancelled", withdrawalTransactionId: "wd-cancelled", destinationType: "project", destinationProjectId: "project-b" });
    const raw = emptyRaw({ withdrawalTransactions: [cancelledWithdrawal], withdrawalDestinationAllocations: [leg] });

    const legEntry = assembleMoneyHistory(raw, UNRESTRICTED, {}).find((e) => e.id === "leg-of-cancelled");

    expect(legEntry).toMatchObject({ status: "cancelled", reversalOfTransactionId: null });
  });

  it("an available_balance_spends-derived entry is always status: 'active' -- no cancel capability exists for spends", () => {
    const raw = emptyRaw({ availableBalanceSpends: [makeSpend({ id: "spend-active" })] });

    const [entry] = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entry).toMatchObject({ status: "active", reversalOfTransactionId: null });
  });
});

describe("assembleMoneyHistory — filters (AND, not OR)", () => {
  const raw = emptyRaw({
    investmentTransactions: [
      makeInvestmentTransaction({
        id: "jan",
        projectId: "project-a",
        shareId: "partner-1",
        transactionDate: "2026-01-15",
      }),
      makeInvestmentTransaction({
        id: "jun",
        projectId: "project-a",
        shareId: "partner-1",
        transactionDate: "2026-06-15",
      }),
      makeInvestmentTransaction({
        id: "jun-other-project",
        projectId: "project-b",
        shareId: "partner-2",
        transactionDate: "2026-06-20",
      }),
    ],
  });

  it("dateFrom/dateTo narrows to the inclusive range", () => {
    const entries = assembleMoneyHistory(raw, UNRESTRICTED, { dateFrom: "2026-06-01", dateTo: "2026-06-30" });
    expect(entries.map((e) => e.id).sort()).toEqual(["jun", "jun-other-project"]);
  });

  it("projectId narrows to one Project", () => {
    const entries = assembleMoneyHistory(raw, UNRESTRICTED, { projectId: "project-b" });
    expect(entries.map((e) => e.id)).toEqual(["jun-other-project"]);
  });

  it("personName narrows via a case-insensitive substring match against the resolved party name", () => {
    const entries = assembleMoneyHistory(raw, UNRESTRICTED, { personName: "partner a" });
    expect(entries.map((e) => e.id).sort()).toEqual(["jan", "jun"]);
  });

  it("combines date + project filters as AND -- only the entry matching BOTH survives", () => {
    const entries = assembleMoneyHistory(raw, UNRESTRICTED, {
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      projectId: "project-a",
    });
    expect(entries.map((e) => e.id)).toEqual(["jun"]);
  });

  it("partyType + shareId narrow to one specific share", () => {
    const entries = assembleMoneyHistory(raw, UNRESTRICTED, { partyType: "partner", shareId: "partner-2" });
    expect(entries.map((e) => e.id)).toEqual(["jun-other-project"]);
  });
});

describe("assembleMoneyHistory — sorting", () => {
  it("sorts by date descending across every entry type", () => {
    const raw = emptyRaw({
      investmentTransactions: [makeInvestmentTransaction({ id: "oldest", transactionDate: "2026-01-01" })],
      withdrawalTransactions: [makeWithdrawalTransaction({ id: "newest", transactionDate: "2026-12-01" })],
      availableBalanceSpends: [makeSpend({ id: "middle", createdAt: "2026-06-01T00:00:00.000Z" })],
    });

    const entries = assembleMoneyHistory(raw, UNRESTRICTED, {});

    expect(entries.map((e) => e.id)).toEqual(["newest", "middle", "oldest"]);
  });
});

describe("assembleMoneyHistory — orphaned leg defensiveness", () => {
  it("silently skips a leg whose parent withdrawal transaction can't be found, rather than throwing", () => {
    const leg = makeLeg({ id: "orphan", withdrawalTransactionId: "does-not-exist" });
    const raw = emptyRaw({ withdrawalDestinationAllocations: [leg] });

    expect(assembleMoneyHistory(raw, UNRESTRICTED, {})).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import type {
  AuditLogEntry,
  InvestmentTransaction,
  Money,
  Percent,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { assembleAuditHistory, type AuditHistoryRawData } from "./audit-history";

function makeInvestmentTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "itx-1",
    requirementId: "req-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50" as Percent,
    shouldPaySnapshot: "500000" as Money,
    amount: "500000" as Money,
    transactionDate: "2026-10-01",
    paymentMode: "upi",
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
    id: "wtx-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50" as Percent,
    canTakeSnapshot: "250000" as Money,
    amount: "250000" as Money,
    transactionDate: "2026-10-02",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAuditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "audit-1",
    entityType: "investment_transaction",
    entityId: "itx-1",
    action: "create",
    actorUserId: "owner-1",
    oldValue: null,
    newValue: { amount: "500000" },
    reason: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const EMPTY_RAW: AuditHistoryRawData = {
  auditLog: [],
  investmentTransactions: [],
  withdrawalTransactions: [],
  usersById: {},
};

describe("assembleAuditHistory — Story 5.9 (every I/O matrix row)", () => {
  it("I/O row 1/2: an owner_admin sees who/when/old/new/reason for every investment and withdrawal entry, actor name resolved", () => {
    const raw: AuditHistoryRawData = {
      ...EMPTY_RAW,
      auditLog: [
        makeAuditEntry({
          id: "audit-1",
          entityType: "investment_transaction",
          entityId: "itx-1",
          action: "edit",
          actorUserId: "owner-1",
          oldValue: { amount: "400000" },
          newValue: { amount: "500000" },
          reason: "typo'd the original amount",
          createdAt: "2026-10-01T00:00:00.000Z",
        }),
        makeAuditEntry({
          id: "audit-2",
          entityType: "withdrawal_transaction",
          entityId: "wtx-1",
          action: "create",
          actorUserId: "owner-1",
          oldValue: null,
          newValue: { amount: "250000" },
          reason: null,
          createdAt: "2026-10-02T00:00:00.000Z",
        }),
      ],
      investmentTransactions: [makeInvestmentTransaction()],
      withdrawalTransactions: [makeWithdrawalTransaction()],
      usersById: { "owner-1": { email: "owner@niveshbook.test" } },
    };

    const rows = assembleAuditHistory(raw);

    expect(rows).toHaveLength(2);
    const investmentRow = rows.find((row) => row.entityType === "investment_transaction");
    expect(investmentRow).toMatchObject({
      id: "audit-1",
      entityId: "itx-1",
      action: "edit",
      actorUserId: "owner-1",
      actorName: "owner@niveshbook.test",
      oldValue: { amount: "400000" },
      newValue: { amount: "500000" },
      reason: "typo'd the original amount",
      linkedTransactionId: null,
    });
    const withdrawalRow = rows.find((row) => row.entityType === "withdrawal_transaction");
    expect(withdrawalRow).toMatchObject({
      id: "audit-2",
      entityId: "wtx-1",
      action: "create",
      actorName: "owner@niveshbook.test",
      linkedTransactionId: null,
    });
  });

  it("I/O row 3/matrix's linked-pair case: a cancelled investment transaction's create/edit/cancel entries are ALL tagged with its reversal's id, not just the cancel entry (Decision #5, applied system-wide)", () => {
    const original = makeInvestmentTransaction({ id: "itx-1", status: "cancelled" });
    const reversal = makeInvestmentTransaction({
      id: "itx-2",
      status: "cancelled",
      reversalOfTransactionId: "itx-1",
    });
    const raw: AuditHistoryRawData = {
      ...EMPTY_RAW,
      auditLog: [
        makeAuditEntry({ id: "audit-1", entityId: "itx-1", action: "create" }),
        // A multi-edit-then-cancel trail (post-review addition, proving the
        // tagging isn't accidentally limited to exactly 2 rows) -- an "edit"
        // entry in between the original "create" and the eventual "cancel".
        makeAuditEntry({
          id: "audit-1b",
          entityId: "itx-1",
          action: "edit",
          reason: "corrected the amount",
          createdAt: "2026-10-01T01:00:00.000Z",
        }),
        makeAuditEntry({
          id: "audit-2",
          entityId: "itx-1",
          action: "cancel",
          reason: "recorded by mistake",
          createdAt: "2026-10-01T02:00:00.000Z",
        }),
      ],
      investmentTransactions: [original, reversal],
      usersById: { "owner-1": { email: "owner@niveshbook.test" } },
    };

    const rows = assembleAuditHistory(raw);

    const createRow = rows.find((row) => row.id === "audit-1");
    const editRow = rows.find((row) => row.id === "audit-1b");
    const cancelRow = rows.find((row) => row.id === "audit-2");
    // Every entry for a transaction that has since been reversed is tagged
    // with the reversal's id (not just the "cancel" entry, and not just the
    // first two rows) -- the tag is keyed on `entityId` (the transaction),
    // not on `action`, so the whole trail for that transaction is
    // consistently shown as reversed/linked, regardless of how many entries
    // it has.
    expect(createRow?.linkedTransactionId).toBe("itx-2");
    expect(editRow?.linkedTransactionId).toBe("itx-2");
    expect(cancelRow?.linkedTransactionId).toBe("itx-2");
  });

  it("mirrors the linked-pair case for a withdrawal cancel+reversal fixture, one ledger over", () => {
    const original = makeWithdrawalTransaction({ id: "wtx-1", status: "cancelled" });
    const reversal = makeWithdrawalTransaction({
      id: "wtx-2",
      status: "cancelled",
      reversalOfTransactionId: "wtx-1",
    });
    const raw: AuditHistoryRawData = {
      ...EMPTY_RAW,
      auditLog: [
        makeAuditEntry({ id: "audit-1", entityType: "withdrawal_transaction", entityId: "wtx-1", action: "create" }),
        makeAuditEntry({ id: "audit-2", entityType: "withdrawal_transaction", entityId: "wtx-1", action: "cancel" }),
      ],
      withdrawalTransactions: [original, reversal],
      usersById: { "owner-1": { email: "owner@niveshbook.test" } },
    };

    const rows = assembleAuditHistory(raw);

    expect(rows.find((row) => row.id === "audit-2")?.linkedTransactionId).toBe("wtx-2");
  });

  it("I/O row 8 (Decision #6): never shows withdrawal_destination_allocation/available_balance_spend/adjustment_netting rows, even though real audit_log rows exist for them today", () => {
    const raw: AuditHistoryRawData = {
      ...EMPTY_RAW,
      auditLog: [
        makeAuditEntry({ id: "audit-1", entityType: "investment_transaction", entityId: "itx-1" }),
        makeAuditEntry({ id: "audit-2", entityType: "withdrawal_destination_allocation", entityId: "leg-1" }),
        makeAuditEntry({ id: "audit-3", entityType: "available_balance_spend", entityId: "spend-1" }),
        makeAuditEntry({ id: "audit-4", entityType: "adjustment_netting", entityId: "netting-1" }),
      ],
      investmentTransactions: [makeInvestmentTransaction()],
      usersById: { "owner-1": { email: "owner@niveshbook.test" } },
    };

    const rows = assembleAuditHistory(raw);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("audit-1");
    expect(rows.some((row) => row.entityType !== "investment_transaction")).toBe(false);
  });

  it("I/O row 7: a transaction with no cancellation has linkedTransactionId: null, no crash", () => {
    const raw: AuditHistoryRawData = {
      ...EMPTY_RAW,
      auditLog: [makeAuditEntry({ id: "audit-1", entityId: "itx-1", action: "create" })],
      investmentTransactions: [makeInvestmentTransaction()],
      usersById: { "owner-1": { email: "owner@niveshbook.test" } },
    };

    const rows = assembleAuditHistory(raw);

    expect(rows[0]?.linkedTransactionId).toBeNull();
  });

  it("resolves an unknown actor to a defensive fallback name rather than crashing", () => {
    const raw: AuditHistoryRawData = {
      ...EMPTY_RAW,
      auditLog: [makeAuditEntry({ id: "audit-1", entityId: "itx-1", actorUserId: "ghost-user" })],
      investmentTransactions: [makeInvestmentTransaction()],
      usersById: {},
    };

    const rows = assembleAuditHistory(raw);

    expect(rows[0]?.actorName).toBe("Unknown user");
  });

  it("sorts newest-first (createdAt descending)", () => {
    const raw: AuditHistoryRawData = {
      ...EMPTY_RAW,
      auditLog: [
        makeAuditEntry({ id: "audit-older", createdAt: "2026-10-01T00:00:00.000Z" }),
        makeAuditEntry({ id: "audit-newer", createdAt: "2026-10-05T00:00:00.000Z" }),
      ],
      investmentTransactions: [makeInvestmentTransaction()],
      usersById: { "owner-1": { email: "owner@niveshbook.test" } },
    };

    const rows = assembleAuditHistory(raw);

    expect(rows.map((row) => row.id)).toEqual(["audit-newer", "audit-older"]);
  });

  it("returns an empty list for an empty audit_log", () => {
    expect(assembleAuditHistory(EMPTY_RAW)).toEqual([]);
  });
});

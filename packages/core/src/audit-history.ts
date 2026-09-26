import type { AuditLogEntry, InvestmentTransaction, User, WithdrawalTransaction } from "@niveshbook/types";

/**
 * Every already-fetched raw row list `assembleAuditHistory()` needs (Story
 * 5.9, FR41/FR42) -- pure, no DB access (AD-9), mirrors
 * `PartnerDashboardRawData`/`OwnerAdminDashboardRawData`'s established
 * "already-fetched `listAll()` rows in, pure function, derived rows out"
 * shape. `investmentTransactions`/`withdrawalTransactions` are reused
 * unchanged from their own existing Story 5.1 `listAll()` sources -- this
 * function never issues a new query shape of its own to resolve a
 * cancel/reversal link (Decision #6/#5's shared mechanism, applied
 * system-wide here instead of per-transaction).
 */
export interface AuditHistoryRawData {
  auditLog: readonly AuditLogEntry[];
  investmentTransactions: readonly InvestmentTransaction[];
  withdrawalTransactions: readonly WithdrawalTransaction[];
  /** Every user, keyed by `id` -- resolves `AuditLogEntry.actorUserId` to a display name. `User` has no `name` field (only Partner/Sub-partner Shares do), so `email` is the display name here. */
  usersById: Readonly<Record<string, Pick<User, "email">>>;
}

/** In scope per this story's Decision #6 -- the `audit_log` table's other 3 already-written entity types (`withdrawal_destination_allocation`/`available_balance_spend`/`adjustment_netting`) stay unexposed by this story. */
const IN_SCOPE_ENTITY_TYPES = new Set(["investment_transaction", "withdrawal_transaction"]);

export type AuditHistoryEntityType = "investment_transaction" | "withdrawal_transaction";

/** One row on the global Audit History page (Story 5.9) -- one row per in-scope `audit_log` entry, actor name resolved, reversal-linked where applicable. */
export interface AuditHistoryRow {
  id: string;
  entityType: AuditHistoryEntityType;
  entityId: string;
  action: string;
  actorUserId: string;
  /** Resolved from `usersById`; `"Unknown user"` if the actor no longer resolves (defensive -- `audit_log.actorUserId` is a NOT NULL FK, so this should be unreachable in practice). */
  actorName: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /**
   * The linked reversal transaction's id, only ever populated for a row
   * whose own transaction (`entityId`) has since been cancelled (Decision
   * #5's mechanism, applied system-wide here instead of per-transaction) --
   * `null` otherwise. Lets the UI visually group a `"cancel"` entry with the
   * reversal it created, even though the reversal transaction itself never
   * gets its own `audit_log` row (`cancelTransaction`'s own atomicity
   * contract only ever inserts one `"cancel"` entry, against the ORIGINAL
   * transaction's id).
   */
  linkedTransactionId: string | null;
}

const UNKNOWN_ACTOR_NAME = "Unknown user";

/**
 * Assembles the global Audit History page's full row list (Story 5.9,
 * FR41/FR42) -- pure (AD-9), no DB access: every row this function reads is
 * already fetched, bundled in `raw`. Filters `raw.auditLog` down to
 * `entityType` in `("investment_transaction", "withdrawal_transaction")`
 * (Decision #6) -- every other entity type's rows (including the 3 already
 * written today: `withdrawal_destination_allocation`/`available_balance_spend`/
 * `adjustment_netting`) are silently dropped, never surfaced by this
 * function. Sorted newest-first (`createdAt` descending, `id` descending
 * tiebreak), mirroring `assembleMoneyHistory()`'s identical convention.
 *
 * Cross-references each row's `entityId` against `raw.investmentTransactions`/
 * `raw.withdrawalTransactions`' own `reversalOfTransactionId` column to find
 * a transaction's linked reversal (if any) -- the same mechanism the
 * per-transaction audit-log routes use (Decision #5), applied system-wide.
 */
export function assembleAuditHistory(raw: AuditHistoryRawData): AuditHistoryRow[] {
  // originalTransactionId -> its reversal's own id, across both ledgers.
  const reversalIdByOriginalId = new Map<string, string>();
  for (const transaction of raw.investmentTransactions) {
    if (transaction.reversalOfTransactionId) {
      reversalIdByOriginalId.set(transaction.reversalOfTransactionId, transaction.id);
    }
  }
  for (const transaction of raw.withdrawalTransactions) {
    if (transaction.reversalOfTransactionId) {
      reversalIdByOriginalId.set(transaction.reversalOfTransactionId, transaction.id);
    }
  }

  return raw.auditLog
    .filter((entry) => IN_SCOPE_ENTITY_TYPES.has(entry.entityType))
    .map((entry) => ({
      id: entry.id,
      entityType: entry.entityType as AuditHistoryEntityType,
      entityId: entry.entityId,
      action: entry.action,
      actorUserId: entry.actorUserId,
      actorName: raw.usersById[entry.actorUserId]?.email ?? UNKNOWN_ACTOR_NAME,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      reason: entry.reason,
      createdAt: entry.createdAt,
      linkedTransactionId: reversalIdByOriginalId.get(entry.entityId) ?? null,
    }))
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      return a.id < b.id ? 1 : -1;
    });
}

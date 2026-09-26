import type { AuditLogEntry } from "@niveshbook/types";

/**
 * Port for reading the entity-agnostic `audit_log` table in full (Story 5.9,
 * FR41/FR42) -- deliberately narrow (Interface Segregation): `listAll()`
 * only, not folded onto `InvestmentTransactionPort`/`WithdrawalTransactionPort`
 * (each of which already exposes its own scoped
 * `findAuditLogByTransactionId`). This is the new global Audit History
 * page's sole read: `assembleAuditHistory()` (`audit-history.ts`) filters the
 * unfiltered result down to the two in-scope `entityType`s (Decision #6).
 * Implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9).
 */
export interface AuditLogPort {
  /** Every `audit_log` row, every entity type, unfiltered, no pagination (this story's Decision #7 -- no pagination infra is required by this story's own AC). */
  listAll(): Promise<AuditLogEntry[]>;
}

import type { AuditLogEntry, InvestmentTransaction, Money, PaymentMode, Percent } from "@niveshbook/types";

export interface CreateInvestmentTransactionInput {
  requirementId: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` -- see `InvestmentTransaction`'s own doc comment. Already resolved to an existing current share by the route layer before this port is called. */
  shareId: string;
  /** Snapshotted from `computeShouldPay`'s live result at creation time (AD-3) -- already validated `Percent`/`Money` values, never recomputed here. */
  sharePercentSnapshot: Percent;
  shouldPaySnapshot: Money;
  amount: Money;
  /** Plain date, `YYYY-MM-DD` -- already validated by the domain layer before this port is called. */
  transactionDate: string;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  notes: string | null;
  /** Enforced UNIQUE at the DB level (this story's Decisions) -- the mechanism `recordTransaction` uses to detect both a straightforward replay and a concurrent double-submit race. */
  idempotencyKey: string;
  /** The acting user's id -- written onto the paired `audit_log` row (`actorUserId`), never a column on `investment_transactions` itself. */
  actorUserId: string;
}

export interface RecordTransactionResult {
  transaction: InvestmentTransaction;
  /**
   * `true` only when this call genuinely inserted a new row. `false` when it
   * resolved to an idempotent replay of an existing row -- either the
   * straightforward case (an identical `idempotencyKey` was already present
   * before this call started) or the concurrent-double-submit race (this
   * call's own insert lost a race against another request's identical
   * `idempotencyKey` and recovered by reading back the winning row). The
   * route layer uses this to return 200 (replay) instead of 201 (genuine
   * create) -- the returned `transaction` is otherwise identical either way,
   * per this story's Boundaries ("a repeated POST with the same
   * idempotencyKey returns the original row (200, not 201)").
   */
  created: boolean;
}

/**
 * The mutable-fields-only edit request (Story 3.7) -- deliberately excludes
 * every identity/snapshot field an edit must never touch:
 * `sharePercentSnapshot`/`shouldPaySnapshot` (AD-3's frozen-at-creation
 * guarantee applies to edits too), `requirementId`/`projectId`/`partyType`/
 * `shareId` (a transaction's identity never moves to a different
 * requirement/share via an edit), its own `idempotencyKey` (the original
 * *create* action's key, untouched), and `createdAt`. Structurally, this
 * type alone is what guarantees the port implementation can't accidentally
 * write one of those fields even if it wanted to.
 */
export interface EditInvestmentTransactionInput {
  /** The existing transaction's id -- already confirmed to exist (and belong to this requirement/project) by the route layer before this port is called. */
  transactionId: string;
  amount: Money;
  /** Plain date, `YYYY-MM-DD` -- already validated by the domain layer before this port is called. */
  transactionDate: string;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  notes: string | null;
  /**
   * Enforced UNIQUE-when-present at the DB level, on `audit_log.idempotencyKey`
   * -- deliberately NOT `investment_transactions.idempotencyKey` (that
   * column holds the original *create* action's key, tied to a row insert
   * that never happens again for this transaction). This is the mechanism
   * `editTransaction` uses to detect both a straightforward replay and a
   * concurrent double-submit race, mirroring `CreateInvestmentTransactionInput.idempotencyKey`'s
   * exact role one level over.
   */
  idempotencyKey: string;
  /** The acting user's id -- written onto the paired `audit_log` row (`actorUserId`), never a column on `investment_transactions` itself. */
  actorUserId: string;
  /** Optional -- written onto the paired `audit_log` row's `reason` column. `null` when the caller didn't supply one (`audit_log.reason`'s existing nullable design, Story 3.3). */
  reason: string | null;
}

export interface EditTransactionResult {
  transaction: InvestmentTransaction;
  /**
   * `true` only when this call genuinely updated the row. `false` when it
   * resolved to an idempotent replay of an already-applied edit -- mirrors
   * `RecordTransactionResult.created`'s exact shape one level over (a
   * repeated `PATCH` with the same `idempotencyKey` returns the
   * transaction's current state, not a re-application of the edit -- the
   * route layer still returns 200 either way, per this story's Boundaries,
   * unlike `recordTransaction`'s 201-vs-200 split).
   */
  edited: boolean;
}

/**
 * The cancel request (Story 3.8, FR42) -- deliberately minimal: unlike
 * `EditInvestmentTransactionInput`, cancelling never changes any of the
 * original row's own recorded fields (amount/date/paymentMode/etc.) -- it
 * only flips `status` to `"cancelled"` in place and creates a linked
 * reversal row (see `CancelTransactionResult`'s own doc comment).
 */
export interface CancelInvestmentTransactionInput {
  /** The existing transaction's id -- already confirmed to exist (and belong to this requirement/project) by the route layer before this port is called. */
  transactionId: string;
  /**
   * Enforced UNIQUE-when-present at the DB level, on `audit_log.idempotencyKey`
   * -- mirrors `EditInvestmentTransactionInput.idempotencyKey`'s exact role
   * one level over (this story's Decisions: reuses Story 3.7's mechanism
   * unchanged, not a new column).
   */
  idempotencyKey: string;
  /** The acting user's id -- written onto the paired `audit_log` row (`actorUserId`), never a column on `investment_transactions` itself. */
  actorUserId: string;
  /** Optional -- written onto the paired `audit_log` row's `reason` column, mirroring `EditInvestmentTransactionInput.reason`. */
  reason: string | null;
}

export interface CancelTransactionResult {
  /** The original transaction, `status` now `"cancelled"` -- every other field untouched (FR42: "the original record is preserved"). */
  originalTransaction: InvestmentTransaction;
  /**
   * The newly-created linked reversal row -- carries the same
   * `requirementId`/`projectId`/`partyType`/`shareId`/`paymentMode`/`amount`
   * as `originalTransaction`, `status: "cancelled"` too (so it never counts
   * toward Paid Now either), `reversalOfTransactionId` pointing back at
   * `originalTransaction.id`.
   */
  reversalTransaction: InvestmentTransaction;
  /**
   * `true` only when this call genuinely performed the cancel (flipped the
   * original row and inserted the reversal row). `false` when it resolved to
   * an idempotent replay of an already-applied cancel -- mirrors
   * `EditTransactionResult.edited`'s exact shape one level over.
   */
  cancelled: boolean;
}

/**
 * Port for reading/writing Investment Transaction rows (Story 3.3) --
 * implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9).
 */
export interface InvestmentTransactionPort {
  /**
   * Atomicity contract (AD-5): a successful call writes exactly one
   * `investment_transactions` row and exactly one paired `audit_log` row
   * (`entityType: "investment_transaction"`, `entityId` = the new
   * transaction's id, `action: "create"`, `actorUserId` = `input.actorUserId`,
   * `oldValue: null`, `newValue` = the full saved transaction row, `reason:
   * null`) inside a single DB transaction -- the implementation never allows
   * one to be written without the other.
   *
   * Idempotency contract: if a row with `input.idempotencyKey` already
   * exists, that existing row is returned unchanged (`created: false`) --
   * no new `investment_transactions` row, no new `audit_log` row -- rather
   * than throwing or creating a duplicate. This covers both the
   * straightforward replay case (checked first, before attempting an
   * insert) and the concurrent-double-submit race, where two calls both
   * miss that first check and both attempt to insert: the loser's insert
   * fails against the `idempotencyKey` UNIQUE constraint, and the
   * implementation recovers by re-reading and returning the winner's row
   * instead of propagating the error.
   */
  recordTransaction(input: CreateInvestmentTransactionInput): Promise<RecordTransactionResult>;
  /** Every transaction recorded against one funding requirement, chronological (`createdAt` ascending). */
  listByRequirementId(requirementId: string): Promise<InvestmentTransaction[]>;
  /** The transaction with this id, or `null` if it doesn't exist (Story 3.7). */
  findById(id: string): Promise<InvestmentTransaction | null>;
  /**
   * Atomicity contract (AD-5), mirroring `recordTransaction`'s exact shape
   * one level over: a successful call updates exactly one
   * `investment_transactions` row's mutable fields (see
   * `EditInvestmentTransactionInput`'s own doc comment for exactly which --
   * and, just as importantly, which fields it never touches) and inserts
   * exactly one paired `audit_log` row (`entityType: "investment_transaction"`,
   * `entityId` = `input.transactionId`, `action: "edit"`, `actorUserId` =
   * `input.actorUserId`, `oldValue` = the full previous row, `newValue` =
   * the full new row, `reason` = `input.reason`, `idempotencyKey` =
   * `input.idempotencyKey`) inside a single DB transaction.
   *
   * Idempotency contract: if an `audit_log` entry with `input.idempotencyKey`
   * already exists, this call does NOT re-apply the edit -- it returns the
   * transaction's current state (`edited: false`) instead, without writing
   * anything. Mirrors `recordTransaction`'s check-first-then-
   * catch-unique-violation-and-recover pattern exactly, just checked against
   * `audit_log.idempotencyKey` instead of `investment_transactions.idempotencyKey`
   * (since an edit updates an existing row rather than inserting a new one,
   * there's no natural row-level UNIQUE column on `investment_transactions`
   * itself to dedupe against). This idempotency check runs BEFORE the
   * already-cancelled check below, so a `PATCH` whose `idempotencyKey`
   * matches a PRIOR edit that succeeded before a later cancel still replays
   * correctly (`edited: false`) -- it never re-applies anything, so there is
   * nothing for the already-cancelled guard to protect against there.
   *
   * Already-cancelled contract (Story 3.8, spec-3-8's Review Triage Log row
   * 1): for a genuinely new edit attempt (not the idempotent-replay case
   * above), this is the AUTHORITATIVE already-cancelled check -- performed
   * INSIDE the same `database.transaction()`, immediately after the
   * `SELECT ... FOR UPDATE` read of the row being edited (mirroring
   * `cancelTransaction`'s own `originalRow.status === "cancelled"` check one
   * level over): if the locked row's `status` is already `"cancelled"`,
   * throws `AlreadyCancelledError` before the `UPDATE` ever runs. This is
   * what actually closes the race where a non-locking pre-check (e.g.
   * `packages/core`'s own early guard, a separate/earlier round trip) could
   * pass against a still-`active` row that a concurrent `cancelTransaction`
   * call then cancels before this edit acquires its own lock -- without the
   * lock-scoped check here, that race would silently mutate a closed
   * financial record.
   */
  editTransaction(input: EditInvestmentTransactionInput): Promise<EditTransactionResult>;
  /**
   * Every `audit_log` entry for one transaction (`entityType:
   * "investment_transaction"`, `entityId` = `transactionId`), chronological
   * (`createdAt` ascending) -- the original `"create"` entry plus any later
   * `"edit"` (this story) / `"cancel"` (Story 3.8) entries. Not filtered to
   * only edits (this story's Decisions: "the audit trail" naturally includes
   * the transaction's origin too).
   */
  findAuditLogByTransactionId(transactionId: string): Promise<AuditLogEntry[]>;
  /**
   * Atomicity contract (AD-5), mirroring `editTransaction`'s exact shape one
   * level over: a successful call (1) updates the original
   * `investment_transactions` row's `status` to `"cancelled"` (nothing else
   * on it), (2) inserts exactly one new `investment_transactions` row (the
   * reversal, see `CancelTransactionResult`), and (3) inserts exactly one
   * paired `audit_log` row (`entityType: "investment_transaction"`,
   * `entityId` = `input.transactionId`, `action: "cancel"`, `actorUserId` =
   * `input.actorUserId`, `oldValue` = the original row before the flip,
   * `newValue` = the original row after the flip, `reason` = `input.reason`,
   * `idempotencyKey` = `input.idempotencyKey`) -- all inside a single DB
   * transaction, never a subset. No `DELETE` is ever issued.
   *
   * Idempotency contract, mirroring `editTransaction`'s exactly: if an
   * `audit_log` entry with `input.idempotencyKey` already exists (and its
   * `entityId` matches `input.transactionId`), this call does NOT re-apply
   * the cancel -- it returns the already-cancelled original plus its
   * existing reversal row (`cancelled: false`), without writing anything. If
   * an entry exists but its `entityId` does NOT match (a genuine key
   * collision with an unrelated cancel/edit request), throws
   * `IdempotencyKeyConflictError`.
   *
   * Already-cancelled contract: if `input.transactionId`'s current `status`
   * is already `"cancelled"` at write time, and this is NOT a
   * concurrent-race replay of the exact same `idempotencyKey` (see
   * `packages/db`'s own implementation doc comment for how that race is
   * distinguished from a genuinely new cancel attempt), throws
   * `AlreadyCancelledError` -- no second reversal row, no second
   * `audit_log` entry.
   */
  cancelTransaction(input: CancelInvestmentTransactionInput): Promise<CancelTransactionResult>;
  /**
   * Story 4.1 (FR21/AD-2): the sum of every non-cancelled (`status: "active"`)
   * `investment_transactions.amount` row for the Project, across every one of
   * its funding requirements -- "the Project's available-to-withdraw amount"
   * per spec-4-1's Decisions (the total actively-invested money to date;
   * nothing subtracted for withdrawals yet, since `withdrawal_transactions`
   * doesn't exist until Story 4.2). Computed live via a DB-side `SUM`, never
   * by fetching every row and adding client-side -- this is the one
   * aggregate read this port exposes, distinct from `listByRequirementId`'s
   * per-requirement row list. Returns `"0"` (never throws, never `null`) for
   * a Project with zero active transactions -- the zero-investment I/O case.
   */
  sumActiveAmountByProjectId(projectId: string): Promise<Money>;
  /**
   * Every `investment_transactions` row across every requirement/Project,
   * unfiltered, no pagination (Story 5.1, FR31) -- mirrors
   * `PartnerSharePort.listAll()`'s exact Story 2.7 shape. Money History's
   * `assembleMoneyHistory()` is the sole consumer -- it classifies each row
   * as a plain `"money_added"` entry or a cross-Project movement destination
   * itself, via `MoneyMovementPort.listAll()`'s own rows, never a per-row
   * DB lookup.
   */
  listAll(): Promise<InvestmentTransaction[]>;
}

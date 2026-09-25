import type { Money, PaymentMode, Percent, WithdrawalTransaction } from "@niveshbook/types";

export interface CreateWithdrawalTransactionInput {
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` -- see `WithdrawalTransaction`'s own doc comment. Already resolved to an existing current share by the route layer before this port is called. */
  shareId: string;
  /** Snapshotted from `computeCanTake`'s live result at creation time (AD-3) -- already validated `Percent`/`Money` values, never recomputed here. */
  sharePercentSnapshot: Percent;
  canTakeSnapshot: Money;
  amount: Money;
  /** Plain date, `YYYY-MM-DD` -- already validated by the domain layer before this port is called. */
  transactionDate: string;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  notes: string | null;
  /** Enforced UNIQUE at the DB level (mirrors `investment_transactions.idempotencyKey`, Story 3.3's precedent) -- the mechanism `recordTransaction` uses to detect both a straightforward replay and a concurrent double-submit race. */
  idempotencyKey: string;
  /** The acting user's id -- written onto the paired `audit_log` row (`actorUserId`), never a column on `withdrawal_transactions` itself. */
  actorUserId: string;
}

export interface RecordWithdrawalTransactionResult {
  transaction: WithdrawalTransaction;
  /**
   * `true` only when this call genuinely inserted a new row. `false` when it
   * resolved to an idempotent replay of an existing row -- either the
   * straightforward case (an identical `idempotencyKey` was already present
   * before this call started) or the concurrent-double-submit race (this
   * call's own insert lost a race against another request's identical
   * `idempotencyKey` and recovered by reading back the winning row). The
   * route layer uses this to return 200 (replay) instead of 201 (genuine
   * create) -- the returned `transaction` is otherwise identical either way,
   * mirroring `RecordTransactionResult.created`'s exact shape one ledger
   * over (Story 3.3).
   */
  created: boolean;
}

/**
 * The mutable-fields-only edit request (Story 4.11) -- mirrors
 * `EditInvestmentTransactionInput`'s exact shape one ledger over,
 * deliberately excluding every identity/snapshot field an edit must never
 * touch: `sharePercentSnapshot`/`canTakeSnapshot` (AD-3's frozen-at-creation
 * guarantee), `projectId`/`partyType`/`shareId` (a withdrawal's identity
 * never moves via an edit), its own `idempotencyKey` (the original *create*
 * action's key, untouched), and `createdAt`.
 */
export interface EditWithdrawalTransactionInput {
  /** The existing withdrawal's id -- already confirmed to exist (and belong to this Project) by the route layer before this port is called. */
  transactionId: string;
  amount: Money;
  /** Plain date, `YYYY-MM-DD` -- already validated by the domain layer before this port is called. */
  transactionDate: string;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  notes: string | null;
  /**
   * Enforced UNIQUE-when-present at the DB level, on `audit_log.idempotencyKey`
   * -- deliberately NOT `withdrawal_transactions.idempotencyKey` (that column
   * holds the original *create* action's key), mirroring
   * `EditInvestmentTransactionInput.idempotencyKey`'s exact role one ledger
   * over.
   */
  idempotencyKey: string;
  /** The acting user's id -- written onto the paired `audit_log` row (`actorUserId`), never a column on `withdrawal_transactions` itself. */
  actorUserId: string;
  /** Optional -- written onto the paired `audit_log` row's `reason` column, `null` when the caller didn't supply one. */
  reason: string | null;
}

export interface EditWithdrawalTransactionResult {
  transaction: WithdrawalTransaction;
  /**
   * `true` only when this call genuinely updated the row. `false` when it
   * resolved to an idempotent replay of an already-applied edit -- mirrors
   * `EditTransactionResult.edited`'s exact shape one ledger over.
   */
  edited: boolean;
}

/**
 * The cancel request (Story 4.11) -- deliberately minimal, mirroring
 * `CancelInvestmentTransactionInput`'s exact shape one ledger over:
 * cancelling never changes any of the original row's own recorded fields --
 * it only flips `status` to `"cancelled"` in place, creates a linked
 * reversal row, and cascades to every linked leg (see
 * `CancelWithdrawalTransactionResult`'s own doc comment).
 */
export interface CancelWithdrawalTransactionInput {
  /** The existing withdrawal's id -- already confirmed to exist (and belong to this Project) by the route layer before this port is called. */
  transactionId: string;
  /**
   * Enforced UNIQUE-when-present at the DB level, on `audit_log.idempotencyKey`
   * -- mirrors `EditWithdrawalTransactionInput.idempotencyKey`'s exact role
   * one field over.
   */
  idempotencyKey: string;
  /** The acting user's id -- written onto the paired `audit_log` row (`actorUserId`), never a column on `withdrawal_transactions` itself. */
  actorUserId: string;
  /** Optional -- written onto the paired `audit_log` row's `reason` column. */
  reason: string | null;
}

export interface CancelWithdrawalTransactionResult {
  /** The original withdrawal, `status` now `"cancelled"` -- every other field untouched. */
  originalTransaction: WithdrawalTransaction;
  /**
   * The newly-created linked reversal row -- carries the same `projectId`/
   * `partyType`/`shareId`/`paymentMode`/`amount` as `originalTransaction`,
   * `status: "cancelled"` too, `reversalOfTransactionId` pointing back at
   * `originalTransaction.id` -- mirrors `CancelTransactionResult.reversalTransaction`
   * exactly.
   */
  reversalTransaction: WithdrawalTransaction;
  /**
   * `true` only when this call genuinely performed the cancel (flipped the
   * original row, cascaded to every linked leg via `cancelWithdrawalBundle()`,
   * and inserted the reversal row). `false` when it resolved to an idempotent
   * replay of an already-applied cancel.
   */
  cancelled: boolean;
}

/**
 * Port for reading/writing Withdrawal Transaction rows (Story 4.2) --
 * implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9). Mirrors `InvestmentTransactionPort`'s
 * exact atomicity/idempotency contract one ledger over.
 *
 * Story 4.11 extends this port with `editTransaction`/`cancelTransaction`,
 * mirroring `InvestmentTransactionPort`'s identical Story 3.7/3.8 additions
 * one ledger over -- `cancelTransaction` additionally cascades to every
 * linked leg (a "project" leg's destination `investment_transactions` row,
 * an "available_balance" leg's credited pool), the genuinely new
 * cross-cutting concern this story adds that the investment side never
 * needed.
 */
export interface WithdrawalTransactionPort {
  /**
   * Atomicity contract (AD-5): a successful call writes exactly one
   * `withdrawal_transactions` row and exactly one paired `audit_log` row
   * (`entityType: "withdrawal_transaction"`, `entityId` = the new
   * transaction's id, `action: "create"`, `actorUserId` = `input.actorUserId`,
   * `oldValue: null`, `newValue` = the full saved transaction row, `reason:
   * null`) inside a single DB transaction -- the implementation never allows
   * one to be written without the other.
   *
   * Idempotency contract: if a row with `input.idempotencyKey` already
   * exists, that existing row is returned unchanged (`created: false`) --
   * no new `withdrawal_transactions` row, no new `audit_log` row -- rather
   * than throwing or creating a duplicate, but ONLY if that existing row's
   * content (`projectId`/`shareId`/`partyType`/`amount`, via a decimal-safe
   * `moneyEquals` comparison, never raw string equality -- this story's
   * Decisions) matches the current request; a genuine content mismatch
   * throws `IdempotencyKeyConflictError` instead of silently replaying
   * unrelated data. This covers both the straightforward replay case
   * (checked first, before attempting an insert) and the
   * concurrent-double-submit race, where two calls both miss that first
   * check and both attempt to insert: the loser's insert fails against the
   * `idempotencyKey` UNIQUE constraint, and the implementation recovers by
   * re-reading and returning the winner's row instead of propagating the
   * error (re-applying the identical content-match check against the
   * winner).
   */
  recordTransaction(input: CreateWithdrawalTransactionInput): Promise<RecordWithdrawalTransactionResult>;
  /** Every withdrawal recorded against one Project, chronological (`createdAt` ascending) -- mirrors `InvestmentTransactionPort.listByRequirementId`'s identical shape one ledger over. */
  listByProjectId(projectId: string): Promise<WithdrawalTransaction[]>;
  /**
   * Story 4.9 (FR29, Can Take fix): the DB-side `SUM(amount)` of every
   * `withdrawal_transactions` row for `projectId` -- mirrors
   * `InvestmentTransactionPort.sumActiveAmountByProjectId`'s identical
   * shape/rationale one ledger over (Postgres does the addition, never
   * application code -- AD-2). Unlike that method, this table has no
   * `status` column to filter on yet (no cancel/reverse path exists for a
   * withdrawal -- Story 4.11's job), so this sums every row unconditionally.
   * `"0"` when the Project has no withdrawals yet.
   */
  sumActiveAmountByProjectId(projectId: string): Promise<Money>;
  /** The withdrawal with this id, or `null` if it doesn't exist (Story 4.10, FR30) -- mirrors `InvestmentTransactionPort.findById`'s identical shape one ledger over. */
  findById(id: string): Promise<WithdrawalTransaction | null>;
  /**
   * Atomicity contract (AD-5), mirroring `InvestmentTransactionPort.editTransaction`'s
   * exact shape one ledger over: a successful call updates exactly one
   * `withdrawal_transactions` row's mutable fields and inserts exactly one
   * paired `audit_log` row (`entityType: "withdrawal_transaction"`,
   * `entityId` = `input.transactionId`, `action: "edit"`, `actorUserId`,
   * `oldValue` = the full previous row, `newValue` = the full new row,
   * `reason`, `idempotencyKey`) inside a single DB transaction.
   *
   * Idempotency contract, mirroring `editTransaction`'s (investment-side)
   * exactly: if an `audit_log` entry with `input.idempotencyKey` already
   * exists, this call does NOT re-apply the edit -- it returns the
   * withdrawal's current state (`edited: false`) instead.
   *
   * Already-cancelled contract: for a genuinely new edit attempt, this is
   * the AUTHORITATIVE already-cancelled check -- performed INSIDE the same
   * `database.transaction()`, immediately after a `SELECT ... FOR UPDATE`
   * read of the row being edited: if the locked row's `status` is already
   * `"cancelled"`, throws `WithdrawalAlreadyCancelledError` before the
   * `UPDATE` ever runs.
   *
   * Amount-locked contract (Story 4.11's new precondition, no investment-side
   * equivalent): if this withdrawal already has one or more
   * `withdrawal_destination_allocations` legs recorded AND `input.amount`
   * differs from the row's current `amount`, throws
   * `WithdrawalAmountLockedByAllocationError` before the `UPDATE` ever runs
   * -- every other field (date/payment mode/reference number/notes) stays
   * freely editable regardless of allocation status.
   */
  editTransaction(input: EditWithdrawalTransactionInput): Promise<EditWithdrawalTransactionResult>;
  /**
   * Atomicity contract (AD-5), mirroring `InvestmentTransactionPort.cancelTransaction`'s
   * exact shape one ledger over, extended with a cascade this story adds: a
   * successful call (1) cascades to every linked
   * `withdrawal_destination_allocations` leg via `cancelWithdrawalBundle()`
   * (a `"project"` leg's destination `investment_transactions` row is
   * cancelled via `InvestmentTransactionPort.cancelTransaction()`, an
   * `"available_balance"` leg's credited pool is reversed via
   * `AvailableBalancePort.debitBalance()`), (2) updates the original
   * `withdrawal_transactions` row's `status` to `"cancelled"`, (3) inserts
   * exactly one new `withdrawal_transactions` row (the reversal), and (4)
   * inserts exactly one paired `audit_log` row (`entityType:
   * "withdrawal_transaction"`, `action: "cancel"`) -- all inside a single DB
   * transaction, never a subset. No `DELETE` is ever issued, and
   * `withdrawal_destination_allocations`/`money_movements` rows are never
   * touched by a cancel (this story's Decisions #3/#4).
   *
   * If the cascade's `"available_balance"` leg reversal can't be applied
   * because the pool's current balance is less than what that leg
   * originally credited (i.e. some or all of it was already spent onward),
   * `AvailableBalancePort.debitBalance()`'s own `InsufficientAvailableBalanceError`
   * propagates uncaught and the ENTIRE cancellation rolls back -- nothing
   * partially cancelled, the withdrawal stays active, no status flip, no
   * reversal row (this story's Decisions #2, a deliberate, confirmed design
   * choice).
   *
   * Idempotency/already-cancelled contracts otherwise mirror `editTransaction`'s
   * exactly, one action over: a replayed `idempotencyKey` returns the
   * already-cancelled original plus its existing reversal row (`cancelled:
   * false`), without re-running the cascade a second time; a genuinely new
   * cancel attempt against an already-`"cancelled"` row throws
   * `WithdrawalAlreadyCancelledError`.
   */
  cancelTransaction(input: CancelWithdrawalTransactionInput): Promise<CancelWithdrawalTransactionResult>;
}

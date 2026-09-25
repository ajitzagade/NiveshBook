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
 * Port for reading/writing Withdrawal Transaction rows (Story 4.2) --
 * implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9). Mirrors `InvestmentTransactionPort`'s
 * exact atomicity/idempotency contract one ledger over -- deliberately
 * narrower than that port, since this story builds no edit/cancel path yet
 * (Story 4.11's job, mirroring `InvestmentTransactionPort`'s own
 * Story-3.3-before-3.7/3.8 shape).
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
}

import type { InvestmentTransaction, Money, PaymentMode, Percent } from "@niveshbook/types";

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
}

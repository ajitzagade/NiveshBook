import type { AdjustmentNetting, Money } from "@niveshbook/types";

/**
 * Already-validated input for one netting action (Story 5.3, FR33/FR34,
 * AD-4) -- built by `POST /api/adjustment-nettings` after confirming both
 * the referenced `investment_adjustments` row (`partyType`/`shareId`/
 * `projectId`/`investmentRequirementId`) and `withdrawal_adjustments` row
 * (`partyType`/`shareId`/`projectId`) actually exist and belong to the same
 * person (never client-trusted alone). Deliberately carries NO
 * `investmentAdjustmentAmount`/`withdrawalAdjustmentAmount` snapshot of its
 * own -- `amount` is the Owner/Admin's own explicit business decision of how
 * much to net, not itself re-derived from either ledger's current gap
 * (spec-5-3's Decisions #1: this record has zero computed effect on either
 * ledger, so it has no reason to snapshot either one's own numbers either).
 */
export interface RecordAdjustmentNettingInput {
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this netting is about -- never `User.id` (AD-4). */
  shareId: string;
  /** The specific funding requirement whose Investment Adjustment this netted against. */
  investmentRequirementId: string;
  amount: Money;
  notes: string | null;
}

export interface RecordAdjustmentNettingResult {
  netting: AdjustmentNetting;
  /**
   * `true` only when this call genuinely inserted a new row. `false` when it
   * resolved to an idempotent replay of an existing row -- either the
   * straightforward case (an identical `idempotencyKey` already existed) or
   * the concurrent-double-submit race, mirroring
   * `RecordAvailableBalanceSpendResult.created`'s exact shape (Story 4.9).
   * The route layer uses this to return 200 (replay) instead of 201
   * (genuine create).
   */
  created: boolean;
}

/**
 * Thrown by `packages/db`'s `createAdjustmentNettingPort.recordNetting` when
 * a netting already exists for the given `idempotencyKey` but doesn't match
 * the *current* request's content -- a genuine key collision between two
 * unrelated requests, not a legitimate replay. Mirrors
 * `AvailableBalanceSpendIdempotencyKeyConflictError`'s exact precedent
 * (`adjustment_nettings.idempotencyKey` is table-wide UNIQUE, like
 * `available_balance_spends.idempotencyKey`). The route layer maps this to
 * `409 idempotency_key_conflict`.
 */
export class AdjustmentNettingIdempotencyKeyConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used for a different netting request -- generate a new key for this submission.",
    );
    this.name = "AdjustmentNettingIdempotencyKeyConflictError";
  }
}

/**
 * Port for recording/reading Adjustment Netting audit records (Story 5.3,
 * FR33/FR34, AD-4/AD-5) -- implemented by `packages/db` against Postgres;
 * `packages/core` never imports a DB driver directly (AD-9). Deliberately
 * NEVER reads or writes `investment_adjustments`/`withdrawal_adjustments`
 * itself (AD-4: netting is fully independent of both ledgers' own
 * calculations -- the two ledgers are never read-to-compute-or-offset each
 * other by this port, and this port writes to neither).
 */
export interface AdjustmentNettingPort {
  /**
   * Atomicity contract (AD-5): a successful genuine (non-replay) call writes
   * exactly one `adjustment_nettings` row and exactly one paired `audit_log`
   * row (`entityType: "adjustment_netting"`, `entityId` = the new netting's
   * id, `action: "create"`, `actorUserId`, `oldValue: null`, `newValue` =
   * the full saved row, `reason: null`) inside a single DB transaction --
   * mirrors `AvailableBalanceSpendPort.recordSpend`'s exact idempotent-write
   * contract (`idempotencyKey`/`actorUserId` are separate parameters, not
   * fields on `input`, mirroring that port's identical shape), simpler here
   * since a netting record never needs to touch a second ledger table the
   * way a spend touches `available_balances`.
   *
   * Idempotency contract, mirroring `WithdrawalTransactionPort.recordTransaction`'s
   * shape (`adjustment_nettings.idempotencyKey` is table-wide UNIQUE): if a
   * row for `idempotencyKey` already exists and its content matches `input`
   * (via `moneyEquals`/`?? null`-safe comparison), that existing row is
   * returned unchanged (`created: false`). A genuine content mismatch throws
   * `AdjustmentNettingIdempotencyKeyConflictError`. Covers both the
   * straightforward replay case (checked first, before attempting an
   * insert) and the concurrent-double-submit race, where two calls both
   * miss that first check and both attempt to insert: the loser's insert
   * fails against the `idempotencyKey` UNIQUE constraint, and the
   * implementation recovers by re-reading and returning the winner's row
   * instead of propagating the error.
   */
  recordNetting(
    input: RecordAdjustmentNettingInput,
    idempotencyKey: string,
    actorUserId: string,
  ): Promise<RecordAdjustmentNettingResult>;
  /**
   * Every `adjustment_nettings` row across every Project, unfiltered, no
   * pagination (Story 5.3) -- mirrors every other financial-write port's
   * `listAll()` shape. `assembleMoneyHistory()`'s new
   * `buildAdjustmentNettingEntries` branch is the sole consumer.
   */
  listAll(): Promise<AdjustmentNetting[]>;
}

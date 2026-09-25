import type {
  AvailableBalance,
  AvailableBalanceSpend,
  InvestmentTransaction,
  Money,
  MoneyMovement,
} from "@niveshbook/types";
import type { DestinationSnapshotInput } from "./withdrawal-destination-allocation-port";

/**
 * Shared shape for both `creditBalance`/`debitBalance` (Story 4.9, FR29) --
 * `amount` is always a positive delta; direction is which method is called,
 * never a signed value.
 */
export interface CreditOrDebitAvailableBalanceInput {
  /** The *source* Project this balance is scoped to (this story's Decisions #1) -- never the spend's destination Project for a debit. */
  projectId: string;
  partyType: "partner" | "sub_partner";
  shareId: string;
  amount: Money;
}

/**
 * Port for reading/writing the Available Balance ledger (Story 4.9, FR29,
 * AD-10) -- implemented by `packages/db` against Postgres; `packages/core`
 * never imports a DB driver directly (AD-9).
 */
export interface AvailableBalancePort {
  /**
   * Atomic upsert: `balance = balance + amount` (this story's Decisions #7)
   * -- no explicit row lock needed, since Postgres's `ON CONFLICT ... DO
   * UPDATE` is itself atomic against concurrent writers. Called exactly once
   * per `"available_balance"` destination-allocation leg, only from
   * `createWithdrawalDestinationAllocationPort.recordAllocation`'s own
   * genuine (non-replay) write path -- that path is reached at most once per
   * leg, even under a concurrent double-submit race, because that port's own
   * `SELECT ... FOR UPDATE` lock on the parent `withdrawal_transactions` row
   * fully serializes every concurrent allocation attempt for the same
   * withdrawal before any of this ever runs. Returns the row's new state
   * (post-credit).
   */
  creditBalance(input: CreditOrDebitAvailableBalanceInput): Promise<AvailableBalance>;
  /**
   * `SELECT ... FOR UPDATE` on the matching `(partyType, shareId, projectId)`
   * row (AD-10) -- a missing row is treated as a `"0"` balance (so a debit
   * against a never-credited balance throws `InsufficientAvailableBalanceError`
   * unless `input.amount` is itself `"0"`) -- then `assertSufficientBalance`,
   * then `balance = balance - amount`, all inside one DB transaction: either
   * the caller's own already-open transaction (participates in it, AD-6), or
   * a fresh one this call opens itself when used standalone. Throws
   * `InsufficientAvailableBalanceError` (propagated from
   * `assertSufficientBalance`) without writing anything if the balance is
   * insufficient -- the row-lock is held for the whole check-then-write
   * sequence, so two concurrent debits against the same balance are fully
   * serialized (AD-10, AC4): the second one to acquire the lock sees the
   * first's already-applied debit, never a stale pre-debit balance. Returns
   * the row's new state (post-debit).
   */
  debitBalance(input: CreditOrDebitAvailableBalanceInput): Promise<AvailableBalance>;
  /** Every `available_balances` row for one Project, in no particular guaranteed order -- `[]` if none exist yet. The route layer joins this against every *current* Partner/Sub-partner Share, defaulting a share with no row to `"0"` (this story's Code Map). */
  listBalancesByProjectId(projectId: string): Promise<AvailableBalance[]>;
}

/**
 * Already-validated input for one "Use Balance" spend (Story 4.9, FR29) --
 * built by the route layer (there is no dedicated `packages/core` validation
 * module for this one, unlike `withdrawal-destination-allocation.ts`'s
 * multi-leg `recordDestinationAllocation`: a single spend has no cross-leg
 * sum invariant to check, so `toMoney`/zero-amount validation lives directly
 * at the route, mirroring that same route's existing inline-validation
 * precedent for e.g. `destinationProjectId` existence -- see this story's
 * Implementation Notes). Only the field(s) matching `destinationType` are
 * ever non-null, mirroring `CreateWithdrawalDestinationAllocationLegInput`'s
 * identical convention. `destinationSnapshotInput` is Not persisted -- pure
 * orchestration data `recordSpend` needs to call
 * `spendAvailableBalanceToProject()`, required (non-null) only for
 * `destinationType === "project"`, resolved fresh by the route immediately
 * before calling this port (never client-trusted, mirrors Story 4.8's
 * identical rule).
 */
export interface RecordAvailableBalanceSpendInput {
  /** The *source* Project + `(partyType, shareId)` identifying which `available_balances` row this spend debits. */
  sourceProjectId: string;
  partyType: "partner" | "sub_partner";
  shareId: string;
  destinationType: "project" | "person";
  amount: Money;
  notes: string | null;
  destinationProjectId: string | null;
  destinationRequirementId: string | null;
  destinationShareId: string | null;
  destinationPartyType: "partner" | "sub_partner" | null;
  destinationSnapshotInput: DestinationSnapshotInput | null;
  personName: string | null;
}

export interface RecordAvailableBalanceSpendResult {
  spend: AvailableBalanceSpend;
  /** Non-null only for a `"project"` spend (the auto-created destination investment record). */
  investmentTransaction: InvestmentTransaction | null;
  /** Non-null only for a `"project"` spend (the linking movement record). */
  moneyMovement: MoneyMovement | null;
  /**
   * `true` only when this call genuinely debited the balance and inserted a
   * new spend row. `false` when it resolved to an idempotent replay of an
   * existing spend -- either the straightforward case (a row for this exact
   * `idempotencyKey` already existed before this call started) or the
   * concurrent-double-submit race, mirroring
   * `RecordWithdrawalTransactionResult.created`'s exact shape. The route
   * layer uses this to return 200 (replay) instead of 201 (genuine create).
   */
  created: boolean;
}

/**
 * Port for recording an Available Balance spend (Story 4.9, FR29, AD-5/
 * AD-6/AD-10) -- implemented by `packages/db` against Postgres;
 * `packages/core` never imports a DB driver directly (AD-9).
 */
export interface AvailableBalanceSpendPort {
  /**
   * Atomicity contract (AD-5): a successful genuine (non-replay) call, all
   * inside one DB transaction -- debits the matching `available_balances`
   * row (via `AvailableBalancePort.debitBalance`, transaction-bound, AD-10's
   * `SELECT ... FOR UPDATE` + `assertSufficientBalance` guard; throws
   * `InsufficientAvailableBalanceError` and writes nothing if the balance is
   * insufficient), inserts exactly one `available_balance_spends` row, for
   * `destinationType === "project"` also calls
   * `spendAvailableBalanceToProject()` (transaction-bound
   * `InvestmentTransactionPort`/`MoneyMovementPort` implementations) to
   * auto-create the linked `investment_transactions`/`money_movements` rows,
   * and writes exactly one paired `audit_log` row (`entityType:
   * "available_balance_spend"`, `entityId` = the new spend's id, `action:
   * "create"`, `actorUserId`, `oldValue: null`, `newValue` = the full saved
   * spend row, `reason: null`).
   *
   * Idempotency contract, mirroring `WithdrawalTransactionPort.recordTransaction`'s
   * shape one ledger over (`available_balance_spends.idempotencyKey` is
   * table-wide UNIQUE, unlike `withdrawal_destination_allocations`'
   * deliberately-non-unique column): if a row for `idempotencyKey` already
   * exists and its content matches `input` (via `moneyEquals`/`?? null`-safe
   * comparison), that existing row (plus its already-linked
   * `investmentTransaction`/`moneyMovement`, if any -- never re-created) is
   * returned unchanged (`created: false`). A genuine content mismatch throws
   * `AvailableBalanceSpendIdempotencyKeyConflictError`. Covers both the
   * straightforward replay case (checked first, before attempting a debit)
   * and the concurrent-double-submit race, where two calls both miss that
   * first check and both attempt to insert: the loser's insert fails against
   * the `idempotencyKey` UNIQUE constraint (its own transaction, including
   * its debit, rolled back), and the implementation recovers by re-reading
   * and returning the winner's row instead of propagating the error.
   *
   * A `ShareNotFoundError`/`SharesNotFullyAllocatedError`/
   * `SubPartnerSharesOverAllocatedError` thrown by
   * `spendAvailableBalanceToProject()` propagates unchanged, rolling back
   * the entire transaction (including the debit) -- no partial spend, no
   * orphaned debit with nothing to show for it.
   */
  recordSpend(
    input: RecordAvailableBalanceSpendInput,
    idempotencyKey: string,
    actorUserId: string,
  ): Promise<RecordAvailableBalanceSpendResult>;
}

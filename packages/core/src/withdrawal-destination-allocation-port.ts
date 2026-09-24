import type { DestinationType, Money, WithdrawalDestinationAllocation } from "@niveshbook/types";

/**
 * One destination leg's *validated* content, ready to write -- built by
 * `withdrawal-destination-allocation.ts`'s `recordDestinationAllocation`
 * from the route's raw request legs, never constructed directly by a route
 * (mirrors `CreateWithdrawalTransactionInput`'s "already-validated input"
 * contract). `destinationProjectId`/`personName` are non-null only when
 * `destinationType` is `"project"`/`"person"` respectively (the domain
 * layer's job to enforce, not this port's) -- `notes` is independent of
 * `destinationType` (this story's Decisions: usable on any leg).
 */
export interface CreateWithdrawalDestinationAllocationLegInput {
  destinationType: DestinationType;
  amount: Money;
  destinationProjectId: string | null;
  personName: string | null;
  notes: string | null;
}

export interface RecordWithdrawalDestinationAllocationResult {
  allocations: WithdrawalDestinationAllocation[];
  /**
   * `true` only when this call genuinely inserted new rows. `false` when it
   * resolved to an idempotent replay of an existing save -- either the
   * straightforward case (a set of rows for this exact `idempotencyKey`
   * already existed before this call started) or the concurrent-double-
   * submit race, mirroring `RecordWithdrawalTransactionResult.created`'s
   * exact shape one story over. The route layer uses this to return 200
   * (replay) instead of 201 (genuine create).
   */
  created: boolean;
}

/**
 * Port for reading/writing Withdrawal Destination Allocation rows (Story
 * 4.7, FR27) -- implemented by `packages/db` against Postgres;
 * `packages/core` never imports a DB driver directly (AD-9).
 */
export interface WithdrawalDestinationAllocationPort {
  /**
   * Atomicity contract (AD-5/AD-6): a successful genuine (non-replay) call
   * writes every leg in `legs` plus exactly one paired `audit_log` row
   * (`entityType: "withdrawal_destination_allocation"`, `entityId` =
   * `withdrawalTransactionId`, `action: "create"`, `actorUserId`, `oldValue:
   * null`, `newValue` = the full array of saved leg rows, `reason: null`)
   * inside a single DB transaction -- never a partial set of legs left
   * behind.
   *
   * Write-once contract (this story's Decisions): if `withdrawalTransactionId`
   * already has allocation rows from a *different* `idempotencyKey`, this
   * throws `AlreadyAllocatedError` rather than writing anything -- an
   * already-allocated withdrawal is never re-split. If it already has rows
   * for THIS SAME `idempotencyKey`, that's a legitimate replay (see below),
   * not a conflict.
   *
   * Idempotency contract, mirroring `WithdrawalTransactionPort.recordTransaction`'s
   * shape one story over: if a set of rows for `idempotencyKey` already
   * exists (for this `withdrawalTransactionId`) and its content matches
   * `legs` (via a decimal-safe `matchesAllocationRequest` comparison), those
   * existing rows are returned unchanged (`created: false`) -- no new rows,
   * no new `audit_log` row. A genuine content mismatch under the same key
   * throws `WithdrawalDestinationAllocationIdempotencyKeyConflictError`
   * instead of silently replaying unrelated data. Implemented with a
   * `SELECT ... FOR UPDATE` lock on the parent `withdrawal_transactions` row
   * (there is no natural single "header" row of this table itself to lock,
   * since one save legitimately inserts several sibling leg rows) so two
   * concurrent calls for the same withdrawal -- same key or different --
   * are fully serialized rather than racing.
   */
  recordAllocation(
    withdrawalTransactionId: string,
    legs: readonly CreateWithdrawalDestinationAllocationLegInput[],
    idempotencyKey: string,
    actorUserId: string,
  ): Promise<RecordWithdrawalDestinationAllocationResult>;
  /** Every destination leg recorded for one withdrawal, chronological (`createdAt` ascending) -- `[]` if none have been saved yet. */
  listByWithdrawalTransactionId(withdrawalTransactionId: string): Promise<WithdrawalDestinationAllocation[]>;
  /**
   * `true` if `withdrawalTransactionId` already has allocation rows saved
   * under a *different* `idempotencyKey` than `idempotencyKey` -- i.e. a
   * genuine write-once conflict, not this exact request replayed. `false`
   * both when nothing has been saved yet and when the only existing rows
   * share this exact `idempotencyKey` (a legitimate replay).
   *
   * A fast, non-atomic pre-check `recordDestinationAllocation` (this
   * function's own caller) runs *before* its exact-sum/`toMoney` validation,
   * so an already-allocated withdrawal's 409 takes priority over a
   * simultaneously-invalid request body's 400 -- the more fundamental
   * problem surfaces first, rather than being masked. `recordAllocation`
   * itself remains the sole atomic, race-safe source of truth for write-once
   * enforcement (its own `SELECT ... FOR UPDATE`-guarded transaction); this
   * method exists purely to improve error-priority ordering for the
   * overwhelmingly common non-racing case, not to replace that guarantee.
   */
  hasConflictingAllocation(withdrawalTransactionId: string, idempotencyKey: string): Promise<boolean>;
}

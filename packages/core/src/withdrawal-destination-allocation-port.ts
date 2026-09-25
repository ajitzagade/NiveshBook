import type {
  DestinationType,
  InvestmentRequirement,
  Money,
  MoneyMovement,
  PartnerShare,
  SubPartnerShare,
  WithdrawalDestinationAllocation,
} from "@niveshbook/types";

/**
 * Story 4.8 (FR28): the pre-fetched, already-validated destination Project
 * data a `"project"` leg's `moveWithdrawalToProject()` call needs to build
 * its investment snapshot -- fetched fresh by the route layer (never
 * client-trusted) immediately before `recordDestinationAllocation` is
 * called, mirroring `destinationProjectId`'s own existence-check precedent
 * (Story 4.7). Carried on `CreateWithdrawalDestinationAllocationLegInput`
 * below only for a `"project"` leg; `null` for every other `destinationType`.
 */
export interface DestinationSnapshotInput {
  requirement: InvestmentRequirement;
  partnerShares: readonly PartnerShare[];
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>;
}

/**
 * One destination leg's *validated* content, ready to write -- built by
 * `withdrawal-destination-allocation.ts`'s `recordDestinationAllocation`
 * from the route's raw request legs, never constructed directly by a route
 * (mirrors `CreateWithdrawalTransactionInput`'s "already-validated input"
 * contract). `destinationProjectId`/`personName` are non-null only when
 * `destinationType` is `"project"`/`"person"` respectively (the domain
 * layer's job to enforce, not this port's) -- `notes` is independent of
 * `destinationType` (this story's Decisions: usable on any leg).
 *
 * Story 4.8 adds `destinationRequirementId`/`destinationShareId`/
 * `destinationPartyType` (persisted columns, populated only for a
 * `"project"` leg) plus `destinationSnapshotInput` (NOT persisted -- pure
 * orchestration data `createWithdrawalDestinationAllocationPort.recordAllocation`
 * needs to call `moveWithdrawalToProject()` for this leg, `null` for every
 * other leg).
 */
export interface CreateWithdrawalDestinationAllocationLegInput {
  destinationType: DestinationType;
  amount: Money;
  destinationProjectId: string | null;
  personName: string | null;
  notes: string | null;
  destinationRequirementId: string | null;
  destinationShareId: string | null;
  destinationPartyType: "partner" | "sub_partner" | null;
  destinationSnapshotInput: DestinationSnapshotInput | null;
}

export interface RecordWithdrawalDestinationAllocationResult {
  allocations: WithdrawalDestinationAllocation[];
  /**
   * Story 4.8: one entry per `"project"` leg in this allocation (in the same
   * order they resolve, not necessarily `legs`' own order) -- `[]` when the
   * batch had no `"project"` legs. On a legitimate idempotent replay, these
   * are the *original* movements (never re-created), mirroring `allocations`'
   * own replay behavior.
   */
  moneyMovements: MoneyMovement[];
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
   *
   * Story 4.8 (FR28, AD-6) extension: for every `"project"` leg genuinely
   * written this call, also calls `moveWithdrawalToProject()` (with
   * transaction-bound `InvestmentTransactionPort`/`MoneyMovementPort`
   * implementations constructed inside this same `database.transaction()`)
   * to create the destination `investment_transactions` row and its linking
   * `money_movements` row -- all inside the identical atomic write, so the
   * whole batch (every leg row, plus every `"project"` leg's linked
   * investment/movement rows) commits or rolls back together (AC3). A
   * `ShareNotFoundError`/`SharesNotFullyAllocatedError`/
   * `SubPartnerSharesOverAllocatedError` thrown by that call propagates
   * unchanged, rolling back the entire transaction -- no partial allocation
   * rows, no partial investment/movement rows either. On the legitimate
   * replay path above, the already-linked `money_movements` rows are read
   * back (never re-created) and returned alongside the replayed allocations.
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
  /** The destination-allocation leg with this id, or `null` if it doesn't exist (Story 4.10, FR30) -- mirrors `InvestmentTransactionPort.findById`'s identical shape. */
  findById(id: string): Promise<WithdrawalDestinationAllocation | null>;
  /**
   * Every destination-allocation leg across every withdrawal, unfiltered, no
   * pagination (Story 5.1, FR31) -- mirrors `InvestmentTransactionPort.listAll()`'s
   * identical shape. Money History's `assembleMoneyHistory()` is the sole
   * consumer -- one entry per leg, per this story's I/O matrix (`"project"`
   * -> `"moved_to_project"`, `"person"`/`"other"` -> `"given_to_person"`,
   * `"available_balance"` -> `"added_to_available_balance"`).
   */
  listAll(): Promise<WithdrawalDestinationAllocation[]>;
}

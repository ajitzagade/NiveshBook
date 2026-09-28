import type { Money, WithdrawalReallocation, WithdrawalReallocationAllocation } from "@niveshbook/types";
import type { WithdrawalReallocationAllocationSplit } from "./withdrawal-reallocation";

export interface RecordWithdrawalReallocationInput {
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` of the party declining this amount -- never `User.id` (AD-4). */
  shareId: string;
  declinedAmount: Money;
  notes: string | null;
  /**
   * The declining share's live base Can Take (Story 4.1's `computeCanTake`
   * figure) -- a pure, DB-independent value the route already computed from
   * currently-fetched Partner/Sub-partner Shares. Carried into the port so
   * `record` can re-derive the *effective* ceiling from a fresh, lock-
   * guarded read of active reallocations immediately before inserting,
   * rather than trusting the route's own pre-check alone, which is taken
   * against a snapshot fetched before any lock is held (see `record`'s own
   * doc comment on the concurrent-decline race this closes).
   */
  baseCanTake: Money;
}

export interface RecordWithdrawalReallocationResult {
  reallocation: WithdrawalReallocation;
  allocations: WithdrawalReallocationAllocation[];
  /**
   * `true` only when this call genuinely inserted new rows. `false` when it
   * resolved to an idempotent replay of an existing decline -- mirrors
   * `RecordAdjustmentNettingResult.created`'s exact shape.
   */
  created: boolean;
}

/**
 * Thrown by `packages/db`'s `createWithdrawalReallocationPort.record` when a
 * reallocation already exists for the given `idempotencyKey` but doesn't
 * match the *current* request's content -- a genuine key collision between
 * two unrelated requests, not a legitimate replay. Mirrors
 * `AdjustmentNettingIdempotencyKeyConflictError`'s exact precedent
 * (`withdrawal_reallocations.idempotencyKey` is table-wide UNIQUE). The
 * route layer maps this to `409 idempotency_key_conflict`.
 */
export class WithdrawalReallocationIdempotencyKeyConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used for a different reallocation request -- generate a new key for this submission.",
    );
    this.name = "WithdrawalReallocationIdempotencyKeyConflictError";
  }
}

/**
 * Thrown by `record` when, re-checked against a fresh, lock-guarded read of
 * this share's active reallocations immediately before inserting,
 * `declinedAmount` no longer fits within their effective Can Take -- closes
 * the race where two concurrent declines for the *same* share (different
 * idempotency keys) both pass the route's own pre-check (taken against a
 * snapshot fetched before either request holds any lock) and would
 * otherwise jointly decline more than that share ever actually had
 * available. The route layer maps this to the same `400 validation_error`
 * its own pre-check already uses, so a client sees identical behavior
 * whether the rejection happens early (the common case) or late (this race).
 */
export class WithdrawalReallocationExceedsAvailableError extends Error {
  constructor() {
    super("Cannot decline more than this Partner/Sub-partner's own currently-available Can Take.");
    this.name = "WithdrawalReallocationExceedsAvailableError";
  }
}

/** Thrown when `cancel` is called with an id that doesn't match any reallocation. The route layer maps this to `404 not_found`. */
export class WithdrawalReallocationNotFoundError extends Error {
  constructor() {
    super("This reallocation doesn't exist.");
    this.name = "WithdrawalReallocationNotFoundError";
  }
}

/** Thrown when `cancel` is called on a reallocation that is already cancelled. The route layer maps this to `409 already_cancelled`. */
export class WithdrawalReallocationAlreadyCancelledError extends Error {
  constructor() {
    super("This reallocation has already been cancelled.");
    this.name = "WithdrawalReallocationAlreadyCancelledError";
  }
}

/**
 * Thrown when `cancel` is called on a reallocation where at least one
 * allocation leg has already been (even partially) consumed -- undoing it
 * would silently claw back money a recipient has already effectively been
 * allowed to withdraw against. The route layer maps this to `409
 * already_consumed`.
 */
export class WithdrawalReallocationAlreadyConsumedError extends Error {
  constructor() {
    super("Cannot cancel a reallocation once any part of it has been consumed.");
    this.name = "WithdrawalReallocationAlreadyConsumedError";
  }
}

/**
 * Port for reading/writing the withdrawal-reallocation ("declined share")
 * ledger -- implemented by `packages/db` against Postgres; `packages/core`
 * never imports a DB driver directly (AD-9).
 */
export interface WithdrawalReallocationPort {
  /**
   * Atomicity contract (AD-5/AD-6): a successful genuine (non-replay) call
   * writes exactly one `withdrawal_reallocations` row, every leg in
   * `allocationLegs` (`packages/core`'s `computeWithdrawalReallocationSplit`'s
   * own output -- already validated, never re-derived here), and exactly one
   * paired `audit_log` row (`entityType: "withdrawal_reallocation"`,
   * `entityId` = the new reallocation's id, `action: "create"`,
   * `actorUserId`, `oldValue: null`, `newValue` = the reallocation row plus
   * its legs, `reason: null`) inside a single DB transaction.
   *
   * Concurrency contract: before inserting, takes a transaction-scoped
   * Postgres advisory lock keyed on `(projectId, partyType, shareId)` (not a
   * row lock -- no `withdrawal_reallocations` row necessarily exists yet for
   * this share, so there is nothing to `SELECT ... FOR UPDATE` against), so
   * two concurrent `record` calls for the *same* declining share fully
   * serialize rather than racing. Once the lock is held, re-reads this
   * share's active reallocations/allocations fresh and re-derives their
   * effective Can Take (`packages/core`'s `computeEffectiveCanTake`,
   * `input.baseCanTake` supplied by the caller) -- if `input.declinedAmount`
   * no longer fits, throws `WithdrawalReallocationExceedsAvailableError`
   * instead of inserting, rolling back the whole attempt.
   *
   * Idempotency contract, mirroring `AdjustmentNettingPort.recordNetting`'s
   * shape (`withdrawal_reallocations.idempotencyKey` is table-wide UNIQUE):
   * a replay with matching content returns the existing rows unchanged
   * (`created: false`); a genuine content mismatch under the same key throws
   * `WithdrawalReallocationIdempotencyKeyConflictError`. The idempotency
   * check runs first, outside the lock -- a genuine replay never needs to
   * re-validate the ceiling, since it changed nothing the first time either.
   */
  record(
    input: RecordWithdrawalReallocationInput,
    allocationLegs: readonly WithdrawalReallocationAllocationSplit[],
    idempotencyKey: string,
    actorUserId: string,
  ): Promise<RecordWithdrawalReallocationResult>;

  /** Every `status: "active"` reallocation for a Project -- the set `computeEffectiveCanTake`'s `activeReallocations` argument expects. */
  listActiveByProjectId(projectId: string): Promise<WithdrawalReallocation[]>;

  /** The reallocation with this id, or `null` if it doesn't exist -- mirrors `WithdrawalTransactionPort.findById`'s identical shape, used by the cancel route to confirm existence and same-Project membership before calling `cancel`. */
  findById(id: string): Promise<WithdrawalReallocation | null>;

  /** Every allocation leg belonging to any `status: "active"` reallocation for a Project, across every recipient -- the set `computeEffectiveCanTake`'s `activeAllocations` argument expects, fetched once per Project rather than once per Partner/Sub-partner. */
  listActiveAllocationsByProjectId(projectId: string): Promise<WithdrawalReallocationAllocation[]>;

  /** Every allocation leg belonging to one reallocation, chronological (`createdAt` ascending) -- `[]` if the reallocation has none (shouldn't happen for an active one, but a defensive empty read rather than throwing). */
  listAllocationsByReallocationId(reallocationId: string): Promise<WithdrawalReallocationAllocation[]>;

  /**
   * Marks one reallocation `status: "cancelled"` -- `WithdrawalReallocationNotFoundError`
   * if `reallocationId` doesn't exist, `WithdrawalReallocationAlreadyCancelledError`
   * if it's already cancelled, `WithdrawalReallocationAlreadyConsumedError`
   * if any of its legs' `consumedAmount` is non-zero. Writes one paired
   * `audit_log` row (`action: "cancel"`). Checked and written inside a
   * single `SELECT ... FOR UPDATE`-guarded transaction, so a concurrent
   * consumption of a leg (via `consumeAllocationLegs` below) and a cancel
   * request can't race past each other.
   */
  cancel(reallocationId: string, actorUserId: string): Promise<WithdrawalReallocation>;

  /**
   * Atomically updates a set of allocation legs' `consumedAmount` (the
   * write half of `packages/core`'s `planReallocationBonusConsumption`
   * plan) -- called from inside the SAME `database.transaction()` as the
   * withdrawal-transaction insert that drew on them (this codebase's
   * withdrawal-reallocation feature doc, "atomic FIFO consumption"), never
   * on its own. Takes an already-open transaction-bound instance of this
   * port (`createWithdrawalReallocationPort(tx)`) -- there is no separate
   * "open a transaction" variant, mirroring `MoneyMovementPort.record`'s
   * identical "accepts and participates in a caller-supplied transaction"
   * contract.
   */
  consumeAllocationLegs(updates: readonly { id: string; newConsumedAmount: Money }[]): Promise<void>;

  /** Every reallocation across every Project, unfiltered, no pagination -- mirrors every other financial-write port's `listAll()` shape. */
  listAll(): Promise<WithdrawalReallocation[]>;

  /** Every allocation leg across every reallocation, unfiltered, no pagination -- mirrors `listAll()`'s identical shape one level down. */
  listAllAllocations(): Promise<WithdrawalReallocationAllocation[]>;
}

import type { DestinationType, WithdrawalTransaction } from "@niveshbook/types";
import { toMoney, sumMoney, moneyEquals, isZeroMoney } from "./decimal-math";
import type {
  CreateWithdrawalDestinationAllocationLegInput,
  DestinationSnapshotInput,
  RecordWithdrawalDestinationAllocationResult,
  WithdrawalDestinationAllocationPort,
} from "./withdrawal-destination-allocation-port";

export interface WithdrawalDestinationAllocationDeps {
  withdrawalDestinationAllocations: WithdrawalDestinationAllocationPort;
}

/**
 * One destination leg exactly as submitted by the caller -- `amount` is a
 * raw, unvalidated string (validated here via `toMoney`, mirroring
 * `RecordWithdrawalTransactionInput.amount`'s identical raw-string
 * contract); `destinationType` itself is already narrowed to `DestinationType`
 * by the route's own request-body shape guard (`shared.ts`), since an
 * unrecognized value there is a malformed-request concern (400
 * `invalid_request`), not this module's business-rule validation.
 * `destinationProjectId`/`personName`/`notes` are the raw, caller-supplied
 * values for whichever fields apply to this leg's `destinationType` -- this
 * module (not the route) is what actually clears the fields that don't
 * apply (e.g. a `"person"` leg's `destinationProjectId` is dropped even if
 * the caller sent one), mirroring `WithdrawalDestinationAllocation`'s own
 * "only the matching field is ever non-null" contract.
 *
 * Story 4.8 (FR28) adds `destinationRequirementId`/`destinationShareId`/
 * `destinationPartyType` -- raw, caller-supplied, required only for a
 * `"project"` leg (`shared.ts`'s own shape guard already enforces
 * presence/enum-validity before this module ever sees them; this module's
 * `normalizeLeg` re-checks presence as defense in depth, mirroring
 * `InvalidDestinationProjectError`'s identical belt-and-suspenders
 * precedent). `destinationSnapshot` is NOT caller-supplied -- it is the
 * destination Project's *current* funding requirement/Partner/Sub-partner
 * Shares, fetched fresh by the route layer immediately before this module is
 * called (never client-trusted, mirroring `destinationProjectId`'s own
 * existence-check precedent) -- required (non-null) for a `"project"` leg,
 * `null` for every other `destinationType`.
 */
export interface RawDestinationAllocationLeg {
  destinationType: DestinationType;
  amount: string;
  destinationProjectId: string | null;
  personName: string | null;
  notes: string | null;
  destinationRequirementId: string | null;
  destinationShareId: string | null;
  destinationPartyType: "partner" | "sub_partner" | null;
  destinationSnapshot: DestinationSnapshotInput | null;
}

/**
 * Thrown when `legs`' amounts don't sum to *exactly* `withdrawal.amount`
 * (this story's Boundaries: checked via `moneyEquals`, not `compareMoney` --
 * both under and over the withdrawn total are rejected identically). The
 * route layer maps this to 400 `allocation_mismatch`.
 */
export class AllocationMismatchError extends Error {
  constructor() {
    super("Allocated amounts must sum to exactly the withdrawal's amount.");
    this.name = "AllocationMismatchError";
  }
}

/**
 * Thrown when a `"project"` leg's `destinationProjectId` equals the
 * withdrawal's own source Project -- "another Project" (this story's
 * Decisions: moving money to the Project it came from isn't a destination).
 * The route layer separately confirms `destinationProjectId` actually
 * exists (it has the `ProjectPort` this domain-layer module deliberately
 * doesn't depend on) before this function is ever called -- this error
 * covers only the self-Project case. The route layer maps this to 400
 * `validation_error`.
 */
export class InvalidDestinationProjectError extends Error {
  constructor() {
    super("A \"project\" destination must be a different Project than the one the withdrawal came from.");
    this.name = "InvalidDestinationProjectError";
  }
}

/**
 * Thrown when a `"project"` leg is missing `destinationRequirementId`/
 * `destinationShareId`/`destinationPartyType`, or the route layer's
 * pre-fetched `destinationSnapshot` (Story 4.8, FR28) -- defense in depth
 * only, mirroring `InvalidDestinationProjectError`'s identical role: in
 * normal operation `shared.ts`'s own request-body shape guard already
 * requires all three raw fields for a `"project"` leg (400
 * `invalid_request`), and the route always resolves `destinationSnapshot`
 * (or returns 404) before ever calling this module. The route layer maps
 * this to 400 `validation_error`.
 */
export class MissingDestinationRequirementError extends Error {
  constructor() {
    super(
      'A "project" destination leg requires destinationRequirementId, destinationShareId, and destinationPartyType, all resolved against the destination Project\'s current data.',
    );
    this.name = "MissingDestinationRequirementError";
  }
}

/**
 * Thrown when a `"project"` leg's `amount` is exactly zero (review finding,
 * Story 4.8: `toMoney` itself only rejects a *negative* amount, not a zero
 * one -- every other leg type tolerates `"0"` as a legitimate "nothing went
 * here" entry, but a `"project"` leg is no longer metadata-only as of this
 * story: it writes a REAL, permanent `investment_transactions` row plus a
 * `money_movements` row at the destination Project. A zero-amount one would
 * create a phantom investment record with nothing backing it -- checked via
 * `isZeroMoney` (AD-2's decimal-safe helper), never a raw `=== "0"`/numeric
 * comparison. The route layer maps this to 400 `validation_error`.
 */
export class ZeroAmountProjectLegError extends Error {
  constructor() {
    super('A "project" destination leg\'s amount must be greater than zero -- it creates a real, permanent investment record at the destination Project.');
    this.name = "ZeroAmountProjectLegError";
  }
}

/**
 * Thrown by `packages/db`'s `createWithdrawalDestinationAllocationPort` when
 * a withdrawal that already has allocation rows (from a *different*
 * `idempotencyKey`) receives a second allocation attempt (this story's
 * Decisions: write-once, no edit/re-split -- Story 4.11's cancel/reverse of
 * the whole withdrawal is the only undo path). The route layer maps this to
 * 409 `already_allocated`.
 */
export class AlreadyAllocatedError extends Error {
  constructor() {
    super("This withdrawal has already been allocated -- allocation is write-once, not editable.");
    this.name = "AlreadyAllocatedError";
  }
}

/**
 * Thrown by `packages/db`'s `createWithdrawalDestinationAllocationPort` when
 * a row set already exists for the given `idempotencyKey` but doesn't match
 * the *current* request's legs -- a genuine key collision between two
 * unrelated requests, not a legitimate replay. Mirrors
 * `WithdrawalIdempotencyKeyConflictError`'s exact precedent one story over,
 * as its own local class (that module is already `done`, Open/Closed) --
 * named distinctly so `packages/core/src/index.ts`'s barrel export never
 * collides. The route layer maps this to 409 `idempotency_key_conflict`.
 */
export class WithdrawalDestinationAllocationIdempotencyKeyConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used for a different destination-allocation request -- generate a new key for this submission.",
    );
    this.name = "WithdrawalDestinationAllocationIdempotencyKeyConflictError";
  }
}

/**
 * A blank/whitespace-only optional text field is normalized to `null`, not
 * `""` -- mirrors `withdrawal-transaction.ts`'s `normalizeOptionalText`,
 * widened to also accept `undefined` (not just `null`): `notes` is the one
 * field this module's `RawDestinationAllocationLeg` type declares
 * `string | null` on every `destinationType`, but a caller's raw JSON body
 * legitimately omits the key entirely for a leg that doesn't set it (e.g. a
 * "project"/"available_balance" leg with no notes) -- `undefined` at
 * runtime, despite the type -- so this defensively treats the two the same,
 * rather than asserting a route-layer type guard already normalized every
 * optional key to an explicit `null`.
 */
function normalizeOptionalText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validates and normalizes one raw leg into the port's write-ready input
 * shape: `amount` via `toMoney` (lets `InvalidMoneyError` propagate
 * unchanged -- the route layer maps it to the same 400 `validation_error`
 * shape it already uses for a malformed withdrawal amount, mirroring
 * `route.ts`'s existing `InvalidMoneyError` handling one story over), and
 * clears whichever of `destinationProjectId`/`personName` doesn't apply to
 * this leg's `destinationType` -- `notes` is kept regardless of type (this
 * story's Decisions: usable on any leg). Throws `InvalidDestinationProjectError`
 * for a `"project"` leg naming `sourceProjectId` itself.
 */
function normalizeLeg(
  leg: RawDestinationAllocationLeg,
  sourceProjectId: string,
): CreateWithdrawalDestinationAllocationLegInput {
  const amount = toMoney(leg.amount);

  if (leg.destinationType === "project") {
    if (leg.destinationProjectId === sourceProjectId) {
      throw new InvalidDestinationProjectError();
    }
    if (isZeroMoney(amount)) {
      throw new ZeroAmountProjectLegError();
    }
    if (!leg.destinationRequirementId || !leg.destinationShareId || !leg.destinationPartyType || !leg.destinationSnapshot) {
      throw new MissingDestinationRequirementError();
    }
    return {
      destinationType: "project",
      amount,
      destinationProjectId: leg.destinationProjectId,
      personName: null,
      notes: normalizeOptionalText(leg.notes),
      destinationRequirementId: leg.destinationRequirementId,
      destinationShareId: leg.destinationShareId,
      destinationPartyType: leg.destinationPartyType,
      destinationSnapshotInput: leg.destinationSnapshot,
    };
  }

  if (leg.destinationType === "person") {
    return {
      destinationType: "person",
      amount,
      destinationProjectId: null,
      personName: normalizeOptionalText(leg.personName),
      notes: normalizeOptionalText(leg.notes),
      destinationRequirementId: null,
      destinationShareId: null,
      destinationPartyType: null,
      destinationSnapshotInput: null,
    };
  }

  return {
    destinationType: leg.destinationType,
    amount,
    destinationProjectId: null,
    personName: null,
    notes: normalizeOptionalText(leg.notes),
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    destinationSnapshotInput: null,
  };
}

/**
 * Records a withdrawal's full "Where did this money go?" destination split
 * in one save (Story 4.7, FR27): checks the write-once precondition first
 * (`AlreadyAllocatedError` if `withdrawalTransactionId` already has rows
 * under a *different* `idempotencyKey` -- see `hasConflictingAllocation`'s
 * own doc comment for why this runs *before* content validation, not after:
 * a resubmission against an already-allocated withdrawal that also happens
 * to carry an invalid body must surface the more fundamental 409, not a
 * 400 that masks it), then normalizes/validates every leg (amount format,
 * `InvalidDestinationProjectError` for a self-Project leg), checks the legs'
 * amounts sum to *exactly* `withdrawal.amount` (`AllocationMismatchError`
 * otherwise) -- entirely before any write -- then delegates to the port,
 * whose own atomicity/write-once/idempotency contract is documented on
 * `WithdrawalDestinationAllocationPort.recordAllocation` itself (the sole
 * atomic, race-safe source of truth -- `hasConflictingAllocation` above is a
 * non-atomic pre-check only, for error-priority ordering).
 *
 * Callers must run `authorize()` for `"withdrawal_destination_allocations:create"`
 * (Owner/Admin-only, no self-access) before calling this -- it performs no
 * permission check of its own (AD-1's gate lives at the route layer), and it
 * never validates that `destinationProjectId` actually exists as a Project
 * -- callers (the route handler) must resolve and confirm that first (this
 * module has no `ProjectPort` dependency, by design -- Interface
 * Segregation: it only needs pure validation, not a full Project lookup).
 */
export async function recordDestinationAllocation(
  withdrawal: WithdrawalTransaction,
  legs: readonly RawDestinationAllocationLeg[],
  sourceProjectId: string,
  actorUserId: string,
  idempotencyKey: string,
  deps: WithdrawalDestinationAllocationDeps,
): Promise<RecordWithdrawalDestinationAllocationResult> {
  const hasConflict = await deps.withdrawalDestinationAllocations.hasConflictingAllocation(
    withdrawal.id,
    idempotencyKey,
  );
  if (hasConflict) {
    throw new AlreadyAllocatedError();
  }

  const normalizedLegs = legs.map((leg) => normalizeLeg(leg, sourceProjectId));

  const total = sumMoney(normalizedLegs.map((leg) => leg.amount));
  if (!moneyEquals(total, withdrawal.amount)) {
    throw new AllocationMismatchError();
  }

  return deps.withdrawalDestinationAllocations.recordAllocation(
    withdrawal.id,
    normalizedLegs,
    idempotencyKey,
    actorUserId,
  );
}

/**
 * Lists every destination leg recorded for one withdrawal -- a thin
 * pass-through to the port. No dedicated `authorize()` action of its own
 * yet (this story builds no read endpoint -- Story 4.10's Money Trail is the
 * planned consumer); exported so a future route/story can call it without a
 * new `packages/core` function.
 */
export async function listWithdrawalDestinationAllocations(
  withdrawalTransactionId: string,
  deps: WithdrawalDestinationAllocationDeps,
) {
  return deps.withdrawalDestinationAllocations.listByWithdrawalTransactionId(withdrawalTransactionId);
}

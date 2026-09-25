import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared by `POST .../available-balance/spend` (Story 4.9, FR29) -- the
 * request-body shape guard, mirroring
 * `withdrawal-transactions/[transactionId]/destination-allocations/shared.ts`'s
 * `isValidLeg`-style `destinationType`-conditional required-field pattern
 * one story over, narrowed to a single spend (no `legs` array -- a spend has
 * no cross-leg sum invariant to check).
 */

const PARTY_TYPES: ReadonlySet<string> = new Set(["partner", "sub_partner"]);
const DESTINATION_TYPES: ReadonlySet<string> = new Set(["project", "person"]);

export const INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with `partyType` ("partner" | "sub_partner"), a non-empty `shareId`, a `destinationType` ("project" | "person"), an `amount` string, and a non-empty `idempotencyKey`. A "project" destination also needs a non-empty `destinationProjectId`, `destinationRequirementId`, `destinationShareId`, and a `destinationPartyType` ("partner" | "sub_partner"); a "person" destination needs a non-empty `personName`. `notes` is optional either way.';

export interface ValidAvailableBalanceSpendBody {
  partyType: "partner" | "sub_partner";
  shareId: string;
  destinationType: "project" | "person";
  amount: string;
  notes: string | null;
  destinationProjectId: string | null;
  destinationRequirementId: string | null;
  destinationShareId: string | null;
  destinationPartyType: "partner" | "sub_partner" | null;
  personName: string | null;
  idempotencyKey: string;
}

export function isValidAvailableBalanceSpendBody(body: unknown): body is ValidAvailableBalanceSpendBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as {
    partyType?: unknown;
    shareId?: unknown;
    destinationType?: unknown;
    amount?: unknown;
    notes?: unknown;
    destinationProjectId?: unknown;
    destinationRequirementId?: unknown;
    destinationShareId?: unknown;
    destinationPartyType?: unknown;
    personName?: unknown;
    idempotencyKey?: unknown;
  };

  if (typeof candidate.partyType !== "string" || !PARTY_TYPES.has(candidate.partyType)) {
    return false;
  }
  if (typeof candidate.shareId !== "string" || candidate.shareId.trim().length === 0) {
    return false;
  }
  if (typeof candidate.destinationType !== "string" || !DESTINATION_TYPES.has(candidate.destinationType)) {
    return false;
  }
  if (typeof candidate.amount !== "string") {
    return false;
  }
  if (candidate.notes !== undefined && candidate.notes !== null && typeof candidate.notes !== "string") {
    return false;
  }
  if (
    candidate.destinationProjectId !== undefined &&
    candidate.destinationProjectId !== null &&
    typeof candidate.destinationProjectId !== "string"
  ) {
    return false;
  }
  if (
    candidate.destinationRequirementId !== undefined &&
    candidate.destinationRequirementId !== null &&
    typeof candidate.destinationRequirementId !== "string"
  ) {
    return false;
  }
  if (
    candidate.destinationShareId !== undefined &&
    candidate.destinationShareId !== null &&
    typeof candidate.destinationShareId !== "string"
  ) {
    return false;
  }
  if (
    candidate.destinationPartyType !== undefined &&
    candidate.destinationPartyType !== null &&
    (typeof candidate.destinationPartyType !== "string" || !PARTY_TYPES.has(candidate.destinationPartyType))
  ) {
    return false;
  }
  if (
    candidate.personName !== undefined &&
    candidate.personName !== null &&
    typeof candidate.personName !== "string"
  ) {
    return false;
  }
  if (typeof candidate.idempotencyKey !== "string" || candidate.idempotencyKey.trim().length === 0) {
    return false;
  }

  if (candidate.destinationType === "project") {
    if (typeof candidate.destinationProjectId !== "string" || candidate.destinationProjectId.trim().length === 0) {
      return false;
    }
    if (
      typeof candidate.destinationRequirementId !== "string" ||
      candidate.destinationRequirementId.trim().length === 0
    ) {
      return false;
    }
    if (typeof candidate.destinationShareId !== "string" || candidate.destinationShareId.trim().length === 0) {
      return false;
    }
    if (
      typeof candidate.destinationPartyType !== "string" ||
      !PARTY_TYPES.has(candidate.destinationPartyType)
    ) {
      return false;
    }
  }
  if (candidate.destinationType === "person") {
    if (typeof candidate.personName !== "string" || candidate.personName.trim().length === 0) {
      return false;
    }
  }

  return true;
}

export const ZERO_OR_NEGATIVE_AMOUNT_MESSAGE = "An Available Balance spend's amount must be greater than zero.";

export const DESTINATION_PROJECT_NOT_FOUND_MESSAGE =
  'A "project" destination\'s `destinationProjectId` must be an existing Project.';

export const DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE =
  'A "project" destination\'s `destinationRequirementId` must be an existing funding requirement at the destination Project, and `destinationShareId` must be a current Partner/Sub-partner Share there.';

/** `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for this resource. */
export function isValidId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

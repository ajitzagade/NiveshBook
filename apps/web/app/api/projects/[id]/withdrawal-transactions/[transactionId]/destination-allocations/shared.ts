import { NextResponse } from "next/server";
import type { DestinationType } from "@niveshbook/types";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared by `POST .../withdrawal-transactions/[transactionId]/destination-allocations`
 * (Story 4.7, FR27) -- the request-body shape guard and this endpoint's own
 * not-found response, mirroring
 * `investment-requirements/[requirementId]/transactions/shared.ts`'s
 * `isValidCancelTransactionBody`/`transactionNotFoundResponse` pattern one
 * story over.
 */

const DESTINATION_TYPES: ReadonlySet<string> = new Set([
  "project",
  "person",
  "available_balance",
  "other",
]);

const PARTY_TYPES: ReadonlySet<string> = new Set(["partner", "sub_partner"]);

export const INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with a non-empty `legs` array and an `idempotencyKey` string. Each leg needs a `destinationType` ("project" | "person" | "available_balance" | "other") and an `amount` string; a "project" leg also needs a non-empty `destinationProjectId`, a non-empty `destinationRequirementId`, a non-empty `destinationShareId`, and a `destinationPartyType` ("partner" | "sub_partner") (Story 4.8, FR28); a "person" leg a non-empty `personName`, and an "other" leg non-empty `notes`. `notes` is otherwise optional on any leg.';

export interface ValidDestinationAllocationLeg {
  destinationType: DestinationType;
  amount: string;
  destinationProjectId: string | null;
  personName: string | null;
  notes: string | null;
  /** Story 4.8 (FR28): required (non-empty) only when `destinationType === "project"`. */
  destinationRequirementId: string | null;
  /** Story 4.8 (FR28): required (non-empty) only when `destinationType === "project"`. */
  destinationShareId: string | null;
  /** Story 4.8 (FR28): required (one of `"partner"`/`"sub_partner"`) only when `destinationType === "project"`. */
  destinationPartyType: "partner" | "sub_partner" | null;
}

export interface ValidDestinationAllocationBody {
  legs: ValidDestinationAllocationLeg[];
  idempotencyKey: string;
}

function isValidLeg(candidate: unknown): candidate is ValidDestinationAllocationLeg {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const leg = candidate as {
    destinationType?: unknown;
    amount?: unknown;
    destinationProjectId?: unknown;
    personName?: unknown;
    notes?: unknown;
    destinationRequirementId?: unknown;
    destinationShareId?: unknown;
    destinationPartyType?: unknown;
  };

  if (typeof leg.destinationType !== "string" || !DESTINATION_TYPES.has(leg.destinationType)) {
    return false;
  }
  if (typeof leg.amount !== "string") {
    return false;
  }
  if (
    leg.destinationProjectId !== undefined &&
    leg.destinationProjectId !== null &&
    typeof leg.destinationProjectId !== "string"
  ) {
    return false;
  }
  if (leg.personName !== undefined && leg.personName !== null && typeof leg.personName !== "string") {
    return false;
  }
  if (leg.notes !== undefined && leg.notes !== null && typeof leg.notes !== "string") {
    return false;
  }
  if (
    leg.destinationRequirementId !== undefined &&
    leg.destinationRequirementId !== null &&
    typeof leg.destinationRequirementId !== "string"
  ) {
    return false;
  }
  if (
    leg.destinationShareId !== undefined &&
    leg.destinationShareId !== null &&
    typeof leg.destinationShareId !== "string"
  ) {
    return false;
  }
  if (
    leg.destinationPartyType !== undefined &&
    leg.destinationPartyType !== null &&
    (typeof leg.destinationPartyType !== "string" || !PARTY_TYPES.has(leg.destinationPartyType))
  ) {
    return false;
  }

  // Type-specific required field -- each destinationType needs its own
  // identifying content to be a well-formed leg at all (this story's I/O
  // matrix: a "project" leg with a malformed/missing destinationProjectId is
  // rejected as 400 `validation_error`).
  if (leg.destinationType === "project") {
    if (typeof leg.destinationProjectId !== "string" || leg.destinationProjectId.trim().length === 0) {
      return false;
    }
    // Story 4.8 (FR28): a "project" leg also requires a chosen destination
    // funding requirement + Partner/Sub-partner Share -- mirrors
    // `destinationProjectId`'s identical required-for-this-type shape.
    if (typeof leg.destinationRequirementId !== "string" || leg.destinationRequirementId.trim().length === 0) {
      return false;
    }
    if (typeof leg.destinationShareId !== "string" || leg.destinationShareId.trim().length === 0) {
      return false;
    }
    if (typeof leg.destinationPartyType !== "string" || !PARTY_TYPES.has(leg.destinationPartyType)) {
      return false;
    }
  }
  if (leg.destinationType === "person") {
    if (typeof leg.personName !== "string" || leg.personName.trim().length === 0) {
      return false;
    }
  }
  if (leg.destinationType === "other") {
    if (typeof leg.notes !== "string" || leg.notes.trim().length === 0) {
      return false;
    }
  }

  return true;
}

export function isValidDestinationAllocationBody(body: unknown): body is ValidDestinationAllocationBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { legs?: unknown; idempotencyKey?: unknown };

  if (!Array.isArray(candidate.legs) || candidate.legs.length === 0) {
    return false;
  }
  if (!candidate.legs.every(isValidLeg)) {
    return false;
  }
  if (typeof candidate.idempotencyKey !== "string" || candidate.idempotencyKey.trim().length === 0) {
    return false;
  }

  return true;
}

export const WITHDRAWAL_TRANSACTION_NOT_FOUND_MESSAGE = "Withdrawal transaction not found.";

/** The uniform 404 body/status `POST` returns for a missing/malformed `transactionId`, or one belonging to a different Project. */
export function withdrawalTransactionNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: WITHDRAWAL_TRANSACTION_NOT_FOUND_MESSAGE },
    { status: 404 },
  );
}

/** `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for this resource. */
export function isValidWithdrawalTransactionId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export const DESTINATION_PROJECT_NOT_FOUND_MESSAGE =
  'A "project" destination\'s `destinationProjectId` must be an existing Project.';

/**
 * Story 4.8 (FR28): the 404 shown when a "project" leg's
 * `destinationRequirementId`/`destinationShareId` don't resolve against the
 * destination Project's *current* data at save time -- covers both the
 * "requirement no longer exists" and "share no longer current" I/O-matrix
 * rows under one message, mirroring `DESTINATION_PROJECT_NOT_FOUND_MESSAGE`'s
 * identical role one check earlier.
 */
export const DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE =
  'A "project" destination\'s `destinationRequirementId` must be an existing funding requirement at the destination Project, and `destinationShareId` must be a current Partner/Sub-partner Share there.';

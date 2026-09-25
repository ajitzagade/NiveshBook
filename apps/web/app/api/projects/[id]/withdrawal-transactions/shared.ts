import { NextResponse } from "next/server";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared by `POST`/`GET /api/projects/[id]/withdrawal-transactions` (Story
 * 4.2) -- the `POST` body shape and this endpoint's own not-found response,
 * mirroring `investment-requirements/[requirementId]/transactions/shared.ts`'s
 * pattern one ledger over (Project-scoped, not per-requirement -- this
 * endpoint has no `requirementId` path param, mirroring Story 4.1's
 * `can-take` route's identical Project-only shape).
 *
 * Deliberately does **not** re-export `PAYMENT_MODES`/`PAYMENT_MODE_LABELS`
 * from the investment-transactions route's own `shared.ts` (this story's
 * Code Map, closing Review Triage Log row 4) -- nothing in this story's own
 * files needs a route-level export of either; `withdraw-money/page.tsx` and
 * `packages/core`'s `withdrawal-transaction.ts` each keep their own local
 * payment-mode list, mirroring the already-established, accepted precedent
 * that `add-money/page.tsx` doesn't import its own investment route's
 * `shared.ts` export either.
 */
export const INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with `partyType` ("partner" or "sub_partner"), a `shareId` string, an `amount` string, a `transactionDate` string (YYYY-MM-DD), a `paymentMode` string, an `idempotencyKey` string, optional `referenceNumber`/`notes` strings, and an optional `extraWithdrawalAuthorized` boolean.';

export interface ValidWithdrawalTransactionBody {
  partyType: "partner" | "sub_partner";
  shareId: string;
  amount: string;
  transactionDate: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
  idempotencyKey: string;
  /**
   * Story 4.5 (FR25): set `true` only when the caller has confirmed the
   * distinct "Authorize Extra Withdrawal?" step -- optional, defaults to
   * `false`/absent (this story's Code Map). Only ever consulted by the
   * route's `assertExtraWithdrawalAuthorized` gate when `amount` exceeds the
   * target's live Can Take; entirely ignored for a normal (within-
   * entitlement) withdrawal.
   */
  extraWithdrawalAuthorized?: boolean;
}

export function isValidWithdrawalTransactionBody(
  body: unknown,
): body is ValidWithdrawalTransactionBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as {
    partyType?: unknown;
    shareId?: unknown;
    amount?: unknown;
    transactionDate?: unknown;
    paymentMode?: unknown;
    referenceNumber?: unknown;
    notes?: unknown;
    idempotencyKey?: unknown;
    extraWithdrawalAuthorized?: unknown;
  };

  if (candidate.partyType !== "partner" && candidate.partyType !== "sub_partner") {
    return false;
  }
  if (typeof candidate.shareId !== "string" || candidate.shareId.trim().length === 0) {
    return false;
  }
  if (typeof candidate.amount !== "string") {
    return false;
  }
  if (typeof candidate.transactionDate !== "string") {
    return false;
  }
  if (typeof candidate.paymentMode !== "string") {
    return false;
  }
  if (
    candidate.referenceNumber !== undefined &&
    candidate.referenceNumber !== null &&
    typeof candidate.referenceNumber !== "string"
  ) {
    return false;
  }
  if (candidate.notes !== undefined && candidate.notes !== null && typeof candidate.notes !== "string") {
    return false;
  }
  if (typeof candidate.idempotencyKey !== "string") {
    return false;
  }
  if (
    candidate.extraWithdrawalAuthorized !== undefined &&
    typeof candidate.extraWithdrawalAuthorized !== "boolean"
  ) {
    return false;
  }

  return true;
}

export const SHARE_NOT_FOUND_MESSAGE = "No current Partner or Sub-partner Share matches that id.";

/** The uniform 404 body/status `POST` returns when `partyType`+`shareId` doesn't match any of this Project's *current* Partner/Sub-partner Shares. */
export function shareNotFoundResponse(): NextResponse {
  return NextResponse.json({ code: "not_found", message: SHARE_NOT_FOUND_MESSAGE }, { status: 404 });
}

/**
 * Shared by `PATCH .../withdrawal-transactions/[transactionId]` and
 * `POST .../withdrawal-transactions/[transactionId]/cancel` (Story 4.11) --
 * `transactionId` path-param validation/not-found response, mirroring
 * `investment-requirements/[requirementId]/transactions/shared.ts`'s
 * `isValidTransactionId`/`transactionNotFoundResponse` one ledger over. A
 * separate, deliberately duplicated copy from
 * `[transactionId]/destination-allocations/shared.ts`'s own
 * `isValidWithdrawalTransactionId`/`withdrawalTransactionNotFoundResponse` --
 * mirrors this file's own established "no cross-route-group re-export"
 * precedent (`PAYMENT_MODES` above).
 */
export const TRANSACTION_NOT_FOUND_MESSAGE = "Withdrawal transaction not found.";

/** The uniform 404 body/status both new routes return for an unknown, malformed, or cross-Project `transactionId`. */
export function transactionNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: TRANSACTION_NOT_FOUND_MESSAGE },
    { status: 404 },
  );
}

/** `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for this resource's `transactionId`. */
export function isValidTransactionId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

/**
 * `PATCH .../withdrawal-transactions/[transactionId]`'s body shape (Story
 * 4.11) -- mirrors `investment-requirements/[requirementId]/transactions/shared.ts`'s
 * `ValidEditTransactionBody`/`isValidEditTransactionBody` one ledger over,
 * minus `partyType`/`shareId` (an edit never moves a withdrawal to a
 * different share) and plus an optional `reason`. The actual field-level
 * validation (amount format, date format, payment mode membership,
 * idempotency key presence, amount-locked-by-allocation) happens inside
 * `packages/core`'s `editWithdrawalTransaction`/`packages/db`'s
 * `editTransaction`, not this type guard -- this only rejects a
 * structurally malformed body before ever reaching the domain layer.
 */
export const EDIT_INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with an `amount` string, a `transactionDate` string (YYYY-MM-DD), a `paymentMode` string, an `idempotencyKey` string, optional `referenceNumber`/`notes` strings, and an optional `reason` string.';

export interface ValidEditWithdrawalTransactionBody {
  amount: string;
  transactionDate: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
  idempotencyKey: string;
  reason: string | null;
}

export function isValidEditWithdrawalTransactionBody(
  body: unknown,
): body is ValidEditWithdrawalTransactionBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as {
    amount?: unknown;
    transactionDate?: unknown;
    paymentMode?: unknown;
    referenceNumber?: unknown;
    notes?: unknown;
    idempotencyKey?: unknown;
    reason?: unknown;
  };

  if (typeof candidate.amount !== "string") {
    return false;
  }
  if (typeof candidate.transactionDate !== "string") {
    return false;
  }
  if (typeof candidate.paymentMode !== "string") {
    return false;
  }
  if (
    candidate.referenceNumber !== undefined &&
    candidate.referenceNumber !== null &&
    typeof candidate.referenceNumber !== "string"
  ) {
    return false;
  }
  if (candidate.notes !== undefined && candidate.notes !== null && typeof candidate.notes !== "string") {
    return false;
  }
  if (typeof candidate.idempotencyKey !== "string") {
    return false;
  }
  if (candidate.reason !== undefined && candidate.reason !== null && typeof candidate.reason !== "string") {
    return false;
  }

  return true;
}

/**
 * `POST .../withdrawal-transactions/[transactionId]/cancel`'s body shape
 * (Story 4.11) -- deliberately minimal, mirrors
 * `ValidCancelTransactionBody` one ledger over: cancelling never changes
 * amount/date/paymentMode/reference/notes.
 */
export const CANCEL_INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with an `idempotencyKey` string and an optional `reason` string.';

export interface ValidCancelWithdrawalTransactionBody {
  idempotencyKey: string;
  reason: string | null;
}

export function isValidCancelWithdrawalTransactionBody(
  body: unknown,
): body is ValidCancelWithdrawalTransactionBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { idempotencyKey?: unknown; reason?: unknown };

  if (typeof candidate.idempotencyKey !== "string") {
    return false;
  }
  if (candidate.reason !== undefined && candidate.reason !== null && typeof candidate.reason !== "string") {
    return false;
  }

  return true;
}

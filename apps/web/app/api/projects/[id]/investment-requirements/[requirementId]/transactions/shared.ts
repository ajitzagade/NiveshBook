import { NextResponse } from "next/server";
import type { PaymentMode } from "@niveshbook/types";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared by `POST`/`GET .../investment-requirements/[requirementId]/transactions`
 * (Story 3.3) -- the `POST` body shape and this endpoint's own not-found
 * response, mirroring `investment-requirements/shared.ts`'s pattern one
 * resource over. `referenceNumber`/`notes` are optional, nullable strings
 * (this story's Decisions) -- absent, `null`, or a non-empty string are all
 * structurally valid here; the actual field-level validation (amount format,
 * date format, payment mode membership, idempotency key presence) happens
 * inside `packages/core`'s `recordInvestmentTransaction`, not this type
 * guard -- this only rejects a structurally malformed body (missing/
 * wrong-typed fields) before ever reaching the domain layer.
 */
export const INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with `partyType` ("partner" or "sub_partner"), a `shareId` string, an `amount` string, a `transactionDate` string (YYYY-MM-DD), a `paymentMode` string, an `idempotencyKey` string, and optional `referenceNumber`/`notes` strings.';

export interface ValidTransactionBody {
  partyType: "partner" | "sub_partner";
  shareId: string;
  amount: string;
  transactionDate: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
  idempotencyKey: string;
}

export function isValidTransactionBody(body: unknown): body is ValidTransactionBody {
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

  return true;
}

export const SHARE_NOT_FOUND_MESSAGE = "No current Partner or Sub-partner Share matches that id.";

/** The uniform 404 body/status `POST` returns when `partyType`+`shareId` doesn't match any of this Project's *current* Partner/Sub-partner Shares. */
export function shareNotFoundResponse(): NextResponse {
  return NextResponse.json({ code: "not_found", message: SHARE_NOT_FOUND_MESSAGE }, { status: 404 });
}

const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  cheque: "Cheque",
  neft: "NEFT",
  rtgs: "RTGS",
  imps: "IMPS",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

/**
 * Every valid `PaymentMode`, in display order -- sourced from the
 * `Record<PaymentMode, string>` above so this list stays exhaustive against
 * `packages/types`'s `PaymentMode` union at compile time (adding/removing a
 * mode there is a type error here until this map is updated too). Reused by
 * the Record Payment dialog's Payment Mode `<select>` (`add-money/page.tsx`)
 * for its options -- the actual enum-membership validation still happens
 * server-side, in `packages/core`'s own `PAYMENT_MODES` (this is a display
 * concern only).
 */
export const PAYMENT_MODES = Object.keys(PAYMENT_MODE_LABELS) as PaymentMode[];
export { PAYMENT_MODE_LABELS };

/**
 * Shared by `PATCH .../transactions/[transactionId]` and
 * `GET .../transactions/[transactionId]/audit-log` (Story 3.7) --
 * `transactionId` path-param validation/not-found response, mirroring
 * `investment-requirements/shared.ts`'s `isValidRequirementId`/
 * `requirementNotFoundResponse` one resource over.
 */
export const TRANSACTION_NOT_FOUND_MESSAGE = "Transaction not found.";

/** The uniform 404 body/status both new routes return for an unknown, malformed, or cross-requirement/cross-project `transactionId`. */
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
 * `PATCH .../transactions/[transactionId]`'s body shape (Story 3.7) --
 * mirrors `ValidTransactionBody` one level over, minus `partyType`/`shareId`
 * (an edit never moves a transaction to a different share -- this story's
 * Boundaries) and plus an optional `reason` (`audit_log.reason`'s existing
 * nullable design). The actual field-level validation (amount format, date
 * format, payment mode membership, idempotency key presence) happens inside
 * `packages/core`'s `editInvestmentTransaction`, not this type guard -- this
 * only rejects a structurally malformed body before ever reaching the
 * domain layer.
 */
export const EDIT_INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with an `amount` string, a `transactionDate` string (YYYY-MM-DD), a `paymentMode` string, an `idempotencyKey` string, optional `referenceNumber`/`notes` strings, and an optional `reason` string.';

export interface ValidEditTransactionBody {
  amount: string;
  transactionDate: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
  idempotencyKey: string;
  reason: string | null;
}

export function isValidEditTransactionBody(body: unknown): body is ValidEditTransactionBody {
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

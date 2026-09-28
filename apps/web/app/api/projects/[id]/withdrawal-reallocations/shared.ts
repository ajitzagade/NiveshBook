import { NextResponse } from "next/server";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * `POST /api/projects/[id]/withdrawal-reallocations`'s body shape --
 * declining some amount of one Partner's/Sub-partner's currently-available
 * Can Take, so it can be reallocated pro-rata to everyone else. Mirrors
 * `withdrawal-transactions/shared.ts`'s `ValidWithdrawalTransactionBody`
 * shape for the fields both share (`partyType`/`shareId`/`idempotencyKey`),
 * renamed `declinedAmount` for this endpoint's own domain term.
 */
export const INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with `partyType` ("partner" or "sub_partner"), a `shareId` string, a `declinedAmount` string, an `idempotencyKey` string, and an optional `notes` string.';

export interface ValidWithdrawalReallocationBody {
  partyType: "partner" | "sub_partner";
  shareId: string;
  declinedAmount: string;
  notes: string | null;
  idempotencyKey: string;
}

export function isValidWithdrawalReallocationBody(
  body: unknown,
): body is ValidWithdrawalReallocationBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as {
    partyType?: unknown;
    shareId?: unknown;
    declinedAmount?: unknown;
    notes?: unknown;
    idempotencyKey?: unknown;
  };

  if (candidate.partyType !== "partner" && candidate.partyType !== "sub_partner") {
    return false;
  }
  if (typeof candidate.shareId !== "string" || candidate.shareId.trim().length === 0) {
    return false;
  }
  if (typeof candidate.declinedAmount !== "string") {
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

export const REALLOCATION_NOT_FOUND_MESSAGE = "Withdrawal reallocation not found.";

/** The uniform 404 body/status the cancel route returns for an unknown, malformed, or cross-Project `reallocationId`. */
export function reallocationNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: REALLOCATION_NOT_FOUND_MESSAGE },
    { status: 404 },
  );
}

/** `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for this resource's `reallocationId`. */
export function isValidReallocationId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

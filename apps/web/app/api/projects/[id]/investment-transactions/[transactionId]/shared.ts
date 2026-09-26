import { NextResponse } from "next/server";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared by the flat `.../investment-transactions/[transactionId]/audit-log`
 * route (Story 5.9's post-review fix) -- `transactionId` path-param
 * validation/not-found response, mirroring
 * `withdrawal-transactions/shared.ts`'s `isValidTransactionId`/
 * `transactionNotFoundResponse` one ledger over. A separate, deliberately
 * duplicated copy from `investment-requirements/[requirementId]/transactions/shared.ts`'s
 * own equivalent -- mirrors that file's own established "no
 * cross-route-group re-export" precedent (see the withdrawal `shared.ts`'s
 * own doc comment for the identical rationale).
 */
export const TRANSACTION_NOT_FOUND_MESSAGE = "Investment transaction not found.";

/** The uniform 404 body/status this route returns for an unknown, malformed, or cross-Project `transactionId`. */
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

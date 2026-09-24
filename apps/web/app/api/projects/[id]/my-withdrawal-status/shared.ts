import { NextResponse } from "next/server";

/**
 * Shared by `GET /api/projects/[id]/my-withdrawal-status` (Story 4.6) --
 * query-string validation and this endpoint's own not-found response,
 * mirroring `investment-requirements/[requirementId]/my-investment-status/shared.ts`'s
 * identical Story 3.6 precedent one ledger over (this endpoint is
 * Project-scoped, no `requirementId` segment -- Story 4.1/4.3's flat
 * withdrawal-domain URL shape, not investment's per-requirement nesting).
 */
export const INVALID_REQUEST_MESSAGE =
  'Query string must include `partyType` ("partner" or "sub_partner") and a non-empty `shareId` string.';

export interface ValidMyWithdrawalStatusQuery {
  partyType: "partner" | "sub_partner";
  shareId: string;
}

/**
 * `null` when `partyType` isn't exactly `"partner"`/`"sub_partner"`, or
 * `shareId` is missing/empty -- the route maps that to 400 `invalid_request`,
 * mirroring `isValidWithdrawalTransactionBody`'s malformed-input convention.
 *
 * Returns the *trimmed* `shareId` -- Story 3.6 shipped a bug here
 * (validated-trimmed-but-returned-untrimmed) and had to patch it in its own
 * review round; this story's Decisions call for getting it right from the
 * start. Validation and the returned value must agree on what "empty"
 * means, otherwise a `shareId` with incidental leading/trailing whitespace
 * would pass this check but then fail to strictly-equal-match any share
 * later, producing a confusing 404 instead of a trimmed match.
 */
export function parseQueryParams(searchParams: URLSearchParams): ValidMyWithdrawalStatusQuery | null {
  const partyType = searchParams.get("partyType");
  const shareId = searchParams.get("shareId")?.trim();

  if (partyType !== "partner" && partyType !== "sub_partner") {
    return null;
  }
  if (!shareId) {
    return null;
  }

  return { partyType, shareId };
}

export const SHARE_NOT_FOUND_MESSAGE = "No current Partner or Sub-partner Share matches that id.";

/** The uniform 404 body/status this endpoint returns when `partyType`+`shareId` doesn't match any of this Project's *current* Partner/Sub-partner Shares. */
export function shareNotFoundResponse(): NextResponse {
  return NextResponse.json({ code: "not_found", message: SHARE_NOT_FOUND_MESSAGE }, { status: 404 });
}

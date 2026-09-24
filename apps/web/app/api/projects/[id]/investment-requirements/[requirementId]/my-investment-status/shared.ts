import { NextResponse } from "next/server";

/**
 * Shared by `GET .../investment-requirements/[requirementId]/my-investment-status`
 * (Story 3.6) -- query-string validation and this endpoint's own not-found
 * response, mirroring `transactions/shared.ts`'s pattern one resource over
 * (that file validates a request *body* shape; this one validates the
 * equivalent query-string shape, since `partyType`/`shareId` here are query
 * parameters, not path parameters or a body -- this is a query against one
 * specific share within a requirement, not a distinct resource path).
 */
export const INVALID_REQUEST_MESSAGE =
  'Query string must include `partyType` ("partner" or "sub_partner") and a non-empty `shareId` string.';

export interface ValidMyInvestmentStatusQuery {
  partyType: "partner" | "sub_partner";
  shareId: string;
}

/**
 * `null` when `partyType` isn't exactly `"partner"`/`"sub_partner"`, or
 * `shareId` is missing/empty -- the route maps that to 400 `invalid_request`,
 * mirroring `isValidTransactionBody`'s malformed-input convention (this
 * story's spec has no explicit malformed-query-param row in its I/O matrix,
 * so this follows that established codebase convention).
 *
 * Returns the *trimmed* `shareId` (Review Triage Log row 4) -- validation
 * and the returned value must agree on what "empty" means, otherwise a
 * `shareId` with incidental leading/trailing whitespace would pass this
 * check but then fail to strictly-equal-match any share later, producing a
 * confusing 404 instead of a trimmed match.
 */
export function parseQueryParams(searchParams: URLSearchParams): ValidMyInvestmentStatusQuery | null {
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

import { NextResponse } from "next/server";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared by `POST`/`GET /api/projects/[id]/investment-requirements` -- the
 * `POST` body shape, mirroring `apps/web/app/api/projects/[id]/partner-shares/shared.ts`'s
 * pattern for Story 2.2. There is no update/delete endpoint for this
 * resource (spec-3-1's Decisions), so unlike `partner-shares/shared.ts`
 * there is no separate not-found-response helper here -- `POST`/`GET` both
 * reuse `apps/web/app/api/projects/shared.ts`'s `projectNotFoundResponse`
 * for a missing *Project*, and this resource itself is never looked up by
 * its own id.
 *
 * Story 3.2 adds `isValidRequirementId`/`requirementNotFoundResponse` below,
 * for its `GET .../investment-requirements/[requirementId]/should-pay`
 * route -- the first endpoint under this resource to look up a single
 * requirement by its own id, mirroring `partner-shares/shared.ts`'s
 * `isValidPartnerId`/`partnerShareNotFoundResponse` one resource over.
 */
export const INVALID_REQUEST_MESSAGE =
  "Request body must be valid JSON with an `amount` string and a `requirementDate` string (YYYY-MM-DD).";

export interface ValidInvestmentRequirementBody {
  amount: string;
  requirementDate: string;
}

export function isValidInvestmentRequirementBody(
  body: unknown,
): body is ValidInvestmentRequirementBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { amount?: unknown; requirementDate?: unknown };
  return typeof candidate.amount === "string" && typeof candidate.requirementDate === "string";
}

export const REQUIREMENT_NOT_FOUND_MESSAGE = "Funding requirement not found.";

/** The uniform 404 body/status `GET .../investment-requirements/[requirementId]/should-pay` returns for an unknown, malformed, or cross-project `requirementId`. */
export function requirementNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: REQUIREMENT_NOT_FOUND_MESSAGE },
    { status: 404 },
  );
}

/** `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for this resource's `requirementId`. */
export function isValidRequirementId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

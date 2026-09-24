/**
 * Shared by `POST`/`GET /api/projects/[id]/investment-requirements` -- the
 * `POST` body shape, mirroring `apps/web/app/api/projects/[id]/partner-shares/shared.ts`'s
 * pattern for Story 2.2. There is no update/delete endpoint for this
 * resource (spec-3-1's Decisions), so unlike `partner-shares/shared.ts`
 * there is no separate not-found-response helper here -- `POST`/`GET` both
 * reuse `apps/web/app/api/projects/shared.ts`'s `projectNotFoundResponse`
 * for a missing *Project*, and this resource itself is never looked up by
 * its own id.
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

/**
 * `POST /api/reports/project-money-flow`'s body shape -- one or more Project
 * ids to combine into one report. Mirrors this codebase's established
 * `isValidXBody` type-guard convention (e.g.
 * `.../withdrawal-transactions/batch/shared.ts`) -- only rejects a
 * structurally malformed body; each id's actual existence is checked inside
 * the route itself.
 */
export const INVALID_REQUEST_MESSAGE =
  "Request body must be valid JSON with `projectIds`, a non-empty array of Project id strings.";

export interface ValidProjectMoneyFlowReportBody {
  projectIds: string[];
}

export function isValidProjectMoneyFlowReportBody(
  body: unknown,
): body is ValidProjectMoneyFlowReportBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { projectIds?: unknown };
  if (!Array.isArray(candidate.projectIds) || candidate.projectIds.length === 0) {
    return false;
  }
  return candidate.projectIds.every((id) => typeof id === "string" && id.trim().length > 0);
}

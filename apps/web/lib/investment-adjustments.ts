import type { PartnerInvestmentAdjustment } from "@niveshbook/core";

/**
 * Thin client-side fetch helper for the Add Money screen's Should Pay
 * expand panel's adjustment status chips (Story 3.4) -- mirrors
 * `apps/web/lib/should-pay.ts`'s pattern one field richer. Read-only from
 * this page's perspective -- the endpoint itself upserts the ledger as a
 * side effect of being viewed (this story's Decisions), but there is no
 * separate write helper here to call.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** `GET .../investment-requirements/[requirementId]/adjustments`'s response shape. */
export interface InvestmentAdjustmentsResponse {
  partners: PartnerInvestmentAdjustment[];
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Body wasn't JSON (or had no message) -- fall through to the generic one.
  }
  return GENERIC_ERROR_MESSAGE;
}

export async function getInvestmentAdjustments(
  projectId: string,
  requirementId: string,
): Promise<InvestmentAdjustmentsResponse> {
  const response = await fetch(
    `/api/projects/${projectId}/investment-requirements/${requirementId}/adjustments`,
  );
  if (!response.ok) {
    // The 409 precondition states (`shares_not_fully_allocated`/
    // `sub_partner_shares_over_allocated`) both carry their own
    // plain-language `message`, mirroring `should-pay.ts`'s identical
    // convention.
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as InvestmentAdjustmentsResponse;
}

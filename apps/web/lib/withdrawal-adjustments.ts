import type { PartnerWithdrawalAdjustment } from "@niveshbook/core";

/**
 * Thin client-side fetch helper for the Withdraw Money screen's Withdrawal
 * Adjustment status chips (Story 4.3) -- mirrors
 * `apps/web/lib/investment-adjustments.ts`'s pattern one ledger over.
 * Read-only from this page's perspective -- the endpoint itself upserts the
 * ledger as a side effect of being viewed (this story's Decisions), but
 * there is no separate write helper here to call.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** `GET /api/projects/[id]/withdrawal-adjustments`'s response shape. */
export interface WithdrawalAdjustmentsResponse {
  partners: PartnerWithdrawalAdjustment[];
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

export async function getWithdrawalAdjustments(projectId: string): Promise<WithdrawalAdjustmentsResponse> {
  const response = await fetch(`/api/projects/${projectId}/withdrawal-adjustments`);
  if (!response.ok) {
    // The 409 precondition states (`shares_not_fully_allocated`/
    // `sub_partner_shares_over_allocated`) both carry their own
    // plain-language `message`, mirroring `investment-adjustments.ts`'s
    // identical convention.
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as WithdrawalAdjustmentsResponse;
}

import type { Money, Percent, WithdrawalAdjustment } from "@niveshbook/types";

/**
 * Thin client-side fetch helper for the partner self-service Withdraw Money
 * screen (2026-09-29) -- mirrors `apps/web/lib/can-take.ts`'s pattern
 * exactly, just pointed at the caller's own, already-self-access-capable
 * `my-withdrawal-status` endpoint (Story 4.6) instead of the Owner/Admin-
 * only `can-take` one. Read-only -- there is no write helper here, since the
 * endpoint itself is a pure calculation with no write path.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * Mirrors `packages/core`'s `PartnerWithdrawalAdjustment`/
 * `SubPartnerWithdrawalAdjustment` plus the same `effectiveCanTake` field
 * `my-withdrawal-status/route.ts` merges in at this one requested share's
 * own top level (unlike `my-investment-status`'s `recommendedAmount`,
 * `effectiveCanTake` is NOT merged into a Partner's nested `subPartners` --
 * mirrors the route's own doc comment exactly). Kept as a separate
 * client-side type rather than importing the route-local shape, matching
 * `can-take.ts`'s identical "no cross-route-group re-export" precedent.
 */
export interface MyWithdrawalStatus {
  partnerId?: string;
  subPartnerId?: string;
  name: string;
  sharePercent: Percent;
  canTake: Money;
  taken: Money;
  adjustmentType: WithdrawalAdjustment["adjustmentType"];
  adjustmentAmount: Money;
  effectiveCanTake: Money;
}

/** `GET /api/projects/[id]/my-withdrawal-status`'s response shape. */
export interface MyWithdrawalStatusResponse {
  partyType: "partner" | "sub_partner";
  status: MyWithdrawalStatus;
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

export async function getMyWithdrawalStatus(
  projectId: string,
  partyType: "partner" | "sub_partner",
  shareId: string,
): Promise<MyWithdrawalStatusResponse> {
  const params = new URLSearchParams({ partyType, shareId });
  const response = await fetch(`/api/projects/${projectId}/my-withdrawal-status?${params.toString()}`);
  if (!response.ok) {
    // The 409 precondition states carry their own plain-language `message`
    // -- surfaced as-is, mirrors `can-take.ts`'s identical precedent.
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as MyWithdrawalStatusResponse;
}

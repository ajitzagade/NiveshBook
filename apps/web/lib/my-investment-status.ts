import type { InvestmentAdjustment, Money, Percent } from "@niveshbook/types";

/**
 * Thin client-side fetch helper for the partner self-service Add Money
 * screen (2026-09-29) -- mirrors `apps/web/lib/should-pay.ts`'s pattern
 * exactly, just pointed at the caller's own, already-self-access-capable
 * `my-investment-status` endpoint (Story 3.6) instead of the Owner/Admin-
 * only `should-pay` one. Read-only -- there is no write helper here, since
 * the endpoint itself is a pure calculation with no write path.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * Mirrors `packages/core`'s `SubPartnerInvestmentAdjustment` plus the same
 * optional `recommendedAmount`/`previousPending`/`previousExtraPaid` fields
 * `my-investment-status/route.ts`'s own `withRecommendedAmount` merges in --
 * kept as a separate client-side type rather than importing that route-local
 * shape, matching `apps/web/lib/can-take.ts`'s identical "no cross-route-
 * group re-export" precedent.
 */
export interface MySubPartnerInvestmentStatus {
  subPartnerId: string;
  name: string;
  sharePercent: Percent;
  shouldPay: Money;
  actualPaid: Money;
  adjustmentType: InvestmentAdjustment["adjustmentType"];
  adjustmentAmount: Money;
  recommendedAmount?: Money;
  previousPending?: Money;
  previousExtraPaid?: Money;
}

/** A Partner's own status -- includes their own current Sub-partners (self-service naturally extends to "their own", per Story 3.6's own AC). */
export interface MyPartnerInvestmentStatus {
  partnerId: string;
  name: string;
  sharePercent: Percent;
  shouldPay: Money;
  ownShouldPay: Money;
  actualPaid: Money;
  adjustmentType: InvestmentAdjustment["adjustmentType"];
  adjustmentAmount: Money;
  recommendedAmount?: Money;
  previousPending?: Money;
  previousExtraPaid?: Money;
  subPartners: MySubPartnerInvestmentStatus[];
}

/** `GET .../investment-requirements/[requirementId]/my-investment-status`'s response shape. */
export type MyInvestmentStatusResponse =
  | { partyType: "partner"; status: MyPartnerInvestmentStatus }
  | { partyType: "sub_partner"; status: MySubPartnerInvestmentStatus };

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

export async function getMyInvestmentStatus(
  projectId: string,
  requirementId: string,
  partyType: "partner" | "sub_partner",
  shareId: string,
): Promise<MyInvestmentStatusResponse> {
  const params = new URLSearchParams({ partyType, shareId });
  const response = await fetch(
    `/api/projects/${projectId}/investment-requirements/${requirementId}/my-investment-status?${params.toString()}`,
  );
  if (!response.ok) {
    // The 409 precondition states carry their own plain-language `message`
    // -- surfaced as-is, mirrors `should-pay.ts`'s identical precedent.
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as MyInvestmentStatusResponse;
}

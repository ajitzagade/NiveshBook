import type { SubPartnerShare } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Sub-partner allocation rows on the
 * Partner Shares screen (Story 2.3) -- mirrors
 * `apps/web/lib/partner-shares.ts`'s pattern one level down.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface SubPartnerShareInput {
  name: string;
  sharePercent: string;
}

/** `GET .../subpartner-shares`'s response shape -- the current Sub-partner Shares for one Partner, plus the live running total scoped to that Partner's own slice (AD-2's decimal-safe addition, not `%`-suffixed). */
export interface SubPartnerSharesResponse {
  shares: SubPartnerShare[];
  total: string;
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

export async function listSubPartnerShares(
  projectId: string,
  partnerId: string,
): Promise<SubPartnerSharesResponse> {
  const response = await fetch(
    `/api/projects/${projectId}/partner-shares/${partnerId}/subpartner-shares`,
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SubPartnerSharesResponse;
}

export async function addSubPartnerShare(
  projectId: string,
  partnerId: string,
  input: SubPartnerShareInput,
): Promise<SubPartnerShare> {
  const response = await fetch(
    `/api/projects/${projectId}/partner-shares/${partnerId}/subpartner-shares`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SubPartnerShare;
}

export async function updateSubPartnerShare(
  projectId: string,
  partnerId: string,
  subPartnerId: string,
  input: SubPartnerShareInput,
): Promise<SubPartnerShare> {
  const response = await fetch(
    `/api/projects/${projectId}/partner-shares/${partnerId}/subpartner-shares/${subPartnerId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SubPartnerShare;
}

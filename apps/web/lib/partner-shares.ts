import type { PartnerShare } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Partner Shares screen (Story 2.2)
 * -- mirrors `apps/web/lib/projects.ts`'s pattern for Story 2.1.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface PartnerShareInput {
  name: string;
  sharePercent: string;
}

/** `GET /api/projects/[id]/partner-shares`'s response shape -- the current shares plus the live running total (AD-2's decimal-safe addition, not `%`-suffixed). */
export interface PartnerSharesResponse {
  shares: PartnerShare[];
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

export async function listPartnerShares(projectId: string): Promise<PartnerSharesResponse> {
  const response = await fetch(`/api/projects/${projectId}/partner-shares`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as PartnerSharesResponse;
}

export async function addPartnerShare(
  projectId: string,
  input: PartnerShareInput,
): Promise<PartnerShare> {
  const response = await fetch(`/api/projects/${projectId}/partner-shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as PartnerShare;
}

export async function updatePartnerShare(
  projectId: string,
  partnerId: string,
  input: PartnerShareInput,
): Promise<PartnerShare> {
  const response = await fetch(`/api/projects/${projectId}/partner-shares/${partnerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as PartnerShare;
}

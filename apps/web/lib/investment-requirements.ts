import type { InvestmentRequirement } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Add Money screen (Story 3.1) --
 * mirrors `apps/web/lib/partner-shares.ts`'s pattern.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface InvestmentRequirementInput {
  amount: string;
  /** Plain date, `YYYY-MM-DD`. */
  requirementDate: string;
}

/** `GET /api/projects/[id]/investment-requirements`'s response shape. */
export interface InvestmentRequirementsResponse {
  requirements: InvestmentRequirement[];
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

export async function listInvestmentRequirements(
  projectId: string,
): Promise<InvestmentRequirementsResponse> {
  const response = await fetch(`/api/projects/${projectId}/investment-requirements`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as InvestmentRequirementsResponse;
}

export async function addInvestmentRequirement(
  projectId: string,
  input: InvestmentRequirementInput,
): Promise<InvestmentRequirement> {
  const response = await fetch(`/api/projects/${projectId}/investment-requirements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as InvestmentRequirement;
}

import type { Money } from "@niveshbook/types";
import type { PartnerCanTake } from "@niveshbook/core";

/**
 * Thin client-side fetch helper for the Withdraw Money screen (Story 4.1) --
 * mirrors `apps/web/lib/should-pay.ts`'s pattern exactly. Read-only -- there
 * is no write helper here, since the endpoint itself is a pure calculation
 * with no write path (this story's Boundaries).
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** `GET /api/projects/[id]/can-take`'s response shape. */
export interface CanTakeResponse {
  availableToWithdraw: Money;
  partners: PartnerCanTake[];
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

export async function getCanTake(projectId: string): Promise<CanTakeResponse> {
  const response = await fetch(`/api/projects/${projectId}/can-take`);
  if (!response.ok) {
    // The 409 precondition states (`shares_not_fully_allocated`/
    // `sub_partner_shares_over_allocated`) carry their own plain-language
    // `message` from `can-take.ts`'s error classes -- surfaced as-is here,
    // rendered by the page as a plain message rather than a number (this
    // story's Code Map).
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as CanTakeResponse;
}

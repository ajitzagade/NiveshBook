import type { MoneyTrailNode, MoneyTrailNodeType, MoneyTrailReconciliationResult } from "@niveshbook/types";

/**
 * Thin client-side fetch helper for `GET /api/money-trail` (Story 4.10,
 * FR30) -- mirrors `apps/web/lib/money-movements.ts`'s pattern. No page
 * consumes this yet (this story ships no dedicated UI, spec-4-10's
 * Decisions #1 -- Story 5.2's job); it exists for tests/live-verification
 * use, exactly like this story's Code Map calls for.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface MoneyTrailResponse {
  trail: MoneyTrailNode;
  reconciliation: MoneyTrailReconciliationResult;
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

/** The full linked-transaction trail assembled from `(type, id)`, plus its reconciliation result. */
export async function getMoneyTrail(type: MoneyTrailNodeType, id: string): Promise<MoneyTrailResponse> {
  const response = await fetch(`/api/money-trail?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as MoneyTrailResponse;
}

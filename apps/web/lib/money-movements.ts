import type { MoneyMovement } from "@niveshbook/types";

/**
 * Thin client-side fetch helper for the Add Money screen's "Moved from
 * Project A" indicator (Story 4.8, FR28) -- mirrors
 * `apps/web/lib/withdrawal-transactions.ts`'s pattern one story over.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface MoneyMovementsResponse {
  moneyMovements: MoneyMovement[];
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

/** Every money movement landing at `projectId` -- the linked-investment-record rows the Add Money page's "Moved from Project A" indicator matches against `InvestmentTransaction.id`. */
export async function listMoneyMovements(projectId: string): Promise<MoneyMovementsResponse> {
  const response = await fetch(`/api/projects/${projectId}/money-movements`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as MoneyMovementsResponse;
}

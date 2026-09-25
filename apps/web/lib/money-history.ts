import type { MoneyHistoryEntry } from "@niveshbook/types";

/**
 * Thin client-side fetch helper for `GET /api/money-history` (Story 5.1,
 * FR31) -- mirrors `apps/web/lib/money-trail.ts`'s pattern. Deliberately NOT
 * Project-scoped in its own URL shape (mirrors the route's own "not
 * Project-scoped" design) -- every filter is a plain query param.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface MoneyHistoryFiltersInput {
  dateFrom?: string;
  dateTo?: string;
  projectId?: string;
  partyType?: "partner" | "sub_partner";
  shareId?: string;
  personName?: string;
}

export interface MoneyHistoryResponse {
  entries: MoneyHistoryEntry[];
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

/** The unified Money History list, filtered/scoped server-side. Every filter field is optional -- an omitted/empty one is left off the query string entirely. */
export async function getMoneyHistory(
  filters: MoneyHistoryFiltersInput = {},
): Promise<MoneyHistoryResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.trim().length > 0) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  const response = await fetch(`/api/money-history${query ? `?${query}` : ""}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as MoneyHistoryResponse;
}

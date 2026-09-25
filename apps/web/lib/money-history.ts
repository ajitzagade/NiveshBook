import type { MoneyHistoryEntry, MoneyHistoryEntryType, MoneyTrailNodeType } from "@niveshbook/types";

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

/**
 * Story 5.2 (FR32): the exhaustive `MoneyHistoryEntryType` -> `MoneyTrailNodeType`
 * mapping this story's Code Map calls for -- every one of Story 5.1's 6 entry
 * types maps to exactly one of `GET /api/money-trail`'s 4 genuinely-startable
 * node types (confirmed 1:1 during investigation, spec-5-2's Boundaries):
 * `"money_added"` traces back to its own `investment_transactions` row,
 * `"money_withdrawn"` to its own `withdrawal_transactions` row, and all three
 * of `"moved_to_project"`/`"given_to_person"`/`"added_to_available_balance"`
 * (which all originate from one `withdrawal_destination_allocations` leg,
 * disambiguated only by `destinationType` -- `money-history.ts`'s own
 * `buildWithdrawalDestinationAllocationEntries`) trace back to that same leg,
 * `"used_from_available_balance"` to its own `available_balance_spends` row.
 * The `Record<MoneyHistoryEntryType, MoneyTrailNodeType>` shape forces this
 * to stay exhaustive against `packages/types`'s union at compile time,
 * mirroring the Money History page's own `ENTRY_TYPE_LABELS` precedent.
 */
export const MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE: Record<MoneyHistoryEntryType, MoneyTrailNodeType> = {
  money_added: "investment_transaction",
  money_withdrawn: "withdrawal_transaction",
  moved_to_project: "withdrawal_destination_allocation",
  given_to_person: "withdrawal_destination_allocation",
  added_to_available_balance: "withdrawal_destination_allocation",
  used_from_available_balance: "available_balance_spend",
};

/** The `{ type, id }` starting point `GET /api/money-trail` needs to trace `entry` -- `entry.id` is always the originating row's own id (`MoneyHistoryEntry`'s own doc comment), so no further lookup is needed beyond the type mapping above. */
export function getTrailStartFromEntry(entry: MoneyHistoryEntry): { type: MoneyTrailNodeType; id: string } {
  return { type: MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE[entry.type], id: entry.id };
}

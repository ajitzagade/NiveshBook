import type { AvailableBalanceSpend, InvestmentTransaction, MoneyMovement } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Available Balance screen (Story
 * 4.9, FR29) -- mirrors `apps/web/lib/withdrawal-destination-allocations.ts`'s
 * pattern one story over. `import type` only from `@niveshbook/types` (never
 * a runtime import from `@niveshbook/core`) -- this file is imported by a
 * "use client" page, and `@niveshbook/core` has no subpath exports (a
 * runtime import pulls in the whole barrel, including `auth.ts`'s `argon2`
 * dependency, breaking `next build`).
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface AvailableBalanceSubPartnerEntry {
  subPartnerId: string;
  name: string;
  sharePercent: string;
  balance: string;
}

export interface AvailableBalancePartnerEntry {
  partnerId: string;
  name: string;
  sharePercent: string;
  balance: string;
  subPartners: AvailableBalanceSubPartnerEntry[];
}

export interface ListAvailableBalancesResponse {
  partners: AvailableBalancePartnerEntry[];
}

export interface SpendAvailableBalanceInput {
  partyType: "partner" | "sub_partner";
  shareId: string;
  destinationType: "project" | "person";
  /** Raw, unvalidated -- the server re-validates via `toMoney`/a non-zero check. */
  amount: string;
  notes: string | null;
  /** Required (non-empty) only when `destinationType === "project"`. */
  destinationProjectId: string | null;
  /** Required (non-empty) only when `destinationType === "project"`. */
  destinationRequirementId: string | null;
  /** Required (non-empty) only when `destinationType === "project"`. */
  destinationShareId: string | null;
  /** Required only when `destinationType === "project"`. */
  destinationPartyType: "partner" | "sub_partner" | null;
  /** Required (non-empty) only when `destinationType === "person"`. */
  personName: string | null;
}

export interface SpendAvailableBalanceResponse {
  spend: AvailableBalanceSpend;
  /** Non-null only for a `"project"` spend. */
  investmentTransaction: InvestmentTransaction | null;
  /** Non-null only for a `"project"` spend. */
  moneyMovement: MoneyMovement | null;
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

/** Every current Partner/Sub-partner's Available Balance for one Project (Story 4.9, FR29). */
export async function listAvailableBalances(projectId: string): Promise<ListAvailableBalancesResponse> {
  const response = await fetch(`/api/projects/${projectId}/available-balance`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as ListAvailableBalancesResponse;
}

/**
 * Spends part/all of one Partner/Sub-partner's Available Balance (Story 4.9,
 * FR29, AD-5). `idempotencyKey` is a required parameter, not generated
 * inside this function -- mirrors `recordDestinationAllocation`'s (Story
 * 4.7) identical caller-owns-the-key-lifecycle contract: mint one fresh
 * `crypto.randomUUID()` per *logical* spend attempt (when the dialog opens),
 * and pass that same key again on a retry of that same attempt.
 */
export async function spendAvailableBalance(
  projectId: string,
  input: SpendAvailableBalanceInput,
  idempotencyKey: string,
): Promise<SpendAvailableBalanceResponse> {
  const response = await fetch(`/api/projects/${projectId}/available-balance/spend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, idempotencyKey }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SpendAvailableBalanceResponse;
}

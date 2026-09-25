import type { AdjustmentNetting, InvestmentAdjustment, WithdrawalAdjustment } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Adjust Next Time page (Story 5.3,
 * FR33/FR34) -- mirrors `apps/web/lib/money-history.ts`'s pattern (not
 * Project-scoped) for the view, and `apps/web/lib/available-balances.ts`'s
 * `spendAvailableBalance`-style caller-owns-the-idempotency-key contract for
 * the netting write. `import type` only from `@niveshbook/types` (never a
 * runtime import from `@niveshbook/core`) -- this file is imported by a
 * "use client" page, and `@niveshbook/core` has no subpath exports.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** One `InvestmentAdjustment` row, enriched with the route-resolved display name/Project name (`GET /api/adjust-next-time`'s own response shape). */
export interface AdjustNextTimeInvestmentEntry extends InvestmentAdjustment {
  personName: string;
  projectName: string;
}

/** One `WithdrawalAdjustment` row, enriched the identical way one ledger over. */
export interface AdjustNextTimeWithdrawalEntry extends WithdrawalAdjustment {
  personName: string;
  projectName: string;
}

export interface AdjustNextTimeResponse {
  investmentAdjustments: AdjustNextTimeInvestmentEntry[];
  withdrawalAdjustments: AdjustNextTimeWithdrawalEntry[];
  /** `true` only for an `owner_admin` actor -- drives the page's "Net Adjustment" action visibility (a UX convenience; `POST /api/adjustment-nettings`'s own `authorizeScope()` is the real, authoritative gate either way). */
  canNet: boolean;
}

export interface RecordAdjustmentNettingInput {
  projectId: string;
  partyType: "partner" | "sub_partner";
  shareId: string;
  investmentRequirementId: string;
  /** Raw, unvalidated -- the server re-validates via `toMoney`. */
  amount: string;
  notes: string | null;
}

export interface RecordAdjustmentNettingResponse {
  netting: AdjustmentNetting;
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

/** The actor's own scoped Investment/Withdrawal Adjustment lists, plus `canNet` (Story 5.3). */
export async function getAdjustNextTime(): Promise<AdjustNextTimeResponse> {
  const response = await fetch("/api/adjust-next-time");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as AdjustNextTimeResponse;
}

/**
 * Records a netting action (Story 5.3, FR33/FR34, AD-4). `idempotencyKey` is
 * a required parameter, not generated inside this function -- mirrors
 * `spendAvailableBalance`'s identical caller-owns-the-key-lifecycle
 * contract: mint one fresh `crypto.randomUUID()` per *logical* netting
 * attempt (when the dialog opens), and pass that same key again on a retry
 * of that same attempt.
 */
export async function recordAdjustmentNetting(
  input: RecordAdjustmentNettingInput,
  idempotencyKey: string,
): Promise<RecordAdjustmentNettingResponse> {
  const response = await fetch("/api/adjustment-nettings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, idempotencyKey }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as RecordAdjustmentNettingResponse;
}

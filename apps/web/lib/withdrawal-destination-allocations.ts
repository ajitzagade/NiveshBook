import type { DestinationType, WithdrawalDestinationAllocation } from "@niveshbook/types";

/**
 * Thin client-side fetch helper for the Withdraw Money screen's "Where did
 * this money go?" destination-allocation dialog (Story 4.7, FR27) -- mirrors
 * `apps/web/lib/withdrawal-transactions.ts`'s pattern one story over.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface DestinationAllocationLegInput {
  destinationType: DestinationType;
  /** Raw, unvalidated -- the server re-validates via `toMoney`. */
  amount: string;
  /** Required (non-empty) only when `destinationType === "project"`. */
  destinationProjectId: string | null;
  /** Required (non-empty) only when `destinationType === "person"`. */
  personName: string | null;
  /** Required (non-empty) only when `destinationType === "other"` -- optional on any other leg. */
  notes: string | null;
}

export interface RecordDestinationAllocationResponse {
  allocations: WithdrawalDestinationAllocation[];
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

/**
 * Saves a withdrawal's full destination split in one call (Story 4.7,
 * AD-5/AD-6). `idempotencyKey` is a required parameter, not generated inside
 * this function -- mirrors `recordWithdrawalTransaction`'s (Story 4.2)
 * identical caller-owns-the-key-lifecycle contract: mint one fresh
 * `crypto.randomUUID()` per *logical* save attempt (when the destination
 * dialog opens), and pass that same key again on a retry of that same
 * attempt.
 */
export async function recordDestinationAllocation(
  projectId: string,
  transactionId: string,
  legs: readonly DestinationAllocationLegInput[],
  idempotencyKey: string,
): Promise<RecordDestinationAllocationResponse> {
  const response = await fetch(
    `/api/projects/${projectId}/withdrawal-transactions/${transactionId}/destination-allocations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legs, idempotencyKey }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as RecordDestinationAllocationResponse;
}

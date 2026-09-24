import type { WithdrawalTransaction } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Withdraw Money screen's Record
 * Withdrawal dialog and recorded-withdrawals display (Story 4.2) -- mirrors
 * `apps/web/lib/investment-transactions.ts`'s pattern one ledger over.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface RecordWithdrawalTransactionInput {
  partyType: "partner" | "sub_partner";
  shareId: string;
  /** `"0"` is explicitly allowed -- no forced withdrawal (this story's Decisions). */
  amount: string;
  /** Plain date, `YYYY-MM-DD`. */
  transactionDate: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
}

/** `GET /api/projects/[id]/withdrawal-transactions`'s response shape. */
export interface WithdrawalTransactionsResponse {
  transactions: WithdrawalTransaction[];
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

/** Fetches every withdrawal recorded against a Project (Story 4.2 -- new this round, closing Review Triage Log row 1: persists across reload, mirroring Add Money's `refresh()` pattern). */
export async function listWithdrawalTransactions(
  projectId: string,
): Promise<WithdrawalTransactionsResponse> {
  const response = await fetch(`/api/projects/${projectId}/withdrawal-transactions`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as WithdrawalTransactionsResponse;
}

/**
 * Records a Take Now withdrawal (Story 4.2, AD-5). `idempotencyKey` is a
 * required parameter, not generated inside this function -- the caller owns
 * the key's entire lifecycle: mint one fresh `crypto.randomUUID()` per
 * *logical* submission attempt (e.g. when the Record Withdrawal dialog
 * opens), and pass that *same* key again on a retry of that same attempt
 * (e.g. after a network failure). Only a genuinely new submission (dialog
 * closed and reopened, or after a successful save) should get a new key.
 * This function itself never generates or mutates the key -- two calls with
 * the same `idempotencyKey` are indistinguishable to the server from a
 * single double-submitted request, which is exactly the protection AD-5
 * describes. Mirrors `apps/web/lib/investment-transactions.ts`'s
 * `recordInvestmentTransaction` exactly, one ledger over.
 */
export async function recordWithdrawalTransaction(
  projectId: string,
  input: RecordWithdrawalTransactionInput,
  idempotencyKey: string,
): Promise<WithdrawalTransaction> {
  const response = await fetch(`/api/projects/${projectId}/withdrawal-transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, idempotencyKey }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as WithdrawalTransaction;
}

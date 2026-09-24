import type { InvestmentTransaction } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Add Money screen's Record Payment
 * dialog and recorded-payments display (Story 3.3) -- mirrors
 * `apps/web/lib/investment-requirements.ts`'s pattern.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface RecordInvestmentTransactionInput {
  partyType: "partner" | "sub_partner";
  shareId: string;
  /** `"0"` is explicitly allowed -- no minimum payment enforced (AC2). */
  amount: string;
  /** Plain date, `YYYY-MM-DD`. */
  transactionDate: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
}

/** `GET .../investment-requirements/[requirementId]/transactions`'s response shape. */
export interface InvestmentTransactionsResponse {
  transactions: InvestmentTransaction[];
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

export async function listInvestmentTransactions(
  projectId: string,
  requirementId: string,
): Promise<InvestmentTransactionsResponse> {
  const response = await fetch(
    `/api/projects/${projectId}/investment-requirements/${requirementId}/transactions`,
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as InvestmentTransactionsResponse;
}

/**
 * Records a Paid Now transaction (Story 3.3, AD-5). `idempotencyKey` is now
 * a required parameter, not generated inside this function -- the caller
 * owns the key's entire lifecycle: mint one fresh `crypto.randomUUID()` per
 * *logical* submission attempt (e.g. when the Record Payment dialog opens),
 * and pass that *same* key again on a retry of that same attempt (e.g. after
 * a network failure). Only a genuinely new submission (dialog closed and
 * reopened, or after a successful save) should get a new key. This function
 * itself never generates or mutates the key -- two calls with the same
 * `idempotencyKey` are indistinguishable to the server from a single
 * double-submitted request, which is exactly the protection AD-5/AC4
 * describe.
 */
export async function recordInvestmentTransaction(
  projectId: string,
  requirementId: string,
  input: RecordInvestmentTransactionInput,
  idempotencyKey: string,
): Promise<InvestmentTransaction> {
  const response = await fetch(
    `/api/projects/${projectId}/investment-requirements/${requirementId}/transactions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, idempotencyKey }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as InvestmentTransaction;
}

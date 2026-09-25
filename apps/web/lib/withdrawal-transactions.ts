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
  /**
   * Story 4.5 (FR25): set `true` only after the caller has confirmed the
   * distinct "Authorize Extra Withdrawal?" step -- passed through to the API
   * unchanged, never defaulted here. Omitted (or `false`) is only valid when
   * `amount` doesn't exceed the target's Can Take; the server's own
   * `assertExtraWithdrawalAuthorized` gate is the authoritative check either
   * way (defense in depth, not UI-trust).
   */
  extraWithdrawalAuthorized?: boolean;
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

export interface EditWithdrawalTransactionInput {
  /** `"0"` is explicitly allowed -- no forced withdrawal, mirrors create's rule. */
  amount: string;
  /** Plain date, `YYYY-MM-DD`. */
  transactionDate: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
  /** Optional -- `audit_log.reason`'s existing nullable design (Story 4.2). */
  reason: string | null;
}

/**
 * Edits a previously recorded withdrawal's mutable fields (Story 4.11,
 * AD-5) -- Owner/Admin-only. `idempotencyKey` mirrors
 * `recordWithdrawalTransaction`'s exact lifecycle contract one level over:
 * the caller mints one fresh key per *logical* edit attempt (e.g. when the
 * Edit Withdrawal dialog opens) and reuses that same key across a retry of
 * that same attempt. This function never generates or mutates the key.
 */
export async function editWithdrawalTransaction(
  projectId: string,
  transactionId: string,
  input: EditWithdrawalTransactionInput,
  idempotencyKey: string,
): Promise<WithdrawalTransaction> {
  const response = await fetch(
    `/api/projects/${projectId}/withdrawal-transactions/${transactionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, idempotencyKey }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as WithdrawalTransaction;
}

/** `POST .../withdrawal-transactions/[transactionId]/cancel`'s response shape (Story 4.11). */
export interface CancelWithdrawalTransactionResult {
  originalTransaction: WithdrawalTransaction;
  reversalTransaction: WithdrawalTransaction;
}

/**
 * Cancels/reverses a previously recorded withdrawal (Story 4.11, AD-5) --
 * Owner/Admin-only. `idempotencyKey` mirrors `editWithdrawalTransaction`'s
 * exact lifecycle contract one level over: the caller mints one fresh key
 * per *logical* cancel attempt (e.g. when the confirmation dialog opens) and
 * reuses that same key across a retry of that same attempt. This function
 * never generates or mutates the key.
 */
export async function cancelWithdrawalTransaction(
  projectId: string,
  transactionId: string,
  reason: string | null,
  idempotencyKey: string,
): Promise<CancelWithdrawalTransactionResult> {
  const response = await fetch(
    `/api/projects/${projectId}/withdrawal-transactions/${transactionId}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey, reason }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as CancelWithdrawalTransactionResult;
}

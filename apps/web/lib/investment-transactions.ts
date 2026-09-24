import type { AuditLogEntry, InvestmentTransaction } from "@niveshbook/types";

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

export interface EditInvestmentTransactionInput {
  /** `"0"` is explicitly allowed -- no minimum payment enforced, mirrors create's rule. */
  amount: string;
  /** Plain date, `YYYY-MM-DD`. */
  transactionDate: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
  /** Optional -- `audit_log.reason`'s existing nullable design (Story 3.3). */
  reason: string | null;
}

/** `GET .../transactions/[transactionId]/audit-log`'s response shape. */
export interface AuditLogResponse {
  entries: AuditLogEntry[];
}

/**
 * Edits a previously recorded transaction's mutable fields (Story 3.7,
 * AD-5) -- Owner/Admin-only. `idempotencyKey` mirrors
 * `recordInvestmentTransaction`'s exact lifecycle contract one level over:
 * the caller mints one fresh key per *logical* edit attempt (e.g. when the
 * Edit Payment dialog opens) and reuses that same key across a retry of
 * that same attempt. This function never generates or mutates the key.
 */
export async function editInvestmentTransaction(
  projectId: string,
  requirementId: string,
  transactionId: string,
  input: EditInvestmentTransactionInput,
  idempotencyKey: string,
): Promise<InvestmentTransaction> {
  const response = await fetch(
    `/api/projects/${projectId}/investment-requirements/${requirementId}/transactions/${transactionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, idempotencyKey }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as InvestmentTransaction;
}

/** `POST .../transactions/[transactionId]/cancel`'s response shape (Story 3.8, FR42). */
export interface CancelInvestmentTransactionResult {
  originalTransaction: InvestmentTransaction;
  reversalTransaction: InvestmentTransaction;
}

/**
 * Cancels/reverses a previously recorded transaction (Story 3.8, FR42, AD-5)
 * -- Owner/Admin-only. `idempotencyKey` mirrors `editInvestmentTransaction`'s
 * exact lifecycle contract one level over: the caller mints one fresh key
 * per *logical* cancel attempt (e.g. when the confirmation dialog opens) and
 * reuses that same key across a retry of that same attempt. This function
 * never generates or mutates the key.
 */
export async function cancelInvestmentTransaction(
  projectId: string,
  requirementId: string,
  transactionId: string,
  reason: string | null,
  idempotencyKey: string,
): Promise<CancelInvestmentTransactionResult> {
  const response = await fetch(
    `/api/projects/${projectId}/investment-requirements/${requirementId}/transactions/${transactionId}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey, reason }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as CancelInvestmentTransactionResult;
}

/** Fetches every audit-trail entry (the original `"create"` plus any `"edit"`s) for one transaction (Story 3.7). */
export async function getAuditLog(
  projectId: string,
  requirementId: string,
  transactionId: string,
): Promise<AuditLogResponse> {
  const response = await fetch(
    `/api/projects/${projectId}/investment-requirements/${requirementId}/transactions/${transactionId}/audit-log`,
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as AuditLogResponse;
}

/**
 * `POST .../withdrawal-transactions/batch`'s body shape -- a split
 * withdrawal: one party's one Take Now event, paid across multiple payment
 * methods. Mirrors `../shared.ts`'s `ValidWithdrawalTransactionBody`, with
 * `amount`/`paymentMode`/`referenceNumber`/`notes` replaced by `rows` (one
 * entry per payment method) and `idempotencyKey` identifying the whole
 * batch rather than a single row. `extraWithdrawalAuthorized` stays a
 * single, batch-level flag -- Story 4.5's gate is evaluated against the
 * SUM of every row's amount (the whole batch is one withdrawal event for
 * Can Take purposes), not per row. The actual field-level validation
 * happens inside `packages/core`'s `recordWithdrawalTransactionBatch`, not
 * this type guard -- this only rejects a structurally malformed body before
 * ever reaching the domain layer.
 */
export const INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with `partyType` ("partner" or "sub_partner"), a `shareId` string, a `transactionDate` string (YYYY-MM-DD), an `idempotencyKey` string, a `rows` array of at least one `{ amount, paymentMode, referenceNumber?, notes? }` object, and an optional `extraWithdrawalAuthorized` boolean.';

export interface ValidWithdrawalTransactionBatchRow {
  amount: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
}

export interface ValidWithdrawalTransactionBatchBody {
  partyType: "partner" | "sub_partner";
  shareId: string;
  transactionDate: string;
  rows: ValidWithdrawalTransactionBatchRow[];
  idempotencyKey: string;
  extraWithdrawalAuthorized?: boolean;
}

function isValidRow(row: unknown): row is ValidWithdrawalTransactionBatchRow {
  if (typeof row !== "object" || row === null) {
    return false;
  }
  const candidate = row as {
    amount?: unknown;
    paymentMode?: unknown;
    referenceNumber?: unknown;
    notes?: unknown;
  };
  if (typeof candidate.amount !== "string") {
    return false;
  }
  if (typeof candidate.paymentMode !== "string") {
    return false;
  }
  if (
    candidate.referenceNumber !== undefined &&
    candidate.referenceNumber !== null &&
    typeof candidate.referenceNumber !== "string"
  ) {
    return false;
  }
  if (candidate.notes !== undefined && candidate.notes !== null && typeof candidate.notes !== "string") {
    return false;
  }
  return true;
}

export function isValidWithdrawalTransactionBatchBody(
  body: unknown,
): body is ValidWithdrawalTransactionBatchBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as {
    partyType?: unknown;
    shareId?: unknown;
    transactionDate?: unknown;
    rows?: unknown;
    idempotencyKey?: unknown;
    extraWithdrawalAuthorized?: unknown;
  };

  if (candidate.partyType !== "partner" && candidate.partyType !== "sub_partner") {
    return false;
  }
  if (typeof candidate.shareId !== "string" || candidate.shareId.trim().length === 0) {
    return false;
  }
  if (typeof candidate.transactionDate !== "string") {
    return false;
  }
  if (!Array.isArray(candidate.rows) || candidate.rows.length === 0) {
    return false;
  }
  if (!candidate.rows.every(isValidRow)) {
    return false;
  }
  if (typeof candidate.idempotencyKey !== "string") {
    return false;
  }
  if (
    candidate.extraWithdrawalAuthorized !== undefined &&
    typeof candidate.extraWithdrawalAuthorized !== "boolean"
  ) {
    return false;
  }

  return true;
}

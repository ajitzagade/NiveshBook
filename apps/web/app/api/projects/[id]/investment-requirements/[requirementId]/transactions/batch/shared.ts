/**
 * `POST .../transactions/batch`'s body shape -- a split payment: one
 * party's one contribution, paid across multiple payment methods. Mirrors
 * `../shared.ts`'s `ValidTransactionBody`, with `amount`/`paymentMode`/
 * `referenceNumber`/`notes` replaced by `rows` (one entry per payment
 * method) and `idempotencyKey` identifying the whole batch rather than a
 * single row. The actual field-level validation (amount format, date
 * format, payment mode membership, idempotency key presence, at-least-one-
 * row) happens inside `packages/core`'s `recordInvestmentTransactionBatch`,
 * not this type guard -- this only rejects a structurally malformed body
 * before ever reaching the domain layer.
 */
export const INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with `partyType` ("partner" or "sub_partner"), a `shareId` string, a `transactionDate` string (YYYY-MM-DD), an `idempotencyKey` string, and a `rows` array of at least one `{ amount, paymentMode, referenceNumber?, notes? }` object.';

export interface ValidTransactionBatchRow {
  amount: string;
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
}

export interface ValidTransactionBatchBody {
  partyType: "partner" | "sub_partner";
  shareId: string;
  transactionDate: string;
  rows: ValidTransactionBatchRow[];
  idempotencyKey: string;
}

function isValidRow(row: unknown): row is ValidTransactionBatchRow {
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

export function isValidTransactionBatchBody(body: unknown): body is ValidTransactionBatchBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as {
    partyType?: unknown;
    shareId?: unknown;
    transactionDate?: unknown;
    rows?: unknown;
    idempotencyKey?: unknown;
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

  return true;
}

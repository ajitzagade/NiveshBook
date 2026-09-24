import type { Money, PartnerShare, PaymentMode, Percent, SubPartnerShare } from "@niveshbook/types";
import { toMoney, InvalidMoneyError } from "./decimal-math";
import { computeCanTake } from "./can-take";
import type {
  CreateWithdrawalTransactionInput,
  RecordWithdrawalTransactionResult,
  WithdrawalTransactionPort,
} from "./withdrawal-transaction-port";

export interface WithdrawalTransactionDeps {
  withdrawalTransactions: WithdrawalTransactionPort;
}

export interface RecordWithdrawalTransactionInput {
  partyType: "partner" | "sub_partner";
  shareId: string;
  /** Raw, unvalidated -- `"0"` is explicitly accepted (this story's Decisions: no forced withdrawal). */
  amount: string;
  /** Raw, unvalidated `YYYY-MM-DD` string. */
  transactionDate: string;
  /** Raw, unvalidated -- must match one of `WITHDRAWAL_PAYMENT_MODES` after normalization. */
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
  /** Required, non-empty (this story's Decisions: `MissingIdempotencyKeyError` if absent). */
  idempotencyKey: string;
}

/**
 * Thrown when `amount` fails `decimal-math.ts`'s `toMoney` validation (not a
 * plain non-negative decimal string, or more than 2 decimal places).
 * Deliberately does **not** additionally require `> 0` on top of `toMoney`
 * -- "0" is a valid Take Now, no forced withdrawal (this story's Decisions).
 * This function/module still never caps `amount` against `canTakeSnapshot`
 * itself -- that enforcement lives one layer up, in the route's
 * `assertExtraWithdrawalAuthorized` gate (Story 4.5, FR25), which runs
 * *before* this function is ever called and rejects an over-cap amount
 * unless the request also carries Owner/Admin Extra Withdrawal
 * authorization; `recordWithdrawalTransaction`'s own signature/contract was
 * deliberately left unchanged by that story (Open/Closed), so a caller that
 * bypasses the route (e.g. a test calling this module directly) still sees
 * no cap here. Named `InvalidWithdrawalAmountError`, not
 * `InvalidTransactionAmountError` (`investment-transaction.ts` already
 * exports that exact name) -- so `packages/core/src/index.ts`'s two
 * `export *` statements never produce an ambiguous/dropped barrel export for
 * this symbol, mirroring `can-take.ts`'s identical local-error-renaming
 * precedent over `should-pay.ts`.
 */
export class InvalidWithdrawalAmountError extends Error {
  constructor() {
    super("Amount must be a non-negative number, with up to 2 decimal places.");
    this.name = "InvalidWithdrawalAmountError";
  }
}

/** Thrown when `transactionDate` isn't a well-formed `YYYY-MM-DD` calendar date -- mirrors `investment-transaction.ts`'s `InvalidTransactionDateError` pattern, renamed to avoid the identical barrel-export collision documented on `InvalidWithdrawalAmountError`. */
export class InvalidWithdrawalDateError extends Error {
  constructor() {
    super("Transaction date must be a valid date in YYYY-MM-DD format.");
    this.name = "InvalidWithdrawalDateError";
  }
}

/**
 * Every valid `PaymentMode`, matching `epic-3-context.md`'s UX list verbatim
 * -- `PaymentMode` itself (`packages/types`) is reused unchanged from Epic 3
 * (this story's Decisions, already generic, not investment-specific). Kept
 * as this module's own local copy (AD-9-compliant precedent, mirroring
 * `investment-transaction.ts`'s identical, deliberate duplication -- avoids
 * a `packages/core` -> `apps/web` dependency), not imported from
 * `investment-transaction.ts` -- Open/Closed, that module is already `done`.
 */
export const WITHDRAWAL_PAYMENT_MODES: readonly PaymentMode[] = [
  "cash",
  "cheque",
  "neft",
  "rtgs",
  "imps",
  "upi",
  "bank_transfer",
  "other",
];

const PAYMENT_MODE_SET: ReadonlySet<string> = new Set(WITHDRAWAL_PAYMENT_MODES);

/** Thrown when `paymentMode` doesn't match one of `WITHDRAWAL_PAYMENT_MODES` exactly. */
export class InvalidWithdrawalPaymentModeError extends Error {
  constructor() {
    super(`Payment mode must be one of: ${WITHDRAWAL_PAYMENT_MODES.join(", ")}.`);
    this.name = "InvalidWithdrawalPaymentModeError";
  }
}

/** Thrown when `idempotencyKey` is missing or whitespace-only (this story's Decisions: required, no default). */
export class MissingWithdrawalIdempotencyKeyError extends Error {
  constructor() {
    super("An idempotency key is required.");
    this.name = "MissingWithdrawalIdempotencyKeyError";
  }
}

/**
 * Thrown by `buildWithdrawalSnapshot` when `shareId` (combined with
 * `partyType`) doesn't match any Partner/Sub-partner in `computeCanTake`'s
 * result. The route layer maps this to 404 `not_found` -- in normal
 * operation the route has already independently confirmed the target share
 * exists (against the same fetched Partner/Sub-partner Shares) before ever
 * reaching this far, so this is a defense-in-depth check, not the primary
 * 404 path. Named `WithdrawalShareNotFoundError`, not `ShareNotFoundError`
 * (`investment-transaction.ts` already exports that exact name) -- mirrors
 * `InvalidWithdrawalAmountError`'s identical barrel-export-collision
 * rationale.
 */
export class WithdrawalShareNotFoundError extends Error {
  constructor() {
    super("No current Partner or Sub-partner Share matches the given shareId.");
    this.name = "WithdrawalShareNotFoundError";
  }
}

/**
 * Thrown by `packages/db`'s `createWithdrawalTransactionPort` when a row
 * already exists for the given `idempotencyKey` but doesn't match the
 * *current* request's `projectId`/`shareId`/`partyType`/`amount` -- i.e. a
 * genuine key collision between two unrelated requests, not a legitimate
 * replay of the same logical submission. `idempotency_key` is a table-wide
 * UNIQUE column, not scoped to a request's identity, so this defense-in-depth
 * check exists specifically so a collision can never silently return an
 * unrelated transaction's data (amount, snapshot values, notes) as if it
 * were a successful replay -- which would bypass `authorize()`'s check
 * (validated only against the *request's* target share, never the row
 * actually returned). The route layer maps this to 409
 * `idempotency_key_conflict`. Mirrors `investment-transaction.ts`'s
 * `IdempotencyKeyConflictError` exactly, but is its own local class (Story
 * 3.3 is already `done`, Open/Closed) -- named identically since
 * `packages/core/src/index.ts` cannot barrel-export two classes under the
 * same name; this module's own copy is the one actually thrown/caught by
 * this story's own code path (`packages/db`'s
 * `createWithdrawalTransactionPort`, this module's route callers).
 */
export class WithdrawalIdempotencyKeyConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used for a different withdrawal request -- generate a new key for this submission.",
    );
    this.name = "WithdrawalIdempotencyKeyConflictError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeAmount(raw: string): Money {
  try {
    return toMoney(raw);
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      throw new InvalidWithdrawalAmountError();
    }
    throw error;
  }
}

/** Mirrors `investment-transaction.ts`'s `normalizeTransactionDate` exactly, under this module's own error type -- rejects both malformed strings and well-shaped-but-invalid dates (e.g. `"2026-02-30"`). */
function normalizeTransactionDate(raw: string): string {
  const trimmed = raw.trim();
  if (!DATE_PATTERN.test(trimmed)) {
    throw new InvalidWithdrawalDateError();
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new InvalidWithdrawalDateError();
  }
  return trimmed;
}

function normalizePaymentMode(raw: string): PaymentMode {
  if (!PAYMENT_MODE_SET.has(raw)) {
    throw new InvalidWithdrawalPaymentModeError();
  }
  return raw as PaymentMode;
}

function normalizeIdempotencyKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingWithdrawalIdempotencyKeyError();
  }
  return trimmed;
}

/**
 * A blank/whitespace-only `referenceNumber`/`notes` is stored as `null`, not
 * `""` -- mirrors `investment-transaction.ts`'s `normalizeOptionalText`
 * exactly (this story's Decisions: applied from the start, not a
 * later patch round), so a future direct API caller bypassing
 * `withdraw-money/page.tsx`'s own pre-trim gets the same normalization, not
 * a raw `""` stored verbatim.
 */
function normalizeOptionalText(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface WithdrawalSnapshot {
  sharePercentSnapshot: Percent;
  canTakeSnapshot: Money;
}

/**
 * Re-runs Story 4.1's `computeCanTake` server-side to find the exact
 * `sharePercent`/`canTake` for the target Partner (`partyType: "partner"`)
 * or Sub-partner (`partyType: "sub_partner"`) identified by `shareId`,
 * snapshotted onto the withdrawal row at creation time (AD-3) -- never a
 * client-submitted value, and never recomputed later from the share's
 * current state. Lets `computeCanTake`'s own two precondition errors
 * (`PartnerSharesNotFullyAllocatedError`/`CanTakeSubPartnerSharesOverAllocatedError`)
 * propagate unchanged -- callers (the route layer) map both to 409,
 * mirroring Story 4.1's own route. Throws `WithdrawalShareNotFoundError` if
 * `shareId` doesn't match any Partner/Sub-partner in the computed tree.
 */
export function buildWithdrawalSnapshot(
  availableToWithdraw: Money,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
  partyType: "partner" | "sub_partner",
  shareId: string,
): WithdrawalSnapshot {
  const partners = computeCanTake(availableToWithdraw, partnerShares, subPartnerSharesByPartnerId);

  if (partyType === "partner") {
    const match = partners.find((partner) => partner.partnerId === shareId);
    if (!match) {
      throw new WithdrawalShareNotFoundError();
    }
    return { sharePercentSnapshot: match.sharePercent, canTakeSnapshot: match.canTake };
  }

  for (const partner of partners) {
    const match = partner.subPartners.find((sub) => sub.subPartnerId === shareId);
    if (match) {
      return { sharePercentSnapshot: match.sharePercent, canTakeSnapshot: match.canTake };
    }
  }
  throw new WithdrawalShareNotFoundError();
}

/**
 * Records a Take Now transaction: validates `amount`/`transactionDate`/
 * `paymentMode`/`idempotencyKey` (400-mappable errors), builds the Can Take
 * snapshot (409-mappable precondition errors reused from Story 4.1, or
 * `WithdrawalShareNotFoundError`), then calls the port -- whose
 * atomicity/idempotency contract is documented on
 * `WithdrawalTransactionPort.recordTransaction` itself. Callers must run
 * `authorize()` for `"withdrawal_transactions:create"` (self-access or
 * Owner/Admin) before calling this -- it performs no permission check of its
 * own (AD-1's gate lives at the route layer), and it never validates that
 * `shareId` belongs to *this* Project -- callers (the route handler) must
 * resolve and confirm that first, both to surface the 404 case and to
 * compute `authorize()`'s `resourceRef.ownerId`.
 */
export async function recordWithdrawalTransaction(
  projectId: string,
  availableToWithdraw: Money,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
  input: RecordWithdrawalTransactionInput,
  actorUserId: string,
  deps: WithdrawalTransactionDeps,
): Promise<RecordWithdrawalTransactionResult> {
  const amount = normalizeAmount(input.amount);
  const transactionDate = normalizeTransactionDate(input.transactionDate);
  const paymentMode = normalizePaymentMode(input.paymentMode);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const referenceNumber = normalizeOptionalText(input.referenceNumber);
  const notes = normalizeOptionalText(input.notes);

  const { sharePercentSnapshot, canTakeSnapshot } = buildWithdrawalSnapshot(
    availableToWithdraw,
    partnerShares,
    subPartnerSharesByPartnerId,
    input.partyType,
    input.shareId,
  );

  const portInput: CreateWithdrawalTransactionInput = {
    projectId,
    partyType: input.partyType,
    shareId: input.shareId,
    sharePercentSnapshot,
    canTakeSnapshot,
    amount,
    transactionDate,
    paymentMode,
    referenceNumber,
    notes,
    idempotencyKey,
    actorUserId,
  };

  return deps.withdrawalTransactions.recordTransaction(portInput);
}

/**
 * Lists every withdrawal recorded against one Project -- a thin
 * pass-through to the port, mirroring `listInvestmentTransactions` one
 * ledger over. Callers must run `authorizeScope()` for
 * `"withdrawal_transactions:list"` before calling this.
 */
export async function listWithdrawalTransactions(projectId: string, deps: WithdrawalTransactionDeps) {
  return deps.withdrawalTransactions.listByProjectId(projectId);
}

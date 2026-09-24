import type {
  InvestmentRequirement,
  Money,
  PartnerShare,
  PaymentMode,
  Percent,
  SubPartnerShare,
} from "@niveshbook/types";
import { toMoney, InvalidMoneyError } from "./decimal-math";
import { computeShouldPay } from "./should-pay";
import type {
  CreateInvestmentTransactionInput,
  InvestmentTransactionPort,
  RecordTransactionResult,
} from "./investment-transaction-port";

export interface InvestmentTransactionDeps {
  investmentTransactions: InvestmentTransactionPort;
}

export interface RecordInvestmentTransactionInput {
  partyType: "partner" | "sub_partner";
  shareId: string;
  /** Raw, unvalidated -- `"0"` is explicitly accepted (this story's Decisions: no minimum payment enforced). */
  amount: string;
  /** Raw, unvalidated `YYYY-MM-DD` string. */
  transactionDate: string;
  /** Raw, unvalidated -- must match one of `PAYMENT_MODES` after normalization. */
  paymentMode: string;
  referenceNumber: string | null;
  notes: string | null;
  /** Required, non-empty (this story's Decisions: `MissingIdempotencyKeyError` if absent). */
  idempotencyKey: string;
}

/**
 * Thrown when `amount` fails `decimal-math.ts`'s `toMoney` validation (not a
 * plain non-negative decimal string, or more than 2 decimal places).
 * Deliberately does **not** additionally require `> 0` on top of `toMoney` --
 * unlike `investment-requirement.ts`'s `InvalidRequirementAmountError` --
 * since AC2 explicitly requires `"0"` ("Paid Now") to be accepted, no
 * minimum payment enforced (this story's Decisions).
 */
export class InvalidTransactionAmountError extends Error {
  constructor() {
    super("Amount must be a non-negative number, with up to 2 decimal places.");
    this.name = "InvalidTransactionAmountError";
  }
}

/** Thrown when `transactionDate` isn't a well-formed `YYYY-MM-DD` calendar date -- mirrors `investment-requirement.ts`'s `InvalidRequirementDateError` pattern. */
export class InvalidTransactionDateError extends Error {
  constructor() {
    super("Transaction date must be a valid date in YYYY-MM-DD format.");
    this.name = "InvalidTransactionDateError";
  }
}

/**
 * Every valid `PaymentMode`, matching `epic-3-context.md`'s UX list verbatim
 * (this story's Decisions). The sole source of truth this module validates
 * `paymentMode` against -- `apps/web`'s route-level `shared.ts` keeps its own
 * `PAYMENT_MODES` list (for the Record Payment dialog's `<select>` options)
 * in sync via an exhaustive `Record<PaymentMode, string>`, not by importing
 * this constant, so `packages/core`'s dependency surface stays limited to
 * `packages/types` (AD-9).
 */
export const PAYMENT_MODES: readonly PaymentMode[] = [
  "cash",
  "cheque",
  "neft",
  "rtgs",
  "imps",
  "upi",
  "bank_transfer",
  "other",
];

const PAYMENT_MODE_SET: ReadonlySet<string> = new Set(PAYMENT_MODES);

/** Thrown when `paymentMode` doesn't match one of `PAYMENT_MODES` exactly. */
export class InvalidPaymentModeError extends Error {
  constructor() {
    super(`Payment mode must be one of: ${PAYMENT_MODES.join(", ")}.`);
    this.name = "InvalidPaymentModeError";
  }
}

/** Thrown when `idempotencyKey` is missing or whitespace-only (this story's Decisions: required, no default). */
export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super("An idempotency key is required.");
    this.name = "MissingIdempotencyKeyError";
  }
}

/**
 * Thrown by `buildTransactionSnapshot` when `shareId` (combined with
 * `partyType`) doesn't match any Partner/Sub-partner in `computeShouldPay`'s
 * result. The route layer maps this to 404 `not_found` -- in normal
 * operation the route has already independently confirmed the target share
 * exists (against the same fetched Partner/Sub-partner Shares) before ever
 * reaching this far, so this is a defense-in-depth check, not the primary
 * 404 path.
 */
export class ShareNotFoundError extends Error {
  constructor() {
    super("No current Partner or Sub-partner Share matches the given shareId.");
    this.name = "ShareNotFoundError";
  }
}

/**
 * Thrown by `packages/db`'s `createInvestmentTransactionPort` when a row
 * already exists for the given `idempotencyKey` but doesn't match the
 * *current* request's `requirementId`/`shareId`/`partyType`/`amount` -- i.e.
 * a genuine key collision between two unrelated requests, not a legitimate
 * replay of the same logical submission. `idempotency_key` is a table-wide
 * UNIQUE column, not scoped to a request's identity, so this defense-in-depth
 * check exists specifically so a collision can never silently return an
 * unrelated transaction's data (amount, snapshot values, notes) as if it
 * were a successful replay -- which would bypass `authorize()`'s check
 * (validated only against the *request's* target share, never the row
 * actually returned). The route layer maps this to 409
 * `idempotency_key_conflict`.
 */
export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used for a different payment request -- generate a new key for this submission.",
    );
    this.name = "IdempotencyKeyConflictError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeAmount(raw: string): Money {
  try {
    return toMoney(raw);
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      throw new InvalidTransactionAmountError();
    }
    throw error;
  }
}

/** Mirrors `investment-requirement.ts`'s `normalizeRequirementDate` exactly, under this module's own error type -- rejects both malformed strings and well-shaped-but-invalid dates (e.g. `"2026-02-30"`). */
function normalizeTransactionDate(raw: string): string {
  const trimmed = raw.trim();
  if (!DATE_PATTERN.test(trimmed)) {
    throw new InvalidTransactionDateError();
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new InvalidTransactionDateError();
  }
  return trimmed;
}

function normalizePaymentMode(raw: string): PaymentMode {
  if (!PAYMENT_MODE_SET.has(raw)) {
    throw new InvalidPaymentModeError();
  }
  return raw as PaymentMode;
}

function normalizeIdempotencyKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingIdempotencyKeyError();
  }
  return trimmed;
}

/**
 * A blank/whitespace-only `referenceNumber`/`notes` is stored as `null`, not
 * `""` -- mirrors `project.ts`'s `normalizeDescription` convention for the
 * identical "optional free-text field" shape. Applied here (not just at the
 * route layer) so a future direct API caller bypassing `add-money/page.tsx`'s
 * own pre-trim (Epic 5's planned self-service consumer) gets the same
 * normalization, not a raw `""` stored verbatim.
 */
function normalizeOptionalText(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface TransactionSnapshot {
  sharePercentSnapshot: Percent;
  shouldPaySnapshot: Money;
}

/**
 * Re-runs Story 3.2's `computeShouldPay` server-side to find the exact
 * `sharePercent`/`shouldPay` for the target Partner (`partyType: "partner"`)
 * or Sub-partner (`partyType: "sub_partner"`) identified by `shareId`,
 * snapshotted onto the transaction row at creation time (AD-3) -- never a
 * client-submitted Should Pay value, and never recomputed later from the
 * share's current state. Lets `computeShouldPay`'s own two precondition
 * errors (`SharesNotFullyAllocatedError`/`SubPartnerSharesOverAllocatedError`)
 * propagate unchanged -- callers (the route layer) map both to 409,
 * mirroring Story 3.2's own route. Throws `ShareNotFoundError` if `shareId`
 * doesn't match any Partner/Sub-partner in the computed tree.
 */
export function buildTransactionSnapshot(
  requirement: InvestmentRequirement,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
  partyType: "partner" | "sub_partner",
  shareId: string,
): TransactionSnapshot {
  const partners = computeShouldPay(requirement, partnerShares, subPartnerSharesByPartnerId);

  if (partyType === "partner") {
    const match = partners.find((partner) => partner.partnerId === shareId);
    if (!match) {
      throw new ShareNotFoundError();
    }
    return { sharePercentSnapshot: match.sharePercent, shouldPaySnapshot: match.shouldPay };
  }

  for (const partner of partners) {
    const match = partner.subPartners.find((sub) => sub.subPartnerId === shareId);
    if (match) {
      return { sharePercentSnapshot: match.sharePercent, shouldPaySnapshot: match.shouldPay };
    }
  }
  throw new ShareNotFoundError();
}

/**
 * Records a Paid Now transaction: validates `amount`/`transactionDate`/
 * `paymentMode`/`idempotencyKey` (400-mappable errors), builds the Should
 * Pay snapshot (409-mappable precondition errors reused from Story 3.2, or
 * `ShareNotFoundError`), then calls the port -- whose atomicity/idempotency
 * contract is documented on `InvestmentTransactionPort.recordTransaction`
 * itself. Callers must run `authorize()` for `"investment_transactions:create"`
 * (self-access or Owner/Admin) before calling this -- it performs no
 * permission check of its own (AD-1's gate lives at the route layer), and it
 * never validates that `shareId` belongs to *this* Project/requirement --
 * callers (the route handler) must resolve and confirm that first, both to
 * surface the 404 case and to compute `authorize()`'s `resourceRef.ownerId`.
 */
export async function recordInvestmentTransaction(
  projectId: string,
  requirementId: string,
  requirement: InvestmentRequirement,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
  input: RecordInvestmentTransactionInput,
  actorUserId: string,
  deps: InvestmentTransactionDeps,
): Promise<RecordTransactionResult> {
  const amount = normalizeAmount(input.amount);
  const transactionDate = normalizeTransactionDate(input.transactionDate);
  const paymentMode = normalizePaymentMode(input.paymentMode);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const referenceNumber = normalizeOptionalText(input.referenceNumber);
  const notes = normalizeOptionalText(input.notes);

  const { sharePercentSnapshot, shouldPaySnapshot } = buildTransactionSnapshot(
    requirement,
    partnerShares,
    subPartnerSharesByPartnerId,
    input.partyType,
    input.shareId,
  );

  const portInput: CreateInvestmentTransactionInput = {
    requirementId,
    projectId,
    partyType: input.partyType,
    shareId: input.shareId,
    sharePercentSnapshot,
    shouldPaySnapshot,
    amount,
    transactionDate,
    paymentMode,
    referenceNumber,
    notes,
    idempotencyKey,
    actorUserId,
  };

  return deps.investmentTransactions.recordTransaction(portInput);
}

/**
 * Lists every transaction recorded against one funding requirement -- a
 * thin pass-through to the port, mirroring `listInvestmentRequirements`.
 * Callers must run `authorizeScope()` for `"investment_transactions:list"`
 * before calling this.
 */
export async function listInvestmentTransactions(
  requirementId: string,
  deps: InvestmentTransactionDeps,
) {
  return deps.investmentTransactions.listByRequirementId(requirementId);
}

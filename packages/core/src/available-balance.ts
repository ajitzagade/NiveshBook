import type { Money } from "@niveshbook/types";
import { compareMoney } from "./decimal-math";

/**
 * Thrown when a debit against an `available_balances` row would take it
 * negative (Story 4.9, FR29, AD-10) -- the route layer maps this to `409
 * insufficient_balance` (this story's I/O matrix, AC3). Never thrown for
 * `currentBalance === spendAmount` (spending the *whole* balance is a valid,
 * ordinary debit -- only strictly exceeding it is rejected).
 */
export class InsufficientAvailableBalanceError extends Error {
  constructor(currentBalance: Money, spendAmount: Money) {
    super(
      `Cannot spend ${spendAmount} from an available balance of only ${currentBalance} -- insufficient balance.`,
    );
    this.name = "InsufficientAvailableBalanceError";
  }
}

/**
 * Thrown by `packages/db`'s `createAvailableBalanceSpendPort.recordSpend`
 * when a spend already exists for the given `idempotencyKey` but doesn't
 * match the *current* request's content -- a genuine key collision between
 * two unrelated requests, not a legitimate replay. Mirrors
 * `WithdrawalIdempotencyKeyConflictError`'s exact precedent one ledger over
 * (`available_balance_spends.idempotencyKey` is table-wide UNIQUE, like
 * `withdrawal_transactions.idempotencyKey`, unlike
 * `withdrawal_destination_allocations`' deliberately-non-unique column). The
 * route layer maps this to `409 idempotency_key_conflict`.
 */
export class AvailableBalanceSpendIdempotencyKeyConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used for a different Available Balance spend request -- generate a new key for this submission.",
    );
    this.name = "AvailableBalanceSpendIdempotencyKeyConflictError";
  }
}

/**
 * The sole authoritative check for whether a spend is covered by the
 * *current, row-locked* balance (this story's Boundaries: "never inferred
 * from a client-supplied 'current balance' figure") -- pure, `compareMoney`-
 * based (AD-2, never a raw `>`/`<` on the strings themselves). Throws
 * `InsufficientAvailableBalanceError` if `spendAmount` strictly exceeds
 * `currentBalance`; returns normally (no return value) otherwise, including
 * the exact-match case (spending the whole balance).
 *
 * Callers (`packages/db`'s `createAvailableBalancePort.debitBalance`) MUST
 * call this only after taking a `SELECT ... FOR UPDATE` row lock on the
 * balance row being debited (AD-10) -- this function itself has no way to
 * enforce that; it is pure arithmetic over whatever `currentBalance` it is
 * given.
 */
export function assertSufficientBalance(currentBalance: Money, spendAmount: Money): void {
  if (compareMoney(spendAmount, currentBalance) > 0) {
    throw new InsufficientAvailableBalanceError(currentBalance, spendAmount);
  }
}

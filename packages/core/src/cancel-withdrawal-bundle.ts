import type { WithdrawalDestinationAllocation, WithdrawalTransaction } from "@niveshbook/types";
import type { AvailableBalancePort } from "./available-balance-port";
import type { InvestmentTransactionPort } from "./investment-transaction-port";
import type { MoneyMovementPort } from "./money-movement-port";

/**
 * `cancelWithdrawalBundle()`'s own deps (Story 4.11) -- pure DI, mirrors
 * `MoveWithdrawalToProjectDeps`'s exact "ports as injected `deps`, zero
 * Drizzle imports" shape (AD-9), `Pick<>`-narrowed to exactly the methods
 * this orchestration needs (ISP, mirrors `MoneyTrailDeps`'s identical
 * `Pick<>`-narrowing precedent) -- never the whole `InvestmentTransactionPort`/
 * `AvailableBalancePort`/`MoneyMovementPort` interfaces.
 */
export interface CancelWithdrawalBundleDeps {
  moneyMovements: Pick<MoneyMovementPort, "findByWithdrawalDestinationAllocationId">;
  /**
   * Reused EXACTLY as-shipped (Story 3.8) -- this orchestration never adds
   * new cancel-shaped logic for a `"project"` leg's destination row, it only
   * calls this already-existing, unmodified port method (this story's
   * Boundaries/Code Map).
   */
  investmentTransactions: Pick<InvestmentTransactionPort, "cancelTransaction">;
  /**
   * Reused EXACTLY as-shipped (Story 4.9) -- `debitBalance`'s own
   * `InsufficientAvailableBalanceError` is deliberately let propagate
   * uncaught by this function (this story's Decisions #2): the caller
   * (`packages/db`'s `createWithdrawalTransactionPort.cancelTransaction`,
   * itself running inside one `database.transaction()`) lets that roll back
   * the ENTIRE cancellation -- nothing partially cancelled, the withdrawal
   * stays active.
   */
  availableBalances: Pick<AvailableBalancePort, "debitBalance">;
}

export interface CancelWithdrawalBundleResult {
  /**
   * The id of every destination `investment_transactions` row cancelled by
   * this call (one per `"project"` leg that had a linked `money_movements`
   * row) -- `[]` if the withdrawal had no `"project"` legs. Read by
   * `packages/db`'s `cancelTransaction` purely for its own logging/return
   * shape convenience; this orchestration itself never re-reads or acts on
   * this list.
   */
  cancelledInvestmentTransactionIds: string[];
}

/**
 * Cancels every linked leg of a withdrawal's destination allocation (Story
 * 4.11) -- the genuinely new cross-cutting concern this story adds beyond
 * mirroring Stories 3.7/3.8: unlike an investment transaction, a withdrawal
 * can already be the root of a linked bundle (Story 4.8's auto-created
 * destination `investment_transactions` + `money_movements`, Story 4.9's
 * Available Balance credit) -- cancelling it isn't a single-table operation,
 * it's a cascade. Pure DI orchestration (AD-9, mirrors `moveWithdrawalToProject()`'s
 * shape exactly) -- `packages/core` never imports Drizzle; `deps` are
 * already transaction-bound ports the caller constructed inside its own open
 * `database.transaction()`, so every write this function triggers commits or
 * rolls back atomically alongside the withdrawal's own status flip and
 * reversal-row insert (this story's Boundaries: one DB transaction, any
 * cascade step's failure rolls back everything, no partial cancel).
 *
 * For every leg in `legs` (this story's Decisions #1/#2/#3/#4), in this
 * exact order per leg, sequential -- never `Promise.all` (mirrors every
 * other in-transaction multi-port loop in this codebase, e.g.
 * `createWithdrawalDestinationAllocationPort.recordAllocation`'s own leg
 * loop -- a single open transaction/connection can't serve concurrent
 * queries):
 * - `"project"`: finds the leg's linked `money_movements` row (there is
 *   always exactly one, by construction -- Story 4.8), then calls
 *   `deps.investmentTransactions.cancelTransaction()` on the destination
 *   `investment_transactions` row it points at, with a derived idempotency
 *   key -- `` `${idempotencyKey}:cancel-cascade:${legIndex}` `` (`legIndex`
 *   being this leg's position in `legs`, mirroring Story 4.8's own
 *   `` `${idempotencyKey}:move:${legIndex}` `` derivation pattern exactly).
 *   If that destination row has itself already been further withdrawn from
 *   (Story 4.9's `can-take` fix, which clamps to `"0"` rather than
 *   throwing), that's already handled by the unchanged Can Take computation
 *   -- no new logic needed here either. A leg with no linked movement row
 *   (can't happen by construction, defense in depth only) is silently
 *   skipped.
 * - `"available_balance"`: attempts to reverse the credit by debiting the
 *   pool for exactly the amount this leg originally credited, via
 *   `deps.availableBalances.debitBalance({ projectId: withdrawal.projectId,
 *   partyType: withdrawal.partyType, shareId: withdrawal.shareId, amount:
 *   leg.amount })` -- the withdrawal's own `(partyType, shareId)` at its own
 *   SOURCE Project, mirroring exactly how `recordAllocation`'s own
 *   `"available_balance"` credit branch targeted this same tuple in the
 *   first place (spec-4-9's Decisions #1, this story's Decisions #2). If the
 *   pool's current balance is less than that amount (some or all of it was
 *   already spent onward, Story 4.9), `InsufficientAvailableBalanceError`
 *   propagates UNCAUGHT -- no new "undo a spend" capability is built by this
 *   story; Owner/Admin must resolve the downstream spend first.
 * - `"person"`/`"other"`: no action -- there is nothing to reverse for
 *   either leg type (a `"person"` leg's cash never touched a tracked ledger;
 *   `"other"` is a free-text record only).
 */
export async function cancelWithdrawalBundle(
  withdrawal: WithdrawalTransaction,
  legs: readonly WithdrawalDestinationAllocation[],
  idempotencyKey: string,
  actorUserId: string,
  deps: CancelWithdrawalBundleDeps,
): Promise<CancelWithdrawalBundleResult> {
  const cancelledInvestmentTransactionIds: string[] = [];

  for (let legIndex = 0; legIndex < legs.length; legIndex++) {
    const leg = legs[legIndex];
    if (!leg) continue;

    if (leg.destinationType === "project") {
      const movement = await deps.moneyMovements.findByWithdrawalDestinationAllocationId(leg.id);
      if (!movement) continue;
      const { originalTransaction } = await deps.investmentTransactions.cancelTransaction({
        transactionId: movement.destinationInvestmentTransactionId,
        idempotencyKey: `${idempotencyKey}:cancel-cascade:${legIndex}`,
        actorUserId,
        reason: null,
      });
      cancelledInvestmentTransactionIds.push(originalTransaction.id);
      continue;
    }

    if (leg.destinationType === "available_balance") {
      await deps.availableBalances.debitBalance({
        projectId: withdrawal.projectId,
        partyType: withdrawal.partyType,
        shareId: withdrawal.shareId,
        amount: leg.amount,
      });
      continue;
    }

    // "person"/"other": no action (this function's own doc comment above).
  }

  return { cancelledInvestmentTransactionIds };
}

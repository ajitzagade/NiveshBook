import type {
  InvestmentRequirement,
  InvestmentTransaction,
  Money,
  MoneyMovement,
  PartnerShare,
  SubPartnerShare,
} from "@niveshbook/types";
import { buildTransactionSnapshot } from "./investment-transaction";
import type { InvestmentTransactionPort } from "./investment-transaction-port";
import type { MoneyMovementPort } from "./money-movement-port";

export interface SpendAvailableBalanceToProjectDeps {
  investmentTransactions: InvestmentTransactionPort;
  moneyMovements: MoneyMovementPort;
}

export interface SpendAvailableBalanceToProjectResult {
  investmentTransaction: InvestmentTransaction;
  moneyMovement: MoneyMovement;
}

/**
 * Same rationale as `moveWithdrawalToProject()`'s identical local constant
 * one story over -- there is no natural caller-supplied "payment mode" for a
 * system-generated cross-project movement, so `"other"` (`PAYMENT_MODES`'
 * own catch-all) is reused rather than inventing a new value.
 */
const MOVEMENT_PAYMENT_MODE = "other";

/** `YYYY-MM-DD`, no time component -- mirrors `moveWithdrawalToProject()`'s identical local helper. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Auto-creates the destination-Project investment record for an "Invest in a
 * Project" Available Balance spend, plus the `money_movements` row linking
 * it back to the source (Story 4.9, FR29, AD-6) -- a new, additive
 * orchestration function (Open/Closed): mirrors `moveWithdrawalToProject()`'s
 * exact shape one story over (`buildTransactionSnapshot` -> `recordTransaction`
 * -> `moneyMovements.record(...)`), deliberately NOT sharing code with it (a
 * small, near-identical duplication, not a shared private helper -- see this
 * story's Implementation Notes for why) so `moveWithdrawalToProject()` itself
 * stays completely untouched, exactly as this story's Boundaries require.
 *
 * `deps.investmentTransactions`/`deps.moneyMovements` are already
 * transaction-bound ports (AD-6: this function accepts and participates in a
 * caller-supplied transaction, never opens its own). `derivedIdempotencyKey`
 * is the caller's responsibility to derive deterministically from the
 * spend's own `idempotencyKey` -- this function treats it as an opaque,
 * already-unique string, mirroring `moveWithdrawalToProject()`'s identical
 * contract. `moneyMovements.record(...)` is called with
 * `availableBalanceSpendId: spendId` and `withdrawalDestinationAllocationId:
 * null` (this story's Decisions #6 -- exactly one of the two is ever set).
 *
 * `buildTransactionSnapshot`'s own preconditions (`ShareNotFoundError`/
 * `SharesNotFullyAllocatedError`/`SubPartnerSharesOverAllocatedError`)
 * propagate unchanged -- the caller (`packages/db`'s
 * `createAvailableBalanceSpendPort.recordSpend`, itself running inside one
 * `database.transaction()`) lets that roll back the whole spend (this
 * story's Boundaries), the route layer mapping each to its own status code.
 */
export async function spendAvailableBalanceToProject(
  spendId: string,
  sourceProjectId: string,
  destinationProjectId: string,
  requirement: InvestmentRequirement,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
  targetPartyType: "partner" | "sub_partner",
  targetShareId: string,
  amount: Money,
  derivedIdempotencyKey: string,
  actorUserId: string,
  deps: SpendAvailableBalanceToProjectDeps,
): Promise<SpendAvailableBalanceToProjectResult> {
  const { sharePercentSnapshot, shouldPaySnapshot } = buildTransactionSnapshot(
    requirement,
    partnerShares,
    subPartnerSharesByPartnerId,
    targetPartyType,
    targetShareId,
  );

  const { transaction } = await deps.investmentTransactions.recordTransaction({
    requirementId: requirement.id,
    projectId: destinationProjectId,
    partyType: targetPartyType,
    shareId: targetShareId,
    sharePercentSnapshot,
    shouldPaySnapshot,
    amount,
    transactionDate: todayDateString(),
    paymentMode: MOVEMENT_PAYMENT_MODE,
    referenceNumber: null,
    notes: null,
    idempotencyKey: derivedIdempotencyKey,
    actorUserId,
  });

  const moneyMovement = await deps.moneyMovements.record({
    withdrawalDestinationAllocationId: null,
    availableBalanceSpendId: spendId,
    sourceProjectId,
    destinationProjectId,
    destinationInvestmentTransactionId: transaction.id,
    amount,
  });

  return { investmentTransaction: transaction, moneyMovement };
}

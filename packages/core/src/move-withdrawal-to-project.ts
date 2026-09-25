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

export interface MoveWithdrawalToProjectDeps {
  investmentTransactions: InvestmentTransactionPort;
  moneyMovements: MoneyMovementPort;
}

export interface MoveWithdrawalToProjectResult {
  investmentTransaction: InvestmentTransaction;
  moneyMovement: MoneyMovement;
}

/**
 * There is no natural caller-supplied "payment mode" for a system-generated
 * cross-project movement (unlike a manual Add Money entry) -- `"other"` is
 * `PAYMENT_MODES`' own catch-all entry, reused here rather than inventing a
 * new payment mode value the rest of the app would need to special-case.
 */
const MOVEMENT_PAYMENT_MODE = "other";

/** `YYYY-MM-DD`, no time component -- mirrors `investment-transaction.ts`'s own date-string shape, computed at call time since there is no caller-supplied transaction date for an auto-created movement. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Auto-creates the destination-Project investment record for a single
 * `"project"` destination-allocation leg, plus the `money_movements` row
 * linking it back to the source (Story 4.8, FR28, AD-6) -- a new, additive
 * orchestration function (Open/Closed): reuses `buildTransactionSnapshot`
 * (Story 3.2/3.3's exact function, unchanged) to compute
 * `sharePercentSnapshot`/`shouldPaySnapshot` from the *live*
 * `requirement`/`partnerShares`/`subPartnerSharesByPartnerId` given --
 * identically to how a manual Add Money entry would, never a new calculation
 * path. Lets `buildTransactionSnapshot`'s own preconditions
 * (`ShareNotFoundError`/`SharesNotFullyAllocatedError`/
 * `SubPartnerSharesOverAllocatedError`) propagate unchanged -- the caller
 * (`packages/db`'s `createWithdrawalDestinationAllocationPort.recordAllocation`,
 * itself running inside one `database.transaction()`) lets that roll back
 * the whole allocation batch (this story's Boundaries/AC3), the route layer
 * mapping each to its own status code (404/409) per this story's I/O matrix.
 *
 * `deps.investmentTransactions`/`deps.moneyMovements` are already
 * transaction-bound ports (AD-6's "accepts and participates in a
 * caller-supplied transaction" -- this function itself never opens one, it
 * only calls the ports it's given). `derivedIdempotencyKey` is the caller's
 * responsibility to derive deterministically from the allocation's own
 * shared `idempotencyKey` (this story's Decisions: `` `${idempotencyKey}:move:${legIndex}` ``)
 * -- this function treats it as an opaque, already-unique string, mirroring
 * `recordInvestmentTransaction`'s identical "idempotencyKey is caller-
 * supplied, this function just passes it through" contract. A replay of the
 * whole allocation batch deterministically replays the same derived key too,
 * so `deps.investmentTransactions.recordTransaction`'s own idempotency
 * contract (Story 3.3) is what actually prevents a duplicate
 * `investment_transactions` row on a genuine retry -- but in normal
 * operation `recordAllocation`'s own write-once/replay handling means this
 * function's single call site is only ever reached once per leg in the
 * first place (see `MoneyMovementPort.record`'s own doc comment).
 *
 * `transactionDate`/`paymentMode` have no caller-supplied equivalent here --
 * there is no natural "payment mode" for an automatic cross-project
 * movement -- so they default to today's date and `"other"`;
 * `referenceNumber`/`notes` are left `null`. The Add Money page's "Moved
 * from Project A" indicator (this story's Code Map) is derived from the
 * linked `money_movements` row itself, not from free text here.
 */
export async function moveWithdrawalToProject(
  allocationLegId: string,
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
  deps: MoveWithdrawalToProjectDeps,
): Promise<MoveWithdrawalToProjectResult> {
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
    withdrawalDestinationAllocationId: allocationLegId,
    sourceProjectId,
    destinationProjectId,
    destinationInvestmentTransactionId: transaction.id,
    amount,
  });

  return { investmentTransaction: transaction, moneyMovement };
}

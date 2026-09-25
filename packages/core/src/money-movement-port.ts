import type { Money, MoneyMovement } from "@niveshbook/types";

/**
 * Story 4.9 (FR29) widens this input: `withdrawalDestinationAllocationId`/
 * `availableBalanceSpendId` are both optional, exactly one expected to be
 * set per call -- non-breaking (existing `moveWithdrawalToProject()` callers
 * keep passing only `withdrawalDestinationAllocationId`, never touch the new
 * field; `spendAvailableBalanceToProject()` is the new, additive caller that
 * passes only `availableBalanceSpendId`). Mirrors `MoneyMovement`'s own
 * widened shape (`packages/types`).
 */
export interface CreateMoneyMovementInput {
  withdrawalDestinationAllocationId?: string | null;
  availableBalanceSpendId?: string | null;
  sourceProjectId: string;
  destinationProjectId: string;
  destinationInvestmentTransactionId: string;
  amount: Money;
}

/**
 * Port for reading/writing Money Movement rows (Story 4.8, FR28, AD-6) --
 * implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9).
 */
export interface MoneyMovementPort {
  /**
   * A plain, single-row insert -- no paired `audit_log` row of its own (see
   * `MoneyMovement`'s own doc comment in `packages/types` for why). Called
   * exactly once per `"project"` destination-allocation leg, only from
   * `moveWithdrawalToProject()`'s own single call site inside
   * `createWithdrawalDestinationAllocationPort.recordAllocation`'s genuine
   * (non-replay) write path -- that path is reached at most once per leg,
   * even under a concurrent double-submit race, because `recordAllocation`
   * serializes every concurrent attempt for the same withdrawal via its own
   * `SELECT ... FOR UPDATE` lock before ever reaching this call. This method
   * therefore needs no idempotency contract of its own.
   */
  record(input: CreateMoneyMovementInput): Promise<MoneyMovement>;
  /**
   * Every money movement whose `destinationProjectId` is `projectId`,
   * chronological (`createdAt` ascending) -- drives the Add Money page's
   * "Moved from Project A" indicator (this story's Code Map). `[]` if none.
   */
  listByDestinationProjectId(projectId: string): Promise<MoneyMovement[]>;
  /**
   * Story 4.10 (FR30): the movement whose `destinationInvestmentTransactionId`
   * is `investmentTransactionId`, or `null` if none -- at most one by
   * construction (each `investment_transactions` row is auto-created by at
   * most one `moveWithdrawalToProject()`/`spendAvailableBalanceToProject()`
   * call). Walks the trail *backward* from an auto-created destination
   * `investment_transaction` to the movement that created it.
   */
  findByDestinationInvestmentTransactionId(investmentTransactionId: string): Promise<MoneyMovement | null>;
  /**
   * Story 4.10 (FR30): the movement linked to one `"project"`
   * destination-allocation leg, or `null` if that leg never created one
   * (e.g. a leg that's `"person"`/`"available_balance"`/`"other"`) -- at
   * most one by construction (`moveWithdrawalToProject()`'s own single call
   * site). Walks the trail *forward* from a `withdrawal_destination_allocation`
   * leg to its linked movement.
   */
  findByWithdrawalDestinationAllocationId(allocationId: string): Promise<MoneyMovement | null>;
  /**
   * Story 4.10 (FR30): the movement linked to one Available Balance spend,
   * or `null` if that spend's `destinationType` wasn't `"project"` -- at
   * most one by construction (`spendAvailableBalanceToProject()`'s own
   * single call site). Walks the trail *forward* from an
   * `available_balance_spend` to its linked movement.
   */
  findByAvailableBalanceSpendId(spendId: string): Promise<MoneyMovement | null>;
}

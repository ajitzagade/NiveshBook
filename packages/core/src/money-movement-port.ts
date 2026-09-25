import type { Money, MoneyMovement } from "@niveshbook/types";

export interface CreateMoneyMovementInput {
  withdrawalDestinationAllocationId: string;
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
}

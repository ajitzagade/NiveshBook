import type { WithdrawalAdjustment, Money } from "@niveshbook/types";

export interface UpsertWithdrawalAdjustmentInput {
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this adjustment is keyed to -- never `User.id` (AD-4). */
  shareId: string;
  canTake: Money;
  taken: Money;
  adjustmentType: WithdrawalAdjustment["adjustmentType"];
  adjustmentAmount: Money;
}

/**
 * Port for reading/writing the Withdrawal Adjustment ledger (Story 4.3) --
 * implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9). Mirrors `InvestmentAdjustmentPort`'s
 * exact contract shape one ledger over -- deliberately narrower, since this
 * ledger has no `requirementId` column (Can Take is Project-scoped, not
 * per-funding-round, this story's Decisions).
 */
export interface WithdrawalAdjustmentPort {
  /**
   * Writes exactly one current row per `(partyType, shareId, projectId)` --
   * never a second row for the same person (this story's Boundaries). A
   * first call for a given key inserts a new row; every later call
   * overwrites that same row's `canTake`/`taken`/`adjustmentType`/
   * `adjustmentAmount`/`updatedAt` in place, keyed by the table's UNIQUE
   * `(partyType, shareId, projectId)` constraint. Re-viewing with no new
   * withdrawal transactions in between upserts the identical row (no
   * duplicate, no drift).
   */
  upsert(input: UpsertWithdrawalAdjustmentInput): Promise<WithdrawalAdjustment>;

  /**
   * Lists every current `(partyType, shareId)` adjustment row for a Project
   * -- a plain `WHERE project_id = ...` read, no reduction needed since this
   * table is already single-row-per-share by design. Mirrors
   * `InvestmentAdjustmentPort.listByProjectId`'s identical shape.
   */
  listByProjectId(projectId: string): Promise<WithdrawalAdjustment[]>;

  /**
   * Every current `(partyType, shareId, projectId)` adjustment row across
   * every Project, unfiltered, no pagination (Story 5.3, FR33/FR34) --
   * mirrors `InvestmentAdjustmentPort.listAll()`'s identical shape one
   * ledger over.
   */
  listAll(): Promise<WithdrawalAdjustment[]>;
}

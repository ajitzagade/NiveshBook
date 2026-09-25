import type { InvestmentAdjustment, Money } from "@niveshbook/types";

export interface UpsertInvestmentAdjustmentInput {
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this adjustment is keyed to -- never `User.id` (AD-4). */
  shareId: string;
  requirementId: string;
  shouldPay: Money;
  actualPaid: Money;
  adjustmentType: InvestmentAdjustment["adjustmentType"];
  adjustmentAmount: Money;
}

/**
 * Port for reading/writing the Investment Adjustment ledger (Story 3.4) --
 * implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9).
 */
export interface InvestmentAdjustmentPort {
  /**
   * Writes exactly one current row per `(partyType, shareId, projectId)` --
   * never a second row for the same person (this story's Boundaries). A
   * first call for a given key inserts a new row; every later call
   * overwrites that same row's `requirementId`/`shouldPay`/`actualPaid`/
   * `adjustmentType`/`adjustmentAmount`/`updatedAt` in place, keyed by the
   * table's UNIQUE `(partyType, shareId, projectId)` constraint. Re-viewing
   * the same requirement with no new transactions in between upserts the
   * identical row (no duplicate, no drift).
   */
  upsert(input: UpsertInvestmentAdjustmentInput): Promise<InvestmentAdjustment>;

  /**
   * Lists every current `(partyType, shareId)` adjustment row for a Project
   * (Story 3.5) -- a plain `WHERE project_id = ...` read, no reduction
   * needed since this table is already single-row-per-share by design.
   * Story 3.5's `POST .../investment-requirements` route calls this exactly
   * once per creation, at the one moment guaranteed race-free: the new
   * requirement doesn't exist yet, so nothing could have queried/overwritten
   * adjustments for it via `GET .../adjustments` before this read runs.
   */
  listByProjectId(projectId: string): Promise<InvestmentAdjustment[]>;

  /**
   * Every current `(partyType, shareId, projectId)` adjustment row across
   * every Project, unfiltered, no pagination (Story 5.3, FR33/FR34) --
   * mirrors `InvestmentTransactionPort.listAll()`'s identical Story 5.1
   * shape one ledger over. The Adjust Next Time page's own scope filter
   * (`packages/core`'s `filterAdjustNextTimeByScope`) is the sole consumer,
   * alongside `POST /api/adjustment-nettings`'s existence-check read via
   * `listByProjectId` (unchanged).
   */
  listAll(): Promise<InvestmentAdjustment[]>;
}

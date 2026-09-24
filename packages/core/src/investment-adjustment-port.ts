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
}

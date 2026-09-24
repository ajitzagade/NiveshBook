import type { Money, RecommendedAmount } from "@niveshbook/types";

export interface SnapshotRecommendedAmountInput {
  requirementId: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this snapshot is keyed to -- never `User.id` (AD-4). */
  shareId: string;
  baseAmount: Money;
  previousPending: Money;
  previousExtraPaid: Money;
  recommendedAmount: Money;
}

/**
 * Port for reading/writing the Recommended Amount snapshot (Story 3.5) --
 * implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9).
 */
export interface RecommendedAmountPort {
  /**
   * Writes every Recommended Amount row for one requirement-creation call
   * **atomically, all-or-nothing** -- `packages/db`'s implementation wraps
   * this in one `database.transaction(...)` call, mirroring Story 3.3's
   * `recordTransaction`'s multi-insert precedent. A requirement's snapshot
   * is written exactly once, at creation time (this story's Decisions), for
   * every current Partner/Sub-partner in a single call -- never a per-share
   * loop calling a single-row insert N times, which would leave a silent
   * partial snapshot committed if a write partway through failed (Review
   * Triage Log row 1). **Never an upsert** -- unlike
   * `InvestmentAdjustmentPort.upsert`, there is no "current row" to
   * overwrite here; the table's UNIQUE `(requirementId, partyType, shareId)`
   * constraint exists purely as a data-integrity guard against an
   * accidental double-snapshot, not as an upsert-conflict target. If the
   * write fails (for any reason), the caller (`POST .../investment-requirements`)
   * treats the entire snapshot as best-effort and swallows the error --
   * the already-created requirement's response is unaffected either way.
   */
  snapshotAll(inputs: readonly SnapshotRecommendedAmountInput[]): Promise<RecommendedAmount[]>;

  /**
   * Every Recommended Amount row snapshotted for one funding requirement --
   * a plain `WHERE requirement_id = ...` read, one row per current
   * Partner/Sub-partner at the moment the requirement was created. Returns
   * `[]` for a requirement created *before* this story shipped (this
   * story's Boundaries -- no retroactive snapshot), which the route layer's
   * `mergeRecommendedAmounts` treats identically to "no carry-forward yet".
   */
  findByRequirementId(requirementId: string): Promise<RecommendedAmount[]>;
}

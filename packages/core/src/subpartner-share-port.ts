import type { SubPartnerShare, Percent } from "@niveshbook/types";

export interface CreateSubPartnerShareInput {
  /** Stable across every version row for this Sub-partner -- generated once by `addSubPartnerShare`, reused by every subsequent `updateSubPartnerShare` version. */
  subPartnerId: string;
  /** The parent Partner's stable `partnerId` this Sub-partner's allocation is scoped to. */
  partnerId: string;
  projectId: string;
  name: string;
  sharePercent: Percent;
}

/**
 * Port for reading/writing Sub-partner Share *version* rows (Story 2.3).
 * Implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9). Mirrors
 * `packages/core/src/partner-share-port.ts`'s shape exactly, one level
 * down. There is no `updateSubPartnerShare` port method -- AD-3 means every
 * edit is a `createSubPartnerShare` call with the same `subPartnerId`,
 * never an in-place row update.
 */
export interface SubPartnerSharePort {
  /** Inserts a new version row -- used for both the first version (add) and every subsequent version (edit). */
  createSubPartnerShare(input: CreateSubPartnerShareInput): Promise<SubPartnerShare>;
  /** The most recent version row for a given `subPartnerId`, or `null` if that `subPartnerId` has no rows at all. */
  findLatestBySubPartnerId(subPartnerId: string): Promise<SubPartnerShare | null>;
  /** Every version row for one Partner's Sub-partners (all Sub-partners, all versions) -- callers reduce to latest-per-`subPartnerId` themselves. */
  listByPartnerId(partnerId: string): Promise<SubPartnerShare[]>;
}

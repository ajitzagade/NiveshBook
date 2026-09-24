import type { PartnerShare, Percent } from "@niveshbook/types";

export interface CreatePartnerShareInput {
  /** Stable across every version row for this Partner -- generated once by `addPartnerShare`, reused by every subsequent `updatePartnerShare` version. */
  partnerId: string;
  projectId: string;
  name: string;
  sharePercent: Percent;
  /** The `users.id` this Partner is linked to, or `null` -- already-resolved by the route layer (Story 2.4's Decisions); this port performs no email lookup of its own. */
  userId: string | null;
  /** Story 2.6: opt-in grant letting this Partner's own current Sub-partners see the Partner's total `sharePercent`. Always explicitly provided, full-overwrite every version -- mirrors `userId`'s convention. */
  subPartnerVisibilityGrant: boolean;
}

/**
 * Port for reading/writing Partner Share *version* rows (Story 2.2).
 * Implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9). Mirrors
 * `packages/core/src/project-port.ts`'s shape. There is no `updatePartnerShare`
 * port method -- AD-3 means every edit is a `createPartnerShare` call with
 * the same `partnerId`, never an in-place row update.
 */
export interface PartnerSharePort {
  /** Inserts a new version row -- used for both the first version (add) and every subsequent version (edit). */
  createPartnerShare(input: CreatePartnerShareInput): Promise<PartnerShare>;
  /** The most recent version row for a given `partnerId`, or `null` if that `partnerId` has no rows at all. */
  findLatestByPartnerId(partnerId: string): Promise<PartnerShare | null>;
  /** Every version row for a Project (all Partners, all versions) -- callers reduce to latest-per-`partnerId` themselves. */
  listByProjectId(projectId: string): Promise<PartnerShare[]>;
}

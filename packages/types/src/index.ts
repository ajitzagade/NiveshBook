export type UserRole = "owner_admin" | "partner" | "sub_partner" | "project_admin";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  /**
   * Grants Extra Withdrawal approval authority (FR25/FR45, Story 1.7). Only
   * meaningful for `owner_admin` — a distinct, revocable grant, not merely
   * "is this user `owner_admin`". Not yet enforced anywhere (Epic 4's Extra
   * Withdrawal flow is its first consumer).
   */
  canApproveExtraWithdrawal: boolean;
  /** ISO 8601 timestamp */
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  /** ISO 8601 timestamp */
  expiresAt: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * A Project (Epic 2, Story 2.1): created with just a Name and Description —
 * no partner information is required to save. `description` is nullable —
 * a Project can exist with none. Money/balance columns and Partner Share
 * data are added by later Epic 2/3/4 stories, not this type.
 */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * A validated, decimal-safe percentage value (AD-2), branded so a raw
 * `string` can never be assigned where a `Percent` is expected without
 * going through `packages/core/src/decimal-math.ts`'s `toPercent()` first.
 * Always `0 < x <= 100`, stored with up to 4 decimal places even though
 * only 2 are required by this story's UI (Epic 3's largest-remainder split
 * logic needs the extra precision). Never a native float.
 */
export type Percent = string & { readonly __brand: "Percent" };

/**
 * A Partner's Share % on a Project (Epic 2, Story 2.2). One row per
 * *version* of a Partner's share -- `sharePercent` is immutable once set
 * (AD-3): every edit creates a new row with a new `id`/`effectiveFrom`,
 * sharing the same stable `partnerId`. There is no separate `partners`
 * table -- a Partner exists only as a row (or row-history) here, keyed by
 * `partnerId`. Reduce all version rows for a Project down to the latest
 * `effectiveFrom` per `partnerId` to get the *current* Partner Shares
 * (`packages/core`'s `listCurrentPartnerShares`).
 */
export interface PartnerShare {
  id: string;
  /** Stable across every version row for the same Partner -- distinct from this row's own `id`. */
  partnerId: string;
  projectId: string;
  name: string;
  sharePercent: Percent;
  /**
   * The `users.id` this Partner is linked to, or `null` if unlinked (Epic 2,
   * Story 2.4) -- lets `authorize()`/`authorizeScope()` know "this session
   * IS this Partner", scoping the co-partner privacy boundary. Set via the
   * Add/Edit Partner dialog's "Linked user (email)" field, resolved at the
   * route layer (`apps/web`) -- never a separate lookup here.
   */
  userId: string | null;
  /**
   * Owner/Admin-toggled, opt-in grant (Epic 2, Story 2.6) letting this
   * Partner's own *current* Sub-partners see the Partner's total
   * `sharePercent` -- and nothing else (never `name`/`userId`/`id`/
   * `effectiveFrom`/`createdAt`). Full-overwrite on every save, mirroring
   * `userId`'s Story 2.4 convention -- not bound by AD-3's `sharePercent`-only
   * immutability rule, so an edit carries the current value forward rather
   * than requiring its own versioned history.
   */
  subPartnerVisibilityGrant: boolean;
  /** ISO 8601 timestamp -- when this version took effect. */
  effectiveFrom: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * A Sub-partner's Share % on a Project (Epic 2, Story 2.3) -- mirrors
 * `PartnerShare` exactly, one level down. One row per *version* of a
 * Sub-partner's share -- `sharePercent` is immutable once set (AD-3): every
 * edit creates a new row with a new `id`/`effectiveFrom`, sharing the same
 * stable `subPartnerId`. There is no separate `subpartners` table -- a
 * Sub-partner exists only as a row (or row-history) here, keyed by
 * `subPartnerId`, scoped to its parent Partner via `partnerId`.
 *
 * `sharePercent` is always a percentage of the *full Project* -- never a
 * percentage of the parent Partner's own `sharePercent` -- so it reads
 * identically to `PartnerShare.sharePercent` everywhere it's displayed.
 * Reduce all version rows for a Partner down to the latest `effectiveFrom`
 * per `subPartnerId` to get the *current* Sub-partner Shares
 * (`packages/core`'s `listCurrentSubPartnerShares`).
 */
export interface SubPartnerShare {
  id: string;
  /** Stable across every version row for the same Sub-partner -- distinct from this row's own `id`. */
  subPartnerId: string;
  /** The parent Partner's stable `partnerId` (from `partner_shares`) this Sub-partner's allocation is scoped to. */
  partnerId: string;
  projectId: string;
  name: string;
  sharePercent: Percent;
  /**
   * The `users.id` this Sub-partner is linked to, or `null` if unlinked
   * (Epic 2, Story 2.4) -- mirrors `PartnerShare.userId` one level down.
   */
  userId: string | null;
  /** ISO 8601 timestamp -- when this version took effect. */
  effectiveFrom: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

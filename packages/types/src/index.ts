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

/**
 * A validated, decimal-safe monetary value (AD-2), branded so a raw
 * `string` can never be assigned where a `Money` is expected without going
 * through `packages/core/src/decimal-math.ts`'s `toMoney()` first. Mirrors
 * `Percent`'s exact branding shape -- always non-negative, stored with up
 * to 2 decimal places, never a native float. Unlike `Percent`, there is no
 * upper bound and no `> 0` constraint baked into the type itself: `Money`'s
 * valid range differs by context (e.g. a funding requirement must be
 * positive, Story 3.3's Paid Now amount may legitimately be zero), so
 * callers enforce their own stricter rule on top of this type's universal
 * non-negative/2-decimal-place constraint.
 */
export type Money = string & { readonly __brand: "Money" };

/**
 * A funding round requested for a Project (Epic 3, Story 3.1) -- one row
 * per round, never versioned/edited like `PartnerShare` (a new funding
 * requirement is always a genuinely new row, not an edit of a prior one).
 * `requirementDate` is a single plain date (`YYYY-MM-DD`), not a separate
 * cycle-numbering entity. There is no update/delete endpoint for this
 * resource in this story.
 */
export interface InvestmentRequirement {
  id: string;
  projectId: string;
  amount: Money;
  /** Plain date, `YYYY-MM-DD` -- no time component. */
  requirementDate: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * How a recorded payment (Epic 3, Story 3.3) was made -- a fixed enum
 * matching epic-3-context.md's UX list verbatim. Stored as plain `text` in
 * Postgres (validated against this exact set by `packages/core`'s
 * `investment-transaction.ts`), never a DB-level enum type.
 */
export type PaymentMode =
  | "cash"
  | "cheque"
  | "neft"
  | "rtgs"
  | "imps"
  | "upi"
  | "bank_transfer"
  | "other";

/**
 * A recorded "Paid Now" payment against one funding requirement's Should Pay
 * for a specific Partner or Sub-partner (Epic 3, Story 3.3) -- one row per
 * recorded payment, never edited/versioned in this story (Stories 3.7/3.8
 * add edit/cancel later). `shareId` is `PartnerShare.partnerId` or
 * `SubPartnerShare.subPartnerId` -- the *stable* id shared across every
 * version row of that Partner/Sub-partner, never a version row's own `id`
 * and never `User.id` (AD-4) -- disambiguated by `partyType`. Not a foreign
 * key to either share table -- neither `partner_shares.partnerId` nor
 * `subpartner_shares.subPartnerId` has a uniqueness constraint to reference
 * (the same reason `subpartner_shares.partnerId` already isn't one).
 *
 * `sharePercentSnapshot`/`shouldPaySnapshot` are captured once, at creation
 * time, by re-running Story 3.2's `computeShouldPay` server-side -- never a
 * client-submitted value, and never recomputed later from the share's
 * current state (AD-3), so this row remains an accurate historical record
 * even after a Partner's `sharePercent` later changes.
 */
export interface InvestmentTransaction {
  id: string;
  requirementId: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this payment was recorded against -- see this type's own doc comment. */
  shareId: string;
  sharePercentSnapshot: Percent;
  shouldPaySnapshot: Money;
  /** "Paid Now" -- `toMoney()`'s baseline validation only, no `> 0` floor (this story's Decisions): `"0"` is explicitly accepted, no minimum payment enforced. */
  amount: Money;
  /** Plain date, `YYYY-MM-DD` -- no time component. */
  transactionDate: string;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  notes: string | null;
  /**
   * `"active"` (default) counts toward Paid Now; `"cancelled"` (Epic 3, Story
   * 3.8, FR42) never does -- set on the *original* row when it's cancelled,
   * and also on the newly-created *reversal* row itself (so neither ever
   * double-counts). Never hard-deleted either way -- `GET .../transactions`
   * still returns every row regardless of `status`.
   */
  status: "active" | "cancelled";
  /**
   * Present only on a reversal row (Story 3.8) -- the id of the *original*
   * transaction this row reverses. `null` on every other row, including a
   * cancelled original itself (the link is one-directional: the reversal
   * points at the original, never the reverse).
   */
  reversalOfTransactionId: string | null;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * The current Should Pay vs. Actual Paid gap for one Partner or Sub-partner
 * on a Project (Epic 3, Story 3.4) -- ONE current row per `(partyType,
 * shareId, projectId)` (AD-4: never `User.id`), not one row per funding
 * round. Upserted every time `GET .../adjustments` is viewed for a given
 * funding `requirementId` -- `requirementId` on this row always reflects the
 * *most recently viewed* round, ready for Story 3.5's carry-forward to read
 * as "previous" before the next round's view overwrites it.
 *
 * `shouldPay`/`actualPaid`/`adjustmentAmount` are all `Money` -- always
 * non-negative by construction (AD-2) -- so the sign of the gap lives in the
 * separate `adjustmentType` discriminator instead, mirroring Story 3.2's
 * `ownShouldPay`-never-negative precedent exactly: `"pending"` when Should
 * Pay exceeds Actual Paid, `"extra_paid"` when Actual Paid exceeds Should
 * Pay, `"none"` when they're exactly equal (`adjustmentAmount: "0"`).
 */
export interface InvestmentAdjustment {
  id: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this adjustment is keyed to -- never `User.id` (AD-4). */
  shareId: string;
  /** The funding requirement this row's numbers were last computed against. */
  requirementId: string;
  shouldPay: Money;
  /** Sum of every `InvestmentTransaction.amount` recorded against `requirementId` for this `(partyType, shareId)` -- `"0"` whether nothing was recorded yet or an explicit `"0"` transaction was. */
  actualPaid: Money;
  adjustmentType: "pending" | "extra_paid" | "none";
  /** Non-negative magnitude of the gap -- `"0"` when `adjustmentType` is `"none"`. */
  adjustmentAmount: Money;
  /** ISO 8601 timestamp -- when this row was last upserted. */
  updatedAt: string;
  /** ISO 8601 timestamp -- when this row was first created. */
  createdAt: string;
}

/**
 * A snapshotted Recommended Amount for one Partner or Sub-partner against
 * one funding requirement (Epic 3, Story 3.5) -- ONE row per `(requirementId,
 * partyType, shareId)`, written exactly once, at the requirement's creation
 * time (never upserted/overwritten) -- deliberately per-requirement, unlike
 * `InvestmentAdjustment`'s single-current-row-per-share design, since a
 * specific requirement's Recommended Amount must stay stable and readable
 * for as long as that requirement exists.
 *
 * `baseAmount` is this Partner/Sub-partner's Should Pay against the *new*
 * requirement (Story 3.2's `computeShouldPay`, run once at creation time).
 * `previousPending`/`previousExtraPaid` are copied from `InvestmentAdjustment`'s
 * still-intact current row at the exact moment of creation -- both `"0"` if
 * no prior adjustment row exists (first-ever requirement for the Project, or
 * a share with no prior adjustment). `recommendedAmount = baseAmount +
 * previousPending - previousExtraPaid`, clamped to a minimum of `"0"`
 * (`Money` itself forbids negative values, AD-2) -- never re-derived later
 * from `InvestmentAdjustment`, which is exactly what makes this snapshot
 * immune to Story 3.4's `GET .../adjustments` upserting that table on every
 * view.
 */
export interface RecommendedAmount {
  id: string;
  requirementId: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this snapshot is keyed to -- never `User.id` (AD-4). */
  shareId: string;
  baseAmount: Money;
  previousPending: Money;
  previousExtraPaid: Money;
  /** `baseAmount + previousPending - previousExtraPaid`, clamped to a minimum of `"0"` -- never negative (AD-2). */
  recommendedAmount: Money;
  /** ISO 8601 timestamp -- when this row was written (creation time only, never updated). */
  createdAt: string;
}

/**
 * One entry in the generic `audit_log` table (Epic 3, Story 3.3) -- a thin,
 * generic read type, deliberately entity-agnostic: `entityType`/`entityId`
 * together identify the row this entry is about (e.g. `entityType:
 * "investment_transaction"`, `entityId` = that row's `id`). `oldValue` is
 * `null` for a create-only entry (Story 3.3), populated for `"edit"` (Story
 * 3.7)/`"cancel"` (Story 3.8) entries with the full previous row as JSON;
 * `newValue` is always populated, with the full resulting row as JSON.
 * `reason` is nullable -- unused (`null`) by a `"create"` entry, optional on
 * an `"edit"`/`"cancel"` entry. `oldValue`/`newValue` are intentionally
 * untyped (`unknown`) rather than a specific entity's shape -- this table is
 * reused unchanged across every entity Epic 3/4 eventually audits (AD-5), so
 * this type can't assume any one entity's row shape.
 */
export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  /** ISO 8601 timestamp */
  createdAt: string;
}

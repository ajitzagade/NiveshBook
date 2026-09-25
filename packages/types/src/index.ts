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

/**
 * A recorded "Take Now" withdrawal against one Project's Can Take for a
 * specific Partner or Sub-partner (Epic 4, Story 4.2) -- one row per
 * recorded withdrawal, mirroring `InvestmentTransaction`'s exact shape
 * (Story 3.3) one ledger over: Project-scoped (no requirement-equivalent
 * entity, mirroring Story 4.1's Can Take, which is Project-scoped, not
 * per-funding-round), `partyType`/`shareId` disambiguated the identical way
 * (AD-4: `shareId` is `PartnerShare.partnerId` or `SubPartnerShare.subPartnerId`,
 * the *stable* id shared across every version row, never a version row's
 * own `id` and never `User.id`). Story 4.11 adds `status`/`reversalOfTransactionId`,
 * mirroring `InvestmentTransaction`'s identical Story 3.8 addition one
 * ledger over -- see that field's own doc comment below.
 *
 * `sharePercentSnapshot`/`canTakeSnapshot` are captured once, at creation
 * time, by re-running Story 4.1's `computeCanTake` server-side -- never a
 * client-submitted value, and never recomputed later from the share's
 * current state (AD-3), mirroring `shouldPaySnapshot`'s exact role one
 * ledger over -- needed by Story 4.3's later Withdrawal Adjustment
 * computation.
 */
export interface WithdrawalTransaction {
  id: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this withdrawal was recorded against -- see this type's own doc comment. */
  shareId: string;
  sharePercentSnapshot: Percent;
  canTakeSnapshot: Money;
  /** "Take Now" -- `toMoney()`'s baseline validation only, no `> 0` floor and no cap against `canTakeSnapshot` (this story's Decisions): `"0"` is explicitly accepted, and an amount exceeding Can Take is accepted as-is (no cap in this story). */
  amount: Money;
  /** Plain date, `YYYY-MM-DD` -- no time component. */
  transactionDate: string;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  notes: string | null;
  /**
   * `"active"` (default) is a live withdrawal; `"cancelled"` (Story 4.11)
   * marks a voided original (or its linked reversal row, which carries this
   * status too) -- set on the *original* row when it's cancelled, and also
   * on the newly-created *reversal* row itself, mirroring
   * `InvestmentTransaction.status`'s identical Story 3.8 column shape one
   * ledger over. Never hard-deleted either way.
   *
   * Unlike the investment side, this status is NOT currently excluded from
   * Taken/Withdrawal Adjustment (Story 4.3) -- `WithdrawalTransactionPort.sumActiveAmountByProjectId`
   * was deliberately left summing every row unconditionally, cancelled or
   * not, when this column was added (Story 4.11's own Implementation Notes:
   * extending Taken/Can Take to exclude cancelled withdrawals was judged out
   * of that story's frozen Code Map/Boundaries, a real product question left
   * for a future story to decide, not silently assumed here). A cancelled
   * withdrawal's amount DOES still count toward Taken today.
   */
  status: "active" | "cancelled";
  /**
   * Present only on a reversal row (Story 4.11) -- the id of the *original*
   * withdrawal this row reverses. `null` on every other row, including a
   * cancelled original itself (one-directional: the reversal points at the
   * original, never the reverse) -- mirrors `InvestmentTransaction.reversalOfTransactionId`
   * exactly.
   */
  reversalOfTransactionId: string | null;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * The Withdrawal Adjustment ledger row for one Partner or Sub-partner on one
 * Project (Epic 4, Story 4.3) -- ONE current row per `(partyType, shareId,
 * projectId)`, upserted every time it's viewed, mirroring `InvestmentAdjustment`'s
 * exact single-current-row shape one ledger over. Unlike `InvestmentAdjustment`
 * there is no `requirementId` column -- Can Take (Story 4.1) is Project-scoped
 * with no funding-round equivalent, so Withdrawal Adjustment mirrors that
 * scoping exactly (this story's Decisions).
 *
 * `canTake`/`taken`/`adjustmentAmount` are all `Money` -- always non-negative
 * by construction (AD-2) -- so the sign of the gap lives in the separate
 * `adjustmentType` discriminator instead, mirroring `InvestmentAdjustment`'s
 * `pending`/`extra_paid`/`none` three-way split exactly, renamed for this
 * ledger's own domain terms: `"keep_for_later"` when Can Take exceeds Taken,
 * `"extra_taken"` when Taken exceeds Can Take (accepted per Story 4.2's
 * no-cap decision -- Story 4.5 adds the authorization gate later, not this
 * computation), `"none"` when they're exactly equal (`adjustmentAmount: "0"`).
 */
export interface WithdrawalAdjustment {
  id: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this adjustment is keyed to -- never `User.id` (AD-4). */
  shareId: string;
  /** The live Can Take entitlement (Story 4.1) this row was last computed against. */
  canTake: Money;
  /** Sum of every `WithdrawalTransaction.amount` recorded for this `(partyType, shareId)` across the whole Project to date -- `"0"` whether nothing was recorded yet or an explicit `"0"` transaction was. */
  taken: Money;
  adjustmentType: "keep_for_later" | "extra_taken" | "none";
  /** Non-negative magnitude of the gap -- `"0"` when `adjustmentType` is `"none"`. */
  adjustmentAmount: Money;
  /** ISO 8601 timestamp -- when this row was last upserted. */
  updatedAt: string;
  /** ISO 8601 timestamp -- when this row was first created. */
  createdAt: string;
}

/**
 * Story 5.3 (FR33/FR34, AD-4): a pure AUDIT RECORD of an Owner/Admin's
 * explicit decision to net an amount between one person's `InvestmentAdjustment`
 * (at `investmentRequirementId`, a specific funding requirement) and their
 * `WithdrawalAdjustment` (at `projectId`) -- zero computed effect on either
 * ledger: neither `InvestmentAdjustment` nor `WithdrawalAdjustment` rows are
 * ever written to as a result of this record existing, staying exactly as
 * freshly computed from Should Pay/Can Take (spec-5-3's Decisions #1). This
 * record's only effect is existing, permanently, as a transparent, audited
 * fact -- visible in Money History as a `"adjustment"`-type entry (no linked
 * money movement to trace, `MoneyHistoryEntryType`'s own doc comment).
 *
 * `shareId`/`partyType` are the *stable* `PartnerShare.partnerId`/
 * `SubPartnerShare.subPartnerId` (disambiguated by `partyType`), never
 * `User.id` (AD-4) -- mirrors `InvestmentAdjustment.shareId`'s identical
 * convention. `investmentRequirementId` anchors this record to the specific
 * funding round netted (spec-5-3's Decisions #2: `investment_adjustments` is
 * keyed by `(partyType, shareId, projectId, requirementId)` -- a person can
 * have several across different funding rounds within one Project -- while
 * `withdrawal_adjustments` is Project-scoped only, so `projectId` alone
 * identifies which Withdrawal Adjustment row this netted against).
 */
export interface AdjustmentNetting {
  id: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this netting is about -- never `User.id` (AD-4). */
  shareId: string;
  /** The specific funding requirement whose Investment Adjustment this record netted against. */
  investmentRequirementId: string;
  /** The amount the Owner/Admin declared netted -- an explicit business decision, not itself re-derived from either adjustment's own gap. */
  amount: Money;
  notes: string | null;
  /** The Owner/Admin who performed this netting action. */
  actorUserId: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * Story 4.7 (Epic 4, FR27): the four places a withdrawn amount can be
 * allocated to in the "Where did this money go?" prompt -- "another
 * Project" (`"project"`), a free-text Person (`"person"`, no Person/contact
 * entity exists in this schema yet -- spec-4-7's Decisions), the running
 * `"available_balance"` ledger (Story 4.9), or a free-text `"other"`
 * description. Deliberately a plain string union, not richer per-type
 * payload shapes -- `WithdrawalDestinationAllocation` below carries every
 * type's optional fields on one row instead (mirrors `PartyType`'s identical
 * flat-union precedent).
 */
export type DestinationType = "project" | "person" | "available_balance" | "other";

/**
 * One destination leg of a withdrawal's post-withdrawal allocation (Story
 * 4.7, FR27) -- a single `WithdrawalTransaction` (Story 4.2) is split across
 * one or more of these rows, saved together in one atomic write (AD-5/AD-6),
 * reconciling to exactly `WithdrawalTransaction.amount`. Only the field(s)
 * matching `destinationType` are ever non-null: `destinationProjectId` for
 * `"project"`, `personName` for `"person"`; `notes` is nullable on every
 * `destinationType` (doubles as `"other"`'s primary free-text description,
 * and an optional annotation on any other leg -- this story's Decisions).
 * This story only *records* a `"project"`/`"available_balance"` leg --
 * `"project"`'s actual linked money-movement/investment record is Story
 * 4.8's job (`moveWithdrawalToProject()`), and `"available_balance"`'s
 * actual ledger credit is Story 4.9's job; neither exists yet.
 *
 * Story 4.8 (FR28) adds `destinationRequirementId`/`destinationShareId`/
 * `destinationPartyType`: populated only for a `"project"` leg -- the
 * destination Project's funding requirement and Partner/Sub-partner Share
 * chosen (mirroring how a manual Add Money entry already works) at
 * allocation time, driving the auto-created `investment_transactions` row's
 * snapshot. `null` for every other `destinationType`, and nullable/additive
 * on every pre-Story-4.8 row (existing rows are unaffected -- spec-4-8's
 * Decisions: a non-breaking migration).
 */
export interface WithdrawalDestinationAllocation {
  id: string;
  /** The `WithdrawalTransaction.id` this leg belongs to -- every leg of one save shares the same value. */
  withdrawalTransactionId: string;
  destinationType: DestinationType;
  amount: Money;
  /** Populated only when `destinationType === "project"` -- validated (Story 4.7) to differ from the withdrawal's own source Project. */
  destinationProjectId: string | null;
  /** Populated only when `destinationType === "person"` -- free-text, no Person/contact entity exists yet. */
  personName: string | null;
  notes: string | null;
  /** Story 4.8: populated only for a `"project"` leg -- the destination Project's funding requirement chosen at allocation time. */
  destinationRequirementId: string | null;
  /** Story 4.8: populated only for a `"project"` leg -- the stable `partnerId`/`subPartnerId` (disambiguated by `destinationPartyType`) of the Partner/Sub-partner Share chosen at the destination Project, never `User.id` (AD-4). */
  destinationShareId: string | null;
  /** Story 4.8: populated only for a `"project"` leg. */
  destinationPartyType: "partner" | "sub_partner" | null;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * One linking record created by `moveWithdrawalToProject()` for a `"project"`
 * destination-allocation leg (Story 4.8, FR28, AD-6) -- the middle link in
 * the `withdrawal_destination_allocations` leg -> `money_movements` ->
 * `investment_transactions` chain that makes the source side of a
 * cross-project movement reconstructable (spec-4-8's Decisions: linked to
 * the specific allocation *leg*, not directly to the withdrawal transaction,
 * since one withdrawal can have multiple `"project"` legs to different
 * destinations). Never edited/cancelled directly -- it lives and dies with
 * its parent allocation leg (`onDelete: "cascade"`, schema.ts).
 *
 * Story 4.9 (FR29) widens this to also link an `"available_balance"` spend's
 * own auto-created movement (`spendAvailableBalanceToProject()`, mirroring
 * `moveWithdrawalToProject()`'s identical shape one story over):
 * `withdrawalDestinationAllocationId` becomes nullable, and a new nullable
 * `availableBalanceSpendId` is added -- exactly one of the two is ever set on
 * a given row (this story's Decisions #6, non-breaking: every pre-4.9 row
 * keeps its non-null `withdrawalDestinationAllocationId` and a null
 * `availableBalanceSpendId`).
 */
export interface MoneyMovement {
  id: string;
  /** The `WithdrawalDestinationAllocation.id` (a single `"project"` leg) this movement links -- non-null only for an allocation-sourced movement, mutually exclusive with `availableBalanceSpendId`. */
  withdrawalDestinationAllocationId: string | null;
  /** Story 4.9: the `AvailableBalanceSpend.id` this movement links -- non-null only for a spend-sourced movement, mutually exclusive with `withdrawalDestinationAllocationId`. */
  availableBalanceSpendId: string | null;
  sourceProjectId: string;
  destinationProjectId: string;
  /** The auto-created `investment_transactions` row at the destination Project -- the same snapshot `buildTransactionSnapshot` would produce for a manual Add Money entry. */
  destinationInvestmentTransactionId: string;
  amount: Money;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * Story 4.9 (Epic 4, FR29): the running "Available Balance" ledger for one
 * `(partyType, shareId, projectId)` -- `projectId` being the *source* Project
 * a withdrawal's `"available_balance"` destination-allocation leg came from
 * (this story's Decisions #1: mirrors `WithdrawalAdjustment`'s exact
 * single-current-row-per-source-Project scoping, never a cross-Project
 * aggregate, never `User.id`-keyed -- AD-4). Credited by
 * `createWithdrawalDestinationAllocationPort.recordAllocation`'s
 * `"available_balance"` leg branch (atomic upsert, no explicit row lock
 * needed); debited by `createAvailableBalancePort.debitBalance` (`SELECT
 * ... FOR UPDATE` + `assertSufficientBalance`, AD-10). `balance` is always
 * `>= 0` (`CHECK` constraint, schema.ts, backstop only).
 */
export interface AvailableBalance {
  id: string;
  projectId: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this balance is keyed to -- never `User.id` (AD-4). */
  shareId: string;
  balance: Money;
  /** ISO 8601 timestamp -- when this row was last credited/debited. */
  updatedAt: string;
  /** ISO 8601 timestamp -- when this row was first created (first credit). */
  createdAt: string;
}

/**
 * Story 4.9 (Epic 4, FR29): one row per "Use Balance" spend
 * (`createAvailableBalanceSpendPort.recordSpend`) -- either `"project"`
 * ("Invest in a Project", via `spendAvailableBalanceToProject()`, mirroring
 * `WithdrawalDestinationAllocation`'s `"project"`-leg fields exactly) or
 * `"person"` ("Give to a Person", free-text `personName` only -- mirrors
 * Story 4.7's `"person"` leg, no Person/contact entity exists yet). Only the
 * field(s) matching `destinationType` are ever non-null, mirroring
 * `WithdrawalDestinationAllocation`'s identical convention.
 */
export interface AvailableBalanceSpend {
  id: string;
  /** The `AvailableBalance` row (via `(partyType, shareId, sourceProjectId)`) this spend debited. */
  sourceProjectId: string;
  partyType: "partner" | "sub_partner";
  shareId: string;
  destinationType: "project" | "person";
  /** Populated only when `destinationType === "project"`. */
  destinationProjectId: string | null;
  /** Populated only when `destinationType === "project"` -- the destination Project's funding requirement chosen at spend time. */
  destinationRequirementId: string | null;
  /** Populated only when `destinationType === "project"` -- the stable `partnerId`/`subPartnerId` (disambiguated by `destinationPartyType`) chosen at the destination Project, never `User.id` (AD-4). */
  destinationShareId: string | null;
  /** Populated only when `destinationType === "project"`. */
  destinationPartyType: "partner" | "sub_partner" | null;
  /** Populated only when `destinationType === "person"` -- free-text, no Person/contact entity exists yet. */
  personName: string | null;
  amount: Money;
  notes: string | null;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * Story 4.10 (FR30): the 7 node kinds `assembleMoneyTrail()` walks. The
 * first 5 mirror a real row of that name, linked by a real FK edge; the last
 * 2 are terminal, pool-level *references* -- not a specific row -- for the
 * two places the app has never earmarked a specific rupee to a specific
 * later transaction (spec-4-10's Decisions #3): a withdrawal's source
 * Project's pooled active-invested total (`"project_investment_pool"`), and
 * a party's pooled Available Balance for one Project
 * (`"available_balance_pool"`).
 */
export type MoneyTrailNodeType =
  | "investment_transaction"
  | "withdrawal_transaction"
  | "withdrawal_destination_allocation"
  | "money_movement"
  | "available_balance_spend"
  | "project_investment_pool"
  | "available_balance_pool";

/**
 * One node of the assembled trail (Story 4.10, FR30) -- recursive:
 * `upstream`/`downstream` are each an array of this same shape, walked
 * outward from the caller's starting node until every branch terminates at
 * either a true origin (empty `upstream`, e.g. a manually-recorded Add Money
 * `investment_transaction`) or a pool-reference leaf (both `upstream` and
 * `downstream` always `[]`, spec-4-10's Boundaries). `data` carries the
 * type-specific payload: the full underlying row for the five real-entity
 * node types, or a small pool-summary object for the two pool-reference node
 * types -- never a further list of every other transaction sharing that
 * pool (explicitly out of scope, spec-4-10's Decisions #3).
 */
export interface MoneyTrailNode {
  type: MoneyTrailNodeType;
  id: string;
  amount: Money;
  data:
    | InvestmentTransaction
    | WithdrawalTransaction
    | WithdrawalDestinationAllocation
    | MoneyMovement
    | AvailableBalanceSpend
    | { projectId: string; totalActiveInvested: Money }
    | { partyType: "partner" | "sub_partner"; shareId: string; projectId: string; balance: Money };
  upstream: MoneyTrailNode[];
  downstream: MoneyTrailNode[];
}

/**
 * One reconciliation failure (Story 4.10, FR30) -- `reconcileMoneyTrail()`
 * collects every one it finds across the whole assembled tree rather than
 * throwing on the first, so a caller can see every mismatch in one pass
 * (spec-4-10's Decisions #5).
 */
export interface MoneyTrailDiscrepancy {
  nodeType: MoneyTrailNodeType;
  nodeId: string;
  message: string;
}

/** The result of walking an assembled `MoneyTrailNode` tree and checking every sum invariant it implies (Story 4.10, FR30). */
export interface MoneyTrailReconciliationResult {
  reconciled: boolean;
  discrepancies: MoneyTrailDiscrepancy[];
}

/**
 * Story 5.1 (FR31): the plain-language kinds `assembleMoneyHistory()`
 * produces, one per source-row shape in the I/O matrix (spec-5-1).
 * `"other"`-destination legs/spends are labeled `"given_to_person"` too (no
 * 7th type invented) -- disambiguated by `to`/`notes` instead.
 *
 * Story 5.3 (FR33/FR34, AD-4) adds `"adjustment"` -- one entry per
 * `AdjustmentNetting` row, the audited netting-transaction type spec-5-1's
 * own comment above originally deferred to this story. Unlike every other
 * member, `"adjustment"` has no corresponding `MoneyTrailNodeType` (a
 * netting record has no linked money movement to trace -- nothing moved,
 * spec-5-3's Decisions #4): `apps/web/lib/money-history.ts`'s
 * `MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE` deliberately excludes this
 * key (`Record<Exclude<MoneyHistoryEntryType, "adjustment">, MoneyTrailNodeType>`),
 * and the Money History page omits the trace/click affordance for these rows
 * instead of mapping them to a wrong/synthetic trail node.
 */
export type MoneyHistoryEntryType =
  | "money_added"
  | "money_withdrawn"
  | "moved_to_project"
  | "given_to_person"
  | "added_to_available_balance"
  | "used_from_available_balance"
  | "adjustment";

/**
 * One row of the unified Money History list (Story 5.1, FR31) -- the plain-
 * language shape `assembleMoneyHistory()` (packages/core) produces from
 * every one of the 6 source tables it reads, per spec-5-1's I/O matrix.
 * `id` is the originating row's own id (never a synthetic composite key --
 * unlike `MoneyTrailNode`'s pool-reference nodes, every Money History entry
 * traces back to one real row). `shareId`/`partyType` identify whose money
 * this entry is about (AD-4: the stable `partnerId`/`subPartnerId`, never
 * `User.id`) -- used by `resolveMoneyHistoryScope()`'s scoping, not just
 * display. `from`/`to` are plain-language, already-resolved display strings
 * (a Project name, a person's name, or `"Available Balance"`) -- never a raw
 * id, so the UI never needs a second lookup to render them.
 */
export interface MoneyHistoryEntry {
  id: string;
  type: MoneyHistoryEntryType;
  /** Plain date, `YYYY-MM-DD` -- no time component, matching every source row's own `transactionDate`/`createdAt`-derived date. */
  date: string;
  projectId: string;
  projectName: string;
  partyType: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` this entry is about -- never `User.id` (AD-4). */
  shareId: string;
  /** Resolved display name for `(partyType, shareId)`, or `null` if the entry has no single Partner/Sub-partner owner (this story's I/O matrix has none such, but kept nullable to mirror `MoneyMovement`'s own conservative shape). */
  personName: string | null;
  amount: Money;
  paymentMode: PaymentMode | null;
  /** Plain-language source, e.g. a Project name or `"Available Balance"` -- `null` when the entry has no distinct "from" (e.g. a manual Add Money entry). */
  from: string | null;
  /** Plain-language destination, e.g. a Project name, a person's name, or `"Available Balance"` -- `null` when the entry has no distinct "to" (e.g. a plain Add Money/Withdraw entry). */
  to: string | null;
  notes: string | null;
  /**
   * Review round 2 (spec-5-1's Implementation Notes): `"active"`/`"cancelled"`,
   * threaded through from the underlying row's own `InvestmentTransaction.status`/
   * `WithdrawalTransaction.status` (Story 3.8/4.11) -- without this, a
   * cancelled transaction and its linked reversal render as pixel-identical,
   * unmarked duplicate rows (the same amount/date/paymentMode/shareId, only
   * `id`/`reversalOfTransactionId`/`idempotencyKey` differ, none of which
   * were otherwise exposed here). For a leg-derived entry
   * (`moved_to_project`/`given_to_person`/`added_to_available_balance`/the
   * `"other"`-shaped `given_to_person`), this is the PARENT withdrawal's own
   * `status` -- a cancel never touches `withdrawal_destination_allocations`/
   * `money_movements` rows directly (`WithdrawalTransactionPort.cancelTransaction`'s
   * own doc comment), so there is no separate "leg reversal," only "this
   * leg's parent withdrawal was voided." Always `"active"` for an
   * `available_balance_spends`-derived entry -- that table has no cancel
   * capability built anywhere in this codebase yet (a real, separately-logged
   * gap, not fixed by this field).
   */
  status: "active" | "cancelled";
  /**
   * Present only when this entry's own underlying row (or, for a leg-derived
   * entry, its PARENT withdrawal) is itself a reversal row -- mirrors
   * `InvestmentTransaction.reversalOfTransactionId`/`WithdrawalTransaction.reversalOfTransactionId`'s
   * one-directional "the reversal points at the original, never the reverse"
   * convention. Drives the established `StatusChip` "Cancelled (reversal)"
   * label (`RecordedPayments`/`RecordedWithdrawals`, Story 3.7/3.8/4.11) --
   * this story reuses that exact visual convention rather than inventing a
   * new one. Always `null` for an `available_balance_spends`-derived entry.
   */
  reversalOfTransactionId: string | null;
}

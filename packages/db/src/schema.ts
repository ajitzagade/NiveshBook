import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * `users` and `sessions` are the only tables this epic creates (further
 * entities belong to later epics). `role` gates access via `packages/core`'s
 * `authorize()`/`authorizeScope()` (Story 1.5).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
  // Story 1.7 (FR45): Extra Withdrawal approval authority — a distinct,
  // revocable grant, only meaningful for owner_admin. Defaults to true so
  // every existing/seeded owner_admin keeps their current de-facto full
  // authority; nothing changes in practice until Epic 4 enforces it.
  canApproveExtraWithdrawal: boolean("can_approve_extra_withdrawal").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Story 1.4 adds listSessionsByUser/deleteSessionById, both filtering
    // directly on user_id.
    index("sessions_user_id_idx").on(table.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

/**
 * Story 2.1 (Epic 2): a Project is created with just a name and description
 * -- no partner information is required to save. `description` is
 * nullable. Money/balance columns and Partner Share data belong to later
 * Epic 2/3/4 stories, not this table (see spec-2-1's Decisions).
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectRow = typeof projects.$inferSelect;

/**
 * Story 2.2 (Epic 2): one row per *version* of a Partner's Share % --
 * `sharePercent` is immutable once set (AD-3), so an edit always inserts a
 * new row rather than updating one in place. `partnerId` is the stable id
 * across every version of the same Partner (distinct from this row's own
 * `id`) -- there is no separate `partners` table. `numeric(7,4)` stores up
 * to 3 whole-number digits and 4 decimal places (0.0001-100.0000),
 * matching `decimal-math.ts`'s 4-decimal-place precision.
 */
export const partnerShares = pgTable(
  "partner_shares",
  {
    id: uuid("id").primaryKey(),
    partnerId: uuid("partner_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sharePercent: numeric("share_percent", { precision: 7, scale: 4 }).notNull(),
    // Story 2.4: nullable link to the `users` row this Partner corresponds
    // to, if any -- lets `authorize()`/`authorizeScope()` know "this session
    // IS Partner B". `ON DELETE SET NULL` so deleting a user never cascades
    // into losing Partner Share history. No uniqueness constraint (spec-2-4's
    // Decisions) -- nothing stops the same userId being linked more than
    // once. Not indexed -- this story's auth checks operate on already-
    // fetched rows, not a direct `userId` query.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Story 2.6: Owner/Admin-toggled, opt-in grant letting this Partner's own
    // *current* Sub-partners see the Partner's total `sharePercent` (and
    // nothing else -- never name/userId/id/effectiveFrom/createdAt).
    // Threads through `addPartnerShare`/`updatePartnerShare` exactly like
    // `userId` (full-overwrite every save) -- NOT bound by AD-3's
    // `sharePercent`-only immutability rule, so it carries forward on every
    // versioned edit without needing its own history mechanism.
    subPartnerVisibilityGrant: boolean("sub_partner_visibility_grant").notNull().default(false),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `listByProjectId` filters on project_id; `findLatestByPartnerId`
    // filters on partner_id -- both hit every version row for their key.
    index("partner_shares_project_id_idx").on(table.projectId),
    index("partner_shares_partner_id_idx").on(table.partnerId),
  ],
);

export type PartnerShareRow = typeof partnerShares.$inferSelect;

/**
 * Story 2.3 (Epic 2): one row per *version* of a Sub-partner's Share % --
 * mirrors `partner_shares` exactly, one level down. `sharePercent` is
 * immutable once set (AD-3), so an edit always inserts a new row rather
 * than updating one in place. `subPartnerId` is the stable id across every
 * version of the same Sub-partner (distinct from this row's own `id`) --
 * there is no separate `subpartners` table. `partnerId` scopes each row to
 * its parent Partner (from `partner_shares`) -- not a foreign key, since
 * `partner_shares` has no unique constraint on `partnerId` itself (it's a
 * stable id across version rows, not a row's own primary key). `numeric(7,4)`
 * stores up to 3 whole-number digits and 4 decimal places
 * (0.0001-100.0000), matching `decimal-math.ts`'s 4-decimal-place precision
 * -- this Sub-partner's `sharePercent` is always a percentage of the full
 * Project, identically to a Partner's, never a fraction of the parent
 * Partner's own share.
 */
export const subpartnerShares = pgTable(
  "subpartner_shares",
  {
    id: uuid("id").primaryKey(),
    subPartnerId: uuid("sub_partner_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sharePercent: numeric("share_percent", { precision: 7, scale: 4 }).notNull(),
    // Story 2.4: mirrors `partnerShares.userId` one level down -- the
    // `users` row this Sub-partner corresponds to, if any.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `listByPartnerId` filters on partner_id; `findLatestBySubPartnerId`
    // filters on sub_partner_id; `projectId` is indexed too, mirroring
    // `partner_shares`'s three access patterns one level down.
    index("subpartner_shares_project_id_idx").on(table.projectId),
    index("subpartner_shares_partner_id_idx").on(table.partnerId),
    index("subpartner_shares_sub_partner_id_idx").on(table.subPartnerId),
  ],
);

export type SubPartnerShareRow = typeof subpartnerShares.$inferSelect;

/**
 * Story 3.1 (Epic 3): one row per funding requirement -- never versioned
 * like `partner_shares`/`subpartner_shares` (AD-3 doesn't apply here); each
 * new funding round is a genuinely new row, never an edit of a prior one.
 * `numeric(14,2)` stores up to 12 whole-number digits and 2 decimal places,
 * matching `decimal-math.ts`'s `toMoney` precision -- no upper-bound
 * constraint is enforced at this layer either (mirrors `Money`'s own
 * decision not to cap the range, unlike `Percent`'s 100 cap). `date` (no
 * time component, string mode -- Drizzle's default) stores the plain
 * `YYYY-MM-DD` requirement date.
 */
export const investmentRequirements = pgTable(
  "investment_requirements",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    requirementDate: date("requirement_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `listByProjectId` filters on project_id -- this resource's only read pattern (no findLatest*, unlike the versioned share tables).
    index("investment_requirements_project_id_idx").on(table.projectId),
  ],
);

export type InvestmentRequirementRow = typeof investmentRequirements.$inferSelect;

/**
 * Story 3.3 (Epic 3): one row per recorded "Paid Now" payment against a
 * funding requirement's Should Pay for a specific Partner/Sub-partner --
 * never versioned/edited in this story (Stories 3.7/3.8 add edit/cancel
 * later, via their own migrations). `shareId` is the *stable*
 * `partner_shares.partnerId`/`subpartner_shares.subPartnerId` (disambiguated
 * by `partyType`), never this row's own `id` and never `users.id` (AD-4) --
 * deliberately **not** a foreign key, since neither `partner_shares` nor
 * `subpartner_shares` has a uniqueness constraint on that stable id to
 * reference (the same reason `subpartner_shares.partnerId` already isn't
 * one -- see that table's own doc comment above). `sharePercentSnapshot`/
 * `shouldPaySnapshot` mirror `partner_shares.sharePercent`/
 * `investment_requirements.amount`'s exact column shapes (`numeric(7,4)`/
 * `numeric(14,2)`) -- captured once at creation time (AD-3), never updated
 * afterward even if the underlying share later changes. `amount` has no
 * `> 0` floor at the DB layer either (mirrors `investment_requirements.amount`'s
 * own no-upper-bound precedent, one level down) -- `"0"` is a valid Paid Now
 * amount (this story's Decisions). `idempotencyKey` is UNIQUE at the DB
 * level (this story's Decisions) -- the actual double-submit protection
 * mechanism, not merely an application-layer check.
 *
 * Story 3.8 (FR42) adds `status`/`reversalOfTransactionId`: cancelling flips
 * an existing row's `status` to `'cancelled'` in place (every other field
 * untouched) and inserts a brand-new row -- the linked "reversal" -- carrying
 * the same `requirementId`/`projectId`/`partyType`/`shareId`/`paymentMode`/
 * `amount` as the original, `status: 'cancelled'` too, with
 * `reversalOfTransactionId` pointing back at the original row's `id`. Never a
 * `DELETE` -- both rows stay forever (this story's Boundaries). `status`
 * defaults `'active'` so every pre-Story-3.8 row (and every ordinary
 * create/edit) needs no migration-time backfill logic beyond the column
 * default. `reversalOfTransactionId` is nullable and self-referencing
 * (Drizzle's documented `AnyPgColumn`-typed callback form, since the table
 * can't reference its own not-yet-fully-defined `id` column directly) --
 * `null` on every row except a reversal row itself.
 */
export const investmentTransactions = pgTable(
  "investment_transactions",
  {
    id: uuid("id").primaryKey(),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => investmentRequirements.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partyType: text("party_type").notNull(),
    shareId: uuid("share_id").notNull(),
    sharePercentSnapshot: numeric("share_percent_snapshot", { precision: 7, scale: 4 }).notNull(),
    shouldPaySnapshot: numeric("should_pay_snapshot", { precision: 14, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    transactionDate: date("transaction_date").notNull(),
    paymentMode: text("payment_mode").notNull(),
    referenceNumber: text("reference_number"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull().default("active"),
    reversalOfTransactionId: uuid("reversal_of_transaction_id").references(
      (): AnyPgColumn => investmentTransactions.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `listByRequirementId` filters on requirement_id -- this resource's
    // primary read pattern. `(shareId, projectId)` is indexed per AD-4 for
    // a person's eventual own-history lookup (Epic 5), even though nothing
    // in this story queries by it yet.
    index("investment_transactions_requirement_id_idx").on(table.requirementId),
    index("investment_transactions_share_id_project_id_idx").on(table.shareId, table.projectId),
    // Story 3.8: `cancelTransaction`'s idempotent-replay/concurrent-race
    // recovery paths look up a reversal row by its `reversalOfTransactionId`.
    index("investment_transactions_reversal_of_transaction_id_idx").on(
      table.reversalOfTransactionId,
    ),
    // Story 4.1: `sumActiveAmountByProjectId` filters on exactly
    // `(projectId, status)` -- `investment_transactions_share_id_project_id_idx`
    // above has `shareId` as its leading column, so it can't serve a
    // project-only query. `projectId` leads (not `status`) since it's the
    // more selective column and the sole equality filter in every other
    // query against this table.
    index("investment_transactions_project_id_status_idx").on(table.projectId, table.status),
  ],
);

export type InvestmentTransactionRow = typeof investmentTransactions.$inferSelect;

/**
 * Story 3.4 (Epic 3): ONE current row per `(partyType, shareId, projectId)`
 * (AD-4: never `users.id`) -- never one row per funding round. Every write
 * is an upsert keyed by the table's UNIQUE `(partyType, shareId, projectId)`
 * constraint below (Drizzle's `onConflictDoUpdate`, `packages/db/src/ports.ts`'s
 * `createInvestmentAdjustmentPort`), so `requirementId`/`shouldPay`/
 * `actualPaid`/`adjustmentAmount`/`adjustmentType` always reflect the
 * *most recently viewed* funding round for that person -- exactly what
 * Story 3.5's carry-forward needs to read as "previous" before the next
 * round's view overwrites it. `shareId` mirrors `investment_transactions.shareId`'s
 * precedent exactly: the *stable* `partner_shares.partnerId`/
 * `subpartner_shares.subPartnerId` (disambiguated by `partyType`), never
 * this row's own `id` and never `users.id` -- deliberately **not** a foreign
 * key, for the identical reason neither share table has a uniqueness
 * constraint on that stable id to reference. `shouldPay`/`actualPaid`/
 * `adjustmentAmount` are `numeric(14,2)`, matching `investment_requirements.amount`'s
 * precision -- always non-negative by construction (AD-2); the gap's sign
 * lives in `adjustmentType` (`"pending" | "extra_paid" | "none"`) instead.
 */
export const investmentAdjustments = pgTable(
  "investment_adjustments",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partyType: text("party_type").notNull(),
    shareId: uuid("share_id").notNull(),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => investmentRequirements.id, { onDelete: "cascade" }),
    shouldPay: numeric("should_pay", { precision: 14, scale: 2 }).notNull(),
    actualPaid: numeric("actual_paid", { precision: 14, scale: 2 }).notNull(),
    adjustmentAmount: numeric("adjustment_amount", { precision: 14, scale: 2 }).notNull(),
    adjustmentType: text("adjustment_type").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The single-row-per-person guarantee (this story's Boundaries) -- the
    // actual upsert-conflict target `createInvestmentAdjustmentPort` targets,
    // not merely an application-layer check.
    unique("investment_adjustments_party_share_project_unique").on(
      table.partyType,
      table.shareId,
      table.projectId,
    ),
  ],
);

export type InvestmentAdjustmentRow = typeof investmentAdjustments.$inferSelect;

/**
 * Story 3.5 (Epic 3): one row per `(requirementId, partyType, shareId)` --
 * deliberately per-requirement, unlike `investment_adjustments`' single-
 * current-row design, since a specific requirement's Recommended Amount
 * must stay stable and readable for as long as that requirement exists, not
 * get overwritten by a later one. Written exactly once, by
 * `packages/db/src/ports.ts`'s `createRecommendedAmountPort.snapshot` --
 * **never an upsert** -- immediately after `POST .../investment-requirements`
 * creates the requirement (the one moment guaranteed race-free: nothing
 * could have queried/overwritten `investment_adjustments` for a requirement
 * that doesn't exist yet). `shareId` mirrors `investment_adjustments.shareId`'s
 * precedent exactly: the *stable* `partner_shares.partnerId`/
 * `subpartner_shares.subPartnerId`, never this row's own `id` and never
 * `users.id` (AD-4) -- deliberately **not** a foreign key, for the identical
 * reason neither share table has a uniqueness constraint on that stable id
 * to reference. `baseAmount`/`previousPending`/`previousExtraPaid`/
 * `recommendedAmount` are `numeric(14,2)`, matching
 * `investment_requirements.amount`'s precision -- always non-negative by
 * construction (AD-2), `recommendedAmount` clamped to a minimum of `"0"` at
 * the application layer (this story's Decisions).
 */
export const recommendedAmounts = pgTable(
  "recommended_amounts",
  {
    id: uuid("id").primaryKey(),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => investmentRequirements.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partyType: text("party_type").notNull(),
    shareId: uuid("share_id").notNull(),
    baseAmount: numeric("base_amount", { precision: 14, scale: 2 }).notNull(),
    previousPending: numeric("previous_pending", { precision: 14, scale: 2 }).notNull(),
    previousExtraPaid: numeric("previous_extra_paid", { precision: 14, scale: 2 }).notNull(),
    recommendedAmount: numeric("recommended_amount", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The one-snapshot-per-share-per-requirement guarantee (this story's
    // Decisions) -- a data-integrity guard, not an upsert-conflict target
    // (unlike `investment_adjustments_party_share_project_unique`): this
    // story's `snapshot` is always a plain insert, never `onConflictDoUpdate`.
    unique("recommended_amounts_requirement_party_share_unique").on(
      table.requirementId,
      table.partyType,
      table.shareId,
    ),
    // `findByRequirementId` filters on requirement_id -- this resource's only read pattern.
    index("recommended_amounts_requirement_id_idx").on(table.requirementId),
  ],
);

export type RecommendedAmountRow = typeof recommendedAmounts.$inferSelect;

/**
 * Story 3.3 (Epic 3): a single generic audit-trail table, reused unchanged
 * by every later financial-write story in Epic 3 and Epic 4 (AD-5) -- never
 * a per-entity audit table. `entityType`/`entityId` together identify the
 * row this entry is about (e.g. `entityType: "investment_transaction"`,
 * `entityId` = that row's `id`); `oldValue` is nullable (`null` for a
 * create-only entry, populated by later edit/cancel stories); `newValue` is
 * always required -- even a cancel entry needs *some* resulting state to
 * record; `reason` is nullable and unused (`null`) by this story's
 * create-only entries, populated by edit/cancel stories.
 *
 * Story 3.7 adds `idempotencyKey`: nullable, UNIQUE-when-present. A `"create"`
 * entry (Story 3.3) never sets it -- that action's idempotency already lives
 * on `investment_transactions.idempotencyKey` itself, tied specifically to
 * the original create. `"edit"` (this story) and later `"cancel"` (Story 3.8)
 * entries *do* set it -- since those actions update/cancel an existing row
 * in place rather than inserting a new one, there is no natural row-level
 * UNIQUE column left to dedupe against, so `audit_log` is the column's
 * natural home instead. Postgres allows multiple `NULL`s under a UNIQUE
 * constraint (confirmed via Postgres's standard UNIQUE semantics -- NULL is
 * never considered equal to another NULL for uniqueness purposes), so every
 * pre-existing/future `"create"` entry with `idempotencyKey: null` coexists
 * freely, while two `"edit"`/`"cancel"` entries can never accidentally share
 * the same key.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value").notNull(),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Every consumer looks up an entity's audit trail by (entityType, entityId) together.
    index("audit_log_entity_type_entity_id_idx").on(table.entityType, table.entityId),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;

/**
 * Story 4.2 (Epic 4): one row per recorded "Take Now" withdrawal against a
 * Project's Can Take (Story 4.1) for a specific Partner/Sub-partner --
 * mirrors `investment_transactions`' exact shape one ledger over,
 * Project-scoped rather than per-funding-requirement (Can Take itself is
 * Project-scoped, not per-requirement, mirroring Story 4.1's own shape).
 * `shareId` is the *stable* `partner_shares.partnerId`/
 * `subpartner_shares.subPartnerId` (disambiguated by `partyType`), never
 * this row's own `id` and never `users.id` (AD-4) -- deliberately **not** a
 * foreign key, mirroring `investment_transactions.shareId`'s identical
 * precedent (neither share table has a uniqueness constraint on that stable
 * id to reference). `sharePercentSnapshot`/`canTakeSnapshot` mirror
 * `investment_transactions.sharePercentSnapshot`/`.shouldPaySnapshot`'s
 * exact column shapes (`numeric(7,4)`/`numeric(14,2)`) -- captured once at
 * creation time (AD-3), never updated afterward even if the underlying
 * share later changes. `amount` has no `> 0` floor and no cap against
 * `canTakeSnapshot` at the DB layer either (this story's Decisions: `"0"` is
 * a valid Take Now, and an amount exceeding Can Take is accepted as-is --
 * no cap this story, Story 4.5's job). `idempotencyKey` is UNIQUE at the DB
 * level, mirroring `investment_transactions.idempotencyKey`'s identical
 * precedent -- the actual double-submit protection mechanism, not merely an
 * application-layer check.
 *
 * Story 4.11 adds `status`/`reversalOfTransactionId`, mirroring
 * `investment_transactions`' identical Story 3.8 columns exactly (never
 * hard-deleted, flip status + insert a linked reversal row instead, AD-5).
 */
export const withdrawalTransactions = pgTable(
  "withdrawal_transactions",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partyType: text("party_type").notNull(),
    shareId: uuid("share_id").notNull(),
    sharePercentSnapshot: numeric("share_percent_snapshot", { precision: 7, scale: 4 }).notNull(),
    canTakeSnapshot: numeric("can_take_snapshot", { precision: 14, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    transactionDate: date("transaction_date").notNull(),
    paymentMode: text("payment_mode").notNull(),
    referenceNumber: text("reference_number"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull().default("active"),
    reversalOfTransactionId: uuid("reversal_of_transaction_id").references(
      (): AnyPgColumn => withdrawalTransactions.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `listByProjectId` filters on project_id -- this resource's primary
    // read pattern (Project-scoped, unlike `investment_transactions`'
    // per-requirement `listByRequirementId`).
    index("withdrawal_transactions_project_id_idx").on(table.projectId),
    // `(shareId, projectId)` indexed per AD-4 for a person's eventual own-
    // history lookup (Epic 5), mirroring
    // `investment_transactions_share_id_project_id_idx`'s identical
    // precedent one ledger over.
    index("withdrawal_transactions_share_id_project_id_idx").on(table.shareId, table.projectId),
    // Story 4.11: `cancelTransaction`'s idempotent-replay/concurrent-race
    // recovery paths look up a reversal row by its `reversalOfTransactionId`
    // -- mirrors `investment_transactions_reversal_of_transaction_id_idx`.
    index("withdrawal_transactions_reversal_of_transaction_id_idx").on(
      table.reversalOfTransactionId,
    ),
  ],
);

export type WithdrawalTransactionRow = typeof withdrawalTransactions.$inferSelect;

/**
 * Story 4.3 (Epic 4): ONE current row per `(partyType, shareId, projectId)`
 * (AD-4: never `users.id`) -- mirrors `investment_adjustments`' exact
 * single-current-row shape one ledger over. Every write is an upsert keyed
 * by the table's UNIQUE `(partyType, shareId, projectId)` constraint below
 * (Drizzle's `onConflictDoUpdate`, `packages/db/src/ports.ts`'s
 * `createWithdrawalAdjustmentPort`), so `canTake`/`taken`/`adjustmentAmount`/
 * `adjustmentType` always reflect the *most recently viewed* state.
 *
 * Unlike `investment_adjustments`, there is **no `requirementId` column** --
 * Can Take (Story 4.1) is Project-scoped with no funding-round equivalent,
 * so inventing one here would contradict Story 4.1's own design (this
 * story's Decisions). `shareId` mirrors `investment_adjustments.shareId`'s
 * precedent exactly: the *stable* `partner_shares.partnerId`/
 * `subpartner_shares.subPartnerId` (disambiguated by `partyType`), never
 * this row's own `id` and never `users.id` -- deliberately **not** a foreign
 * key, for the identical reason neither share table has a uniqueness
 * constraint on that stable id to reference. `canTake`/`taken`/
 * `adjustmentAmount` are `numeric(14,2)`, matching
 * `investment_adjustments.shouldPay`'s exact precision -- always
 * non-negative by construction (AD-2); the gap's sign lives in
 * `adjustmentType` (`"keep_for_later" | "extra_taken" | "none"`) instead.
 */
export const withdrawalAdjustments = pgTable(
  "withdrawal_adjustments",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partyType: text("party_type").notNull(),
    shareId: uuid("share_id").notNull(),
    canTake: numeric("can_take", { precision: 14, scale: 2 }).notNull(),
    taken: numeric("taken", { precision: 14, scale: 2 }).notNull(),
    adjustmentAmount: numeric("adjustment_amount", { precision: 14, scale: 2 }).notNull(),
    adjustmentType: text("adjustment_type").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The single-row-per-person guarantee (this story's Boundaries) -- the
    // actual upsert-conflict target `createWithdrawalAdjustmentPort` targets,
    // not merely an application-layer check.
    unique("withdrawal_adjustments_party_share_project_unique").on(
      table.partyType,
      table.shareId,
      table.projectId,
    ),
  ],
);

export type WithdrawalAdjustmentRow = typeof withdrawalAdjustments.$inferSelect;

/**
 * Story 4.7 (Epic 4, FR27): one row per destination leg of a withdrawal's
 * post-withdrawal allocation ("Where did this money go?") -- a `POST` saves
 * every leg of one allocation together (this story's Boundaries: one DB
 * transaction, exactly one `audit_log` row, AD-5/AD-6). `destinationType`
 * is one of `"project" | "person" | "available_balance" | "other"`
 * (`packages/types`' `DestinationType`) -- a plain `text` column, not a
 * Postgres enum, mirroring every other discriminator column in this schema
 * (`withdrawal_transactions.partyType`, `withdrawal_adjustments.adjustmentType`,
 * etc.). `destinationProjectId` is populated only for a `"project"` leg
 * (validated by `packages/core`'s `recordDestinationAllocation` to differ
 * from the withdrawal's own source Project -- deliberately **not** `onDelete:
 * "cascade"` on its own `projects` FK, unlike `withdrawalTransactionId`
 * below: a destination Project being deleted should never silently delete
 * the allocation record of money that left a *different, still-existing*
 * Project), `personName` only for a `"person"` leg (free-text, no
 * Person/contact entity exists yet -- this story's Decisions), `notes`
 * optionally on any leg (doubles as `"other"`'s primary free-text
 * description).
 *
 * `idempotencyKey` is shared across every leg row of one save (this story's
 * Decisions) -- unlike `withdrawalTransactions.idempotencyKey`, deliberately
 * **not** a UNIQUE column: a single atomic write legitimately inserts
 * multiple rows carrying the identical key, so a table-wide UNIQUE
 * constraint would make the second leg's own insert fail. Uniqueness/
 * idempotent-replay detection is enforced by
 * `createWithdrawalDestinationAllocationPort`'s `recordAllocation` at the
 * application layer instead (`SELECT ... FOR UPDATE` on the parent
 * `withdrawal_transactions` row), mirroring Story 3.8's two-row cancel/
 * reversal atomic-write precedent, which also can't use a single-row UNIQUE
 * constraint for its own multi-row write.
 *
 * No `status`/cancel column -- allocation is write-once per withdrawal, not
 * editable/re-enterable (this story's Decisions); Story 4.11's cancel/
 * reverse of the whole withdrawal (cascading via `withdrawalTransactionId`'s
 * `onDelete: "cascade"` FK below) is the only undo path.
 *
 * Story 4.8 (FR28) adds `destinationRequirementId`/`destinationShareId`/
 * `destinationPartyType` -- non-breaking, nullable columns (existing rows
 * unaffected, spec-4-8's Decisions), populated only for a `"project"` leg:
 * the destination Project's funding requirement and Partner/Sub-partner
 * Share Owner/Admin picks at allocation time, mirroring how a manual Add
 * Money entry already works. `destinationRequirementId` deliberately has
 * **no** `onDelete: "cascade"` on its `investment_requirements` FK, mirroring
 * `destinationProjectId`'s own identical precedent immediately above (a
 * requirement at a *different, still-existing* destination Project being
 * deleted should never silently delete this allocation record of money that
 * already left this leg's own source Project). `destinationShareId` mirrors
 * `investment_transactions.shareId`'s precedent exactly: the *stable*
 * `partner_shares.partnerId`/`subpartner_shares.subPartnerId` (disambiguated
 * by `destinationPartyType`), never this row's own `id` and never
 * `users.id` (AD-4) -- deliberately **not** a foreign key, for the identical
 * reason neither share table has a uniqueness constraint on that stable id
 * to reference.
 */
export const withdrawalDestinationAllocations = pgTable(
  "withdrawal_destination_allocations",
  {
    id: uuid("id").primaryKey(),
    withdrawalTransactionId: uuid("withdrawal_transaction_id")
      .notNull()
      .references(() => withdrawalTransactions.id, { onDelete: "cascade" }),
    destinationType: text("destination_type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    destinationProjectId: uuid("destination_project_id").references(() => projects.id),
    personName: text("person_name"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key").notNull(),
    destinationRequirementId: uuid("destination_requirement_id").references(
      () => investmentRequirements.id,
    ),
    destinationShareId: uuid("destination_share_id"),
    destinationPartyType: text("destination_party_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `recordAllocation`/`listByWithdrawalTransactionId` both filter on
    // withdrawal_transaction_id -- this table's primary read/lookup pattern.
    index("withdrawal_destination_allocations_withdrawal_transaction_id_idx").on(
      table.withdrawalTransactionId,
    ),
    // Indexed (not unique alone -- see this table's own doc comment above)
    // so `recordAllocation`'s idempotency-replay lookup by idempotencyKey
    // stays an index scan, not a sequential scan.
    index("withdrawal_destination_allocations_idempotency_key_idx").on(table.idempotencyKey),
  ],
);

export type WithdrawalDestinationAllocationRow = typeof withdrawalDestinationAllocations.$inferSelect;

/**
 * Story 4.9 (Epic 4, FR29): the running "Available Balance" ledger a
 * withdrawal's `"available_balance"` destination-allocation leg credits
 * (`createWithdrawalDestinationAllocationPort.recordAllocation`, extended)
 * and a spend (`createAvailableBalanceSpendPort.recordSpend`) debits -- ONE
 * current row per `(partyType, shareId, projectId)`, `projectId` being the
 * *source* Project the withdrawal came from (this story's Decisions #1:
 * mirrors `withdrawal_adjustments`' exact single-current-row-per-source-
 * Project shape, never a cross-Project aggregate, never `users.id`-keyed --
 * AD-4). `shareId` is not a FK, mirroring `withdrawalAdjustments.shareId`'s
 * identical precedent (neither share table has a uniqueness constraint on
 * that stable id to reference). `CHECK (balance >= 0)` (AD-10's backstop,
 * the first CHECK constraint in this schema) -- defense in depth alongside
 * `createAvailableBalancePort.debitBalance`'s own `SELECT ... FOR UPDATE` +
 * `assertSufficientBalance` guard, never a substitute for it.
 */
export const availableBalances = pgTable(
  "available_balances",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partyType: text("party_type").notNull(),
    shareId: uuid("share_id").notNull(),
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("available_balances_party_share_project_unique").on(
      table.partyType,
      table.shareId,
      table.projectId,
    ),
    check("available_balances_balance_non_negative", sql`${table.balance} >= 0`),
  ],
);

export type AvailableBalanceRow = typeof availableBalances.$inferSelect;

/**
 * Story 4.9 (Epic 4, FR29): one row per "Use Balance" spend
 * (`createAvailableBalanceSpendPort.recordSpend`) -- either `"project"`
 * (re-invests part/all of the balance into another Project's funding
 * requirement, via `spendAvailableBalanceToProject()`, mirroring
 * `withdrawal_destination_allocations`' `"project"`-leg column shape exactly)
 * or `"person"` ("Give to a Person", free-text `personName` only -- mirrors
 * Story 4.7's `"person"` leg, no Person/contact entity exists in this schema
 * yet). `sourceProjectId`/`partyType`/`shareId` identify which
 * `available_balances` row this spend debited. `idempotencyKey` is UNIQUE
 * (unlike `withdrawal_destination_allocations.idempotencyKey`) -- a single
 * spend request writes exactly one row here, never several siblings sharing
 * one key.
 */
export const availableBalanceSpends = pgTable(
  "available_balance_spends",
  {
    id: uuid("id").primaryKey(),
    sourceProjectId: uuid("source_project_id")
      .notNull()
      .references(() => projects.id),
    partyType: text("party_type").notNull(),
    shareId: uuid("share_id").notNull(),
    destinationType: text("destination_type").notNull(),
    destinationProjectId: uuid("destination_project_id").references(() => projects.id),
    destinationRequirementId: uuid("destination_requirement_id").references(
      () => investmentRequirements.id,
    ),
    destinationShareId: uuid("destination_share_id"),
    destinationPartyType: text("destination_party_type"),
    personName: text("person_name"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `recordSpend`'s straightforward-replay/concurrent-race-recovery lookup
    // filters on idempotencyKey -- indexed (on top of its own UNIQUE
    // constraint, which already implies an index) purely for documentation
    // symmetry with this schema's other idempotency-keyed tables; harmless
    // either way since UNIQUE already creates the index Postgres uses here.
    index("available_balance_spends_source_project_id_idx").on(table.sourceProjectId),
  ],
);

export type AvailableBalanceSpendRow = typeof availableBalanceSpends.$inferSelect;

/**
 * Story 4.8 (Epic 4, FR28, AD-6): one row per `"project"` destination-
 * allocation leg's auto-created linked movement -- the middle link in the
 * `withdrawal_destination_allocations` leg -> `money_movements` ->
 * `investment_transactions` chain, written by `packages/core`'s
 * `moveWithdrawalToProject()` inside the exact same atomic write as its
 * parent allocation leg (`createWithdrawalDestinationAllocationPort.recordAllocation`,
 * Story 4.7's existing `database.transaction()`, extended). Linked to the
 * specific `withdrawal_destination_allocations` row (not directly to the
 * withdrawal transaction) -- one withdrawal can have multiple `"project"`
 * legs to different destinations, and the FK chain here is what makes the
 * source side of each one individually reconstructable (spec-4-8's
 * Decisions). `onDelete: "cascade"` on `withdrawalDestinationAllocationId`
 * mirrors `withdrawalDestinationAllocations.withdrawalTransactionId`'s own
 * precedent -- this row lives and dies with its parent leg. `sourceProjectId`/
 * `destinationProjectId` intentionally have **no** `onDelete: "cascade"` on
 * their `projects` FKs, mirroring `withdrawalDestinationAllocations.destinationProjectId`'s
 * identical rationale one table over (a Project being deleted should never
 * silently delete a movement record naming a *different, still-existing*
 * Project). `destinationInvestmentTransactionId` has no `onDelete: "cascade"`
 * either, for the same reason -- `investment_transactions` rows are never
 * hard-deleted anyway (Story 3.8's status-flip-plus-reversal convention).
 * No paired `audit_log` row of its own -- the audit trail already lives on
 * the auto-created `investment_transactions` row's own paired "create"
 * `audit_log` entry (`InvestmentTransactionPort.recordTransaction`'s
 * existing atomicity contract, unchanged) and on the parent
 * `withdrawal_destination_allocation`'s own "create" `audit_log` entry
 * (Story 4.7, unchanged) -- a third would be redundant.
 *
 * Story 4.9 (FR29) widens this table to also link an `"available_balance"`
 * spend's own auto-created movement (`spendAvailableBalanceToProject()`,
 * mirroring `moveWithdrawalToProject()`'s identical call shape one story
 * over): `withdrawalDestinationAllocationId` becomes nullable, and a new
 * nullable `availableBalanceSpendId` is added -- non-breaking (spec-4-9's
 * Decisions #6), existing `moveWithdrawalToProject()` callers keep passing
 * `withdrawalDestinationAllocationId` and never touch the new column.
 * `CHECK` enforces exactly one of the two is set per row -- a row is either
 * allocation-sourced or spend-sourced, never both, never neither.
 */
export const moneyMovements = pgTable(
  "money_movements",
  {
    id: uuid("id").primaryKey(),
    withdrawalDestinationAllocationId: uuid("withdrawal_destination_allocation_id").references(
      () => withdrawalDestinationAllocations.id,
      { onDelete: "cascade" },
    ),
    availableBalanceSpendId: uuid("available_balance_spend_id").references(
      () => availableBalanceSpends.id,
      { onDelete: "cascade" },
    ),
    sourceProjectId: uuid("source_project_id")
      .notNull()
      .references(() => projects.id),
    destinationProjectId: uuid("destination_project_id")
      .notNull()
      .references(() => projects.id),
    destinationInvestmentTransactionId: uuid("destination_investment_transaction_id")
      .notNull()
      .references(() => investmentTransactions.id),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `recordAllocation`'s replay path looks up an existing set of legs' own
    // linked movements by this column -- this table's primary lookup pattern.
    index("money_movements_withdrawal_destination_allocation_id_idx").on(
      table.withdrawalDestinationAllocationId,
    ),
    // Story 4.9: `recordSpend`'s own replay path, mirroring the index above
    // one column over.
    index("money_movements_available_balance_spend_id_idx").on(table.availableBalanceSpendId),
    // The Add Money page's "Moved from Project A" indicator (Story 4.8's Code
    // Map) looks up every movement landing at one destination Project.
    index("money_movements_destination_project_id_idx").on(table.destinationProjectId),
    // Story 4.9 (AD-6): a money_movements row is either allocation-sourced
    // or spend-sourced, never both, never neither.
    check(
      "money_movements_exactly_one_source_check",
      sql`(${table.withdrawalDestinationAllocationId} is null) <> (${table.availableBalanceSpendId} is null)`,
    ),
  ],
);

export type MoneyMovementRow = typeof moneyMovements.$inferSelect;

/**
 * Story 5.3 (FR33/FR34): a pure AUDIT RECORD of an Owner/Admin's explicit
 * decision to net an amount between one person's Investment Adjustment (at
 * a specific funding requirement) and their Withdrawal Adjustment (at this
 * Project) -- AD-4's "never a side effect of either cycle's calculation"
 * literally: `investment_adjustments`/`withdrawal_adjustments` themselves
 * are NEVER written to as a result of a row landing here, staying exactly as
 * freshly computed from Should Pay/Can Take. This table's only effect is
 * existing, permanently, as a transparent, audited fact.
 *
 * `investmentRequirementId` anchors the record to the specific funding round
 * whose Investment Adjustment was netted -- `investment_adjustments` is
 * keyed by `(partyType, shareId, projectId, requirementId)` (a person can
 * have several across different funding rounds within one Project), while
 * `withdrawal_adjustments` is Project-scoped only (no requirement
 * equivalent, Story 4.3's design) -- so `projectId` alone identifies which
 * Withdrawal Adjustment row this netted against; the route layer confirms
 * both referenced rows actually exist before writing here (never trusted
 * from the client alone). `shareId`/`partyType` are the *stable*
 * `partner_shares.partnerId`/`subpartner_shares.subPartnerId` (disambiguated
 * by `partyType`), never `users.id` (AD-4) -- deliberately **not** a foreign
 * key, mirroring every other share-keyed table in this schema (neither share
 * table has a uniqueness constraint on that stable id to reference).
 * `idempotencyKey` is UNIQUE at the DB level, mirroring
 * `withdrawal_transactions.idempotencyKey`'s identical precedent -- the
 * actual double-submit protection mechanism (AD-5), not merely an
 * application-layer check.
 */
export const adjustmentNettings = pgTable(
  "adjustment_nettings",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partyType: text("party_type").notNull(),
    shareId: uuid("share_id").notNull(),
    investmentRequirementId: uuid("investment_requirement_id")
      .notNull()
      .references(() => investmentRequirements.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Money History (Story 5.1's `assembleMoneyHistory`, extended this
    // story) and this story's own `AdjustmentNettingPort.listAll()`/route-
    // layer existence checks all benefit from a project-scoped lookup path
    // -- mirrors every other financial-write table's identical `project_id`
    // index.
    index("adjustment_nettings_project_id_idx").on(table.projectId),
    index("adjustment_nettings_share_id_project_id_idx").on(table.shareId, table.projectId),
  ],
);

export type AdjustmentNettingRow = typeof adjustmentNettings.$inferSelect;

import { boolean, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

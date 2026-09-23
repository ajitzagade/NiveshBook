import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { UserEmailAlreadyExistsError } from "@niveshbook/core";
import { getDb } from "./client";
import { createUserPort } from "./ports";
import { users } from "./schema";

// Mirrors `adjustment-netting-port.test.ts`'s own defensive `DATABASE_URL`
// loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createUserPort().createUser` (spec-user-
 * creation) -- the one new write this spec adds to `UserPort`: a genuine
 * insert, the duplicate-email unique-constraint conflict mapped to a typed
 * error (never a raw/500-shaped DB error), and that a freshly created row
 * round-trips correctly through `findUserByEmail`/`findUserById`.
 */
describe("createUserPort().createUser (live Postgres)", () => {
  const seededEmails: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const emails = seededEmails.splice(0);
    if (emails.length > 0) {
      await db.delete(users).where(inArray(users.email, emails));
    }
  });

  function uniqueEmail(): string {
    const email = `user-port-test-${Date.now()}-${Math.random().toString(36).slice(2)}@niveshbook.test`;
    seededEmails.push(email);
    return email;
  }

  it("inserts a new user row and returns it, never leaking a plaintext password (the port only ever receives a hash)", async () => {
    const port = createUserPort();
    const email = uniqueEmail();

    const created = await port.createUser({
      email,
      passwordHash: "irrelevant-hash-for-this-test",
      role: "partner",
    });

    expect(created.id).toBeTruthy();
    expect(created.email).toBe(email);
    expect(created.role).toBe("partner");
    expect(created.active).toBe(true);
    expect(created.passwordHash).toBe("irrelevant-hash-for-this-test");

    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(created.id);
  });

  it.each(["owner_admin", "partner", "sub_partner"] as const)(
    "creates a %s account, with canApproveExtraWithdrawal false regardless of role (FR45 review fix: never inherited true from the column default)",
    async (role) => {
      const port = createUserPort();
      const email = uniqueEmail();

      const created = await port.createUser({ email, passwordHash: "irrelevant-hash", role });

      expect(created.role).toBe(role);
      expect(created.canApproveExtraWithdrawal).toBe(false);
    },
  );

  it("a freshly created user round-trips through findUserByEmail/findUserById", async () => {
    const port = createUserPort();
    const email = uniqueEmail();

    const created = await port.createUser({ email, passwordHash: "irrelevant-hash", role: "sub_partner" });

    expect(await port.findUserByEmail(email)).toEqual(created);
    expect(await port.findUserById(created.id)).toEqual(created);
  });

  it("throws UserEmailAlreadyExistsError -- never a raw/500-shaped DB error -- for a duplicate email", async () => {
    const port = createUserPort();
    const email = uniqueEmail();

    await port.createUser({ email, passwordHash: "irrelevant-hash", role: "partner" });

    await expect(
      port.createUser({ email, passwordHash: "a-different-hash", role: "owner_admin" }),
    ).rejects.toBeInstanceOf(UserEmailAlreadyExistsError);

    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
  });
});

/**
 * Live-Postgres coverage for `createUserPort().updatePassword`
 * (spec-user-reset-deactivate) -- the one new write this spec adds to
 * `UserPort`, mirroring `setUserActive`'s own (untested-here, but identical
 * shape) "plain update-by-id, returning null for an unmatched id" pattern.
 */
describe("createUserPort().updatePassword (live Postgres)", () => {
  const seededEmails: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const emails = seededEmails.splice(0);
    if (emails.length > 0) {
      await db.delete(users).where(inArray(users.email, emails));
    }
  });

  function uniqueEmail(): string {
    const email = `user-port-update-password-test-${Date.now()}-${Math.random().toString(36).slice(2)}@niveshbook.test`;
    seededEmails.push(email);
    return email;
  }

  it("overwrites the stored password hash and returns the updated row", async () => {
    const port = createUserPort();
    const email = uniqueEmail();
    const created = await port.createUser({ email, passwordHash: "original-hash", role: "partner" });

    const updated = await port.updatePassword(created.id, "new-hash");

    expect(updated?.id).toBe(created.id);
    expect(updated?.passwordHash).toBe("new-hash");

    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, created.id));
    expect(rows[0]?.passwordHash).toBe("new-hash");
  });

  it("leaves every other column untouched", async () => {
    const port = createUserPort();
    const email = uniqueEmail();
    const created = await port.createUser({ email, passwordHash: "original-hash", role: "owner_admin" });

    const updated = await port.updatePassword(created.id, "new-hash");

    expect(updated?.email).toBe(email);
    expect(updated?.role).toBe("owner_admin");
    expect(updated?.active).toBe(true);
  });

  it("returns null for an id that doesn't match any row", async () => {
    const port = createUserPort();

    const updated = await port.updatePassword("0192f5a0-0000-7000-8000-000000000000", "new-hash");

    expect(updated).toBeNull();
  });
});

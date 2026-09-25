import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { InsufficientAvailableBalanceError } from "@niveshbook/core";
import type { Money } from "@niveshbook/types";
import { getDb } from "./client";
import { createAvailableBalancePort } from "./ports";
import { availableBalances, projects } from "./schema";

// Mirrors `withdrawal-destination-allocation-port.test.ts`'s own defensive
// `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * `true` if `error` is a Postgres CHECK-constraint-violation error (SQL
 * state `23514`) naming `constraintName` specifically -- mirrors `ports.ts`'s
 * `isUniqueViolation` fix (Story 4.9, review finding): this drizzle-orm
 * version wraps a query error thrown outside an explicit
 * `database.transaction()` in a `DrizzleQueryError` too, whose own `.message`
 * is just `"Failed query: ..."` (no constraint name) and whose own `.code`
 * is `undefined` -- the real `PostgresError` (with `.code`/`.constraint_name`)
 * lives one level down at `.cause`. A plain `.rejects.toThrow(/constraintName/)`
 * against the top-level message would never match this wrapped shape, the
 * exact class of false-negative `isUniqueViolation`'s own fix closed
 * elsewhere in this story.
 */
function isCheckConstraintViolation(constraintName: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (typeof error !== "object" || error === null || !("cause" in error)) {
      return false;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause !== "object" || cause === null) {
      return false;
    }
    const { code, constraint_name: constraintNameOnError } = cause as {
      code?: unknown;
      constraint_name?: unknown;
    };
    return code === "23514" && constraintNameOnError === constraintName;
  };
}

/**
 * Live-Postgres coverage for `createAvailableBalancePort` (Story 4.9, FR29,
 * AD-10) -- the running Available Balance ledger's credit (atomic upsert)
 * and debit (`SELECT ... FOR UPDATE` + `assertSufficientBalance`) paths,
 * including the genuine concurrent-race test this story's AC4 calls out for
 * real DB coverage (a lost-update bug here is invisible to any in-memory
 * fake -- it only manifests under Postgres's actual row-lock behavior).
 */
describe("createAvailableBalancePort (live Postgres)", () => {
  const seededProjectIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      // available_balances cascade-deletes via projects, but this afterEach
      // still explicitly deletes it first for clarity/defense-in-depth --
      // mirrors this file's own project cleanup precedent one story over.
      await db.delete(availableBalances).where(inArray(availableBalances.projectId, projectIds));
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `avail-bal-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  describe("creditBalance", () => {
    it("inserts a fresh row on the first credit for a (partyType, shareId, projectId)", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();

      const result = await port.creditBalance({
        projectId,
        partyType: "partner",
        shareId,
        amount: "50000" as Money,
      });

      expect(result.balance).toBe("50000.00");
      expect(result.projectId).toBe(projectId);
      expect(result.partyType).toBe("partner");
      expect(result.shareId).toBe(shareId);

      const db = getDb();
      const rows = await db.select().from(availableBalances).where(eq(availableBalances.projectId, projectId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.balance).toBe("50000.00");
    });

    it("increments an existing row on a second credit for the same key (AC1's worked example: 50,000 credited once)", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();

      await port.creditBalance({ projectId, partyType: "partner", shareId, amount: "30000" as Money });
      const result = await port.creditBalance({
        projectId,
        partyType: "partner",
        shareId,
        amount: "20000" as Money,
      });

      expect(result.balance).toBe("50000.00");

      const db = getDb();
      const rows = await db.select().from(availableBalances).where(eq(availableBalances.projectId, projectId));
      expect(rows).toHaveLength(1);
    });

    it("keeps balances scoped independently per (partyType, shareId) -- a sub_partner credit never touches a partner's row even with the same shareId value collision avoided by partyType", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();

      await port.creditBalance({ projectId, partyType: "partner", shareId, amount: "10000" as Money });
      await port.creditBalance({ projectId, partyType: "sub_partner", shareId, amount: "5000" as Money });

      const balances = await port.listBalancesByProjectId(projectId);
      expect(balances).toHaveLength(2);
      const partnerBalance = balances.find((b) => b.partyType === "partner");
      const subPartnerBalance = balances.find((b) => b.partyType === "sub_partner");
      expect(partnerBalance?.balance).toBe("10000.00");
      expect(subPartnerBalance?.balance).toBe("5000.00");
    });
  });

  describe("debitBalance", () => {
    it("subtracts from an existing balance (AC2's worked example: 30,000 spent from 50,000 -> 20,000)", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();
      await port.creditBalance({ projectId, partyType: "partner", shareId, amount: "50000" as Money });

      const result = await port.debitBalance({
        projectId,
        partyType: "partner",
        shareId,
        amount: "30000" as Money,
      });

      expect(result.balance).toBe("20000.00");
    });

    it("allows debiting the entire balance down to exactly zero", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();
      await port.creditBalance({ projectId, partyType: "partner", shareId, amount: "10000" as Money });

      const result = await port.debitBalance({
        projectId,
        partyType: "partner",
        shareId,
        amount: "10000" as Money,
      });

      expect(result.balance).toBe("0.00");
    });

    it("rejects an overdraft attempt -- InsufficientAvailableBalanceError, balance unchanged (AC3)", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();
      await port.creditBalance({ projectId, partyType: "partner", shareId, amount: "20000" as Money });

      await expect(
        port.debitBalance({ projectId, partyType: "partner", shareId, amount: "30000" as Money }),
      ).rejects.toBeInstanceOf(InsufficientAvailableBalanceError);

      const db = getDb();
      const rows = await db.select().from(availableBalances).where(eq(availableBalances.projectId, projectId));
      expect(rows[0]?.balance).toBe("20000.00");
    });

    it("rejects a debit against a balance that was never credited (no row) unless the amount is exactly 0", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();

      await expect(
        port.debitBalance({ projectId, partyType: "partner", shareId, amount: "1" as Money }),
      ).rejects.toBeInstanceOf(InsufficientAvailableBalanceError);
    });

    it("recovers from a concurrent double-spend race -- only the non-overdrawing debit succeeds, balance never goes negative, no lost update (AC4)", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();
      await port.creditBalance({ projectId, partyType: "partner", shareId, amount: "50000" as Money });

      const [resultA, resultB] = await Promise.allSettled([
        port.debitBalance({ projectId, partyType: "partner", shareId, amount: "30000" as Money }),
        port.debitBalance({ projectId, partyType: "partner", shareId, amount: "30000" as Money }),
      ]);

      const outcomes = [resultA, resultB];
      const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
      const rejected = outcomes.filter((r) => r.status === "rejected");
      // Combined (60,000) exceeds the 50,000 balance -- exactly one debit
      // must win, the other must be rejected as insufficient.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientAvailableBalanceError);

      const db = getDb();
      const rows = await db.select().from(availableBalances).where(eq(availableBalances.projectId, projectId));
      // Never negative, never a lost update -- exactly one 30,000 debit applied.
      expect(rows[0]?.balance).toBe("20000.00");
    });

    it("two concurrent debits that BOTH fit within the balance both succeed, with the final balance reflecting both (no lost update)", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();
      await port.creditBalance({ projectId, partyType: "partner", shareId, amount: "100000" as Money });

      const [resultA, resultB] = await Promise.all([
        port.debitBalance({ projectId, partyType: "partner", shareId, amount: "30000" as Money }),
        port.debitBalance({ projectId, partyType: "partner", shareId, amount: "40000" as Money }),
      ]);

      // Postgres's row lock serializes the two debits -- whichever runs
      // second re-reads the first's already-committed balance, so the two
      // "post-debit" snapshots differ depending on execution order (either
      // {70000, 30000} or {60000, 30000} -- both are correct, order is not
      // guaranteed). What matters (no lost update) is the FINAL committed
      // balance, asserted below: exactly both debits applied, never just one.
      expect(resultA.balance).not.toBe(resultB.balance);

      const db = getDb();
      const rows = await db.select().from(availableBalances).where(eq(availableBalances.projectId, projectId));
      expect(rows[0]?.balance).toBe("30000.00");
    });
  });

  describe("listBalancesByProjectId", () => {
    it("returns [] for a Project with no balances yet", async () => {
      const port = createAvailableBalancePort();
      const projectId = await seedProject();

      expect(await port.listBalancesByProjectId(projectId)).toEqual([]);
    });

    it("scopes strictly to the given projectId -- a balance on a different Project is never returned", async () => {
      const port = createAvailableBalancePort();
      const projectIdA = await seedProject();
      const projectIdB = await seedProject();
      const shareId = uuidv7();
      await port.creditBalance({ projectId: projectIdA, partyType: "partner", shareId, amount: "1000" as Money });
      await port.creditBalance({ projectId: projectIdB, partyType: "partner", shareId, amount: "2000" as Money });

      const balancesA = await port.listBalancesByProjectId(projectIdA);
      expect(balancesA).toHaveLength(1);
      expect(balancesA[0]?.balance).toBe("1000.00");
    });
  });

  /**
   * Review finding: `debitBalance`'s application-level `assertSufficientBalance`
   * guard is what normally prevents a negative balance (AD-10) -- these
   * tests instead bypass that guard entirely (raw `db.insert`/`db.update`
   * calls, not the port) to prove the `available_balances_balance_non_negative`
   * CHECK constraint itself (schema.ts) is the real backstop it's documented
   * to be, not just an inert declaration a Drizzle-level test could pass
   * without ever hitting Postgres.
   */
  describe("available_balances_balance_non_negative CHECK constraint (AD-10 backstop)", () => {
    it("rejects a raw INSERT with a negative balance", async () => {
      const db = getDb();
      const projectId = await seedProject();

      await expect(
        db.insert(availableBalances).values({
          id: uuidv7(),
          projectId,
          partyType: "partner",
          shareId: uuidv7(),
          balance: "-100",
        }),
      ).rejects.toSatisfy(isCheckConstraintViolation("available_balances_balance_non_negative"));
    });

    it("rejects a raw UPDATE that drives an existing row's balance negative", async () => {
      const db = getDb();
      const port = createAvailableBalancePort();
      const projectId = await seedProject();
      const shareId = uuidv7();
      await port.creditBalance({ projectId, partyType: "partner", shareId, amount: "100" as Money });

      await expect(
        db
          .update(availableBalances)
          .set({ balance: "-1" })
          .where(eq(availableBalances.projectId, projectId)),
      ).rejects.toSatisfy(isCheckConstraintViolation("available_balances_balance_non_negative"));

      // The failed UPDATE must not have partially applied -- balance
      // unchanged.
      const rows = await db.select().from(availableBalances).where(eq(availableBalances.projectId, projectId));
      expect(rows[0]?.balance).toBe("100.00");
    });
  });
});

import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "./client";
import { createInvestmentTransactionPort } from "./ports";
import { projects, investmentRequirements, investmentTransactions } from "./schema";

// Mirrors `migrate.ts`/`seed.ts`'s own defensive `DATABASE_URL` loading --
// CI already sets it as a job-level env var (a no-op here, since `dotenv`
// never overwrites an already-set variable), while local `vitest run` has
// no other mechanism to pick it up from the repo-root `.env`.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `sumActiveAmountByProjectId` (Story 4.1) --
 * unlike `ports.test.ts`'s pure-function unit tests (which never touch a
 * real database) and `investment-transaction.test.ts`'s hand-written
 * in-memory fake, this exercises the actual Drizzle-generated
 * `coalesce(sum(...), 0)` SQL against the real Postgres instance CI already
 * provisions for this repo (`DATABASE_URL`) -- so a bug in the query itself
 * (wrong `status` filter, wrong `projectId` scoping, double-counting rows
 * across requirements) would be caught here, not just in a mocked/faked
 * port at a higher layer.
 *
 * Rows are seeded directly via Drizzle (not through `recordTransaction`,
 * which isn't under test here) and cleaned up by deleting the seeded
 * `projects` row afterward -- both `investment_transactions.projectId` and
 * `.requirementId` cascade-delete (schema.ts), so one delete clears every
 * row a test created.
 */
describe("createInvestmentTransactionPort.sumActiveAmountByProjectId (live Postgres)", () => {
  const seededProjectIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const id of seededProjectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `sum-active-amount-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedRequirement(projectId: string): Promise<string> {
    const db = getDb();
    const requirementId = uuidv7();
    await db.insert(investmentRequirements).values({
      id: requirementId,
      projectId,
      amount: "1000000",
      requirementDate: "2026-10-01",
    });
    return requirementId;
  }

  async function seedTransaction(
    projectId: string,
    requirementId: string,
    amount: string,
    status: "active" | "cancelled",
  ): Promise<void> {
    const db = getDb();
    await db.insert(investmentTransactions).values({
      id: uuidv7(),
      requirementId,
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50",
      shouldPaySnapshot: amount,
      amount,
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      status,
    });
  }

  it("sums active transactions across multiple requirements for the same project, excluding a cancelled row", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const requirement1 = await seedRequirement(projectId);
    const requirement2 = await seedRequirement(projectId);

    await seedTransaction(projectId, requirement1, "300000", "active");
    await seedTransaction(projectId, requirement2, "200000", "active");
    // A cancelled row, with an amount large enough that including it by
    // mistake would be obvious -- must never be counted (Story 3.8's
    // `status: "cancelled"` convention).
    await seedTransaction(projectId, requirement1, "999999", "cancelled");

    const total = await port.sumActiveAmountByProjectId(projectId);

    expect(total).toBe("500000.00");
  });

  it("returns \"0\" for a project with zero active transactions", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();

    const total = await port.sumActiveAmountByProjectId(projectId);

    expect(total).toBe("0");
  });

  it("scopes strictly to the given projectId -- an active transaction on a different project is never counted", async () => {
    const port = createInvestmentTransactionPort();
    const projectA = await seedProject();
    const projectB = await seedProject();
    const requirementA = await seedRequirement(projectA);
    const requirementB = await seedRequirement(projectB);

    await seedTransaction(projectA, requirementA, "100000", "active");
    await seedTransaction(projectB, requirementB, "999999", "active");

    const total = await port.sumActiveAmountByProjectId(projectA);

    expect(total).toBe("100000.00");
  });
});

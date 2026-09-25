import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { WithdrawalIdempotencyKeyConflictError } from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import { createWithdrawalTransactionPort } from "./ports";
import { auditLog, projects, users, withdrawalTransactions } from "./schema";

// Mirrors `investment-transaction-port.test.ts`'s own defensive
// `DATABASE_URL` loading -- CI already sets it as a job-level env var (a
// no-op here, since `dotenv` never overwrites an already-set variable),
// while local `vitest run` has no other mechanism to pick it up from the
// repo-root `.env`.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createWithdrawalTransactionPort.recordTransaction`
 * (Story 4.2) -- mirrors `investment-transaction-port.test.ts`'s established
 * pattern (rows seeded/inspected directly via Drizzle against the real
 * Postgres instance CI already provisions, `DATABASE_URL`), applied here to
 * the atomic-write + idempotency-race-recovery path this story's own
 * Decisions call out for real DB coverage, not just a mocked-port route
 * test: the atomic transaction+audit_log write (every column, row 6
 * regression), the straightforward idempotent-replay path, the
 * content-mismatch conflict path, and the concurrent-double-submit
 * unique-violation race-recovery path.
 *
 * Unlike `ports.test.ts`'s pure-function unit tests of
 * `matchesWithdrawalRequest`/`isUniqueViolation` (which never touch a real
 * database), this exercises the actual `database.transaction()`-wrapped
 * insert-plus-audit-log SQL and the real `idempotency_key` UNIQUE
 * constraint a concurrent race depends on.
 */
describe("createWithdrawalTransactionPort.recordTransaction (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    // `audit_log.actorUserId` has no `ON DELETE` action (schema.ts), so the
    // seeded user row can't be deleted while an audit entry still
    // references it -- clear those first. `withdrawal_transactions` rows
    // cascade-delete via `projects` (schema.ts), so a project delete alone
    // clears them.
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds.splice(0)));
    }
    for (const id of seededProjectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, id));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `withdrawal-tx-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  /** A real `users` row -- `audit_log.actorUserId` is a NOT NULL FK to it. */
  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `withdrawal-tx-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  it("atomically writes the withdrawal transaction row and its paired audit_log row, with every column mapped correctly (row 6 regression -- not just amount/snapshots)", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();

    const result = await port.recordTransaction({
      projectId,
      partyType: "partner",
      shareId,
      sharePercentSnapshot: "33.3333" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "neft",
      referenceNumber: "REF-42",
      notes: "First withdrawal",
      idempotencyKey,
      actorUserId,
    });

    expect(result.created).toBe(true);
    expect(result.transaction.projectId).toBe(projectId);
    expect(result.transaction.partyType).toBe("partner");
    expect(result.transaction.shareId).toBe(shareId);
    expect(result.transaction.sharePercentSnapshot).toBe("33.3333");
    expect(result.transaction.canTakeSnapshot).toBe("500000.00");
    expect(result.transaction.amount).toBe("250000.00");
    expect(result.transaction.transactionDate).toBe("2026-10-05");
    expect(result.transaction.paymentMode).toBe("neft");
    expect(result.transaction.referenceNumber).toBe("REF-42");
    expect(result.transaction.notes).toBe("First withdrawal");

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalTransactions)
      .where(eq(withdrawalTransactions.id, result.transaction.id));
    expect(rows).toHaveLength(1);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, result.transaction.id));
    expect(auditRows).toHaveLength(1);
    const entry = auditRows[0];
    expect(entry?.entityType).toBe("withdrawal_transaction");
    expect(entry?.action).toBe("create");
    expect(entry?.actorUserId).toBe(actorUserId);
    expect(entry?.oldValue).toBeNull();
    expect((entry?.newValue as { id?: string } | null)?.id).toBe(result.transaction.id);
  });

  it("replays an idempotent resubmission with identical content -- exactly one row, created: false, same transaction returned", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();
    const input = {
      projectId,
      partyType: "partner" as const,
      shareId,
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "cash" as const,
      referenceNumber: null,
      notes: null,
      idempotencyKey,
      actorUserId,
    };

    const first = await port.recordTransaction(input);
    const second = await port.recordTransaction(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.transaction.id).toBe(first.transaction.id);

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalTransactions)
      .where(eq(withdrawalTransactions.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it("rejects a same-idempotencyKey resubmission with mismatched content -- WithdrawalIdempotencyKeyConflictError, no second row", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();

    await port.recordTransaction({
      projectId,
      partyType: "partner",
      shareId,
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey,
      actorUserId,
    });

    await expect(
      port.recordTransaction({
        projectId,
        partyType: "partner",
        shareId,
        sharePercentSnapshot: "50" as Percent,
        canTakeSnapshot: "500000" as Money,
        // Mismatched amount -- a genuine key collision, not a replay.
        amount: "999999" as Money,
        transactionDate: "2026-10-05",
        paymentMode: "cash",
        referenceNumber: null,
        notes: null,
        idempotencyKey,
        actorUserId,
      }),
    ).rejects.toThrow(WithdrawalIdempotencyKeyConflictError);

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalTransactions)
      .where(eq(withdrawalTransactions.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe("250000.00");
  });

  it("recovers from a concurrent double-submit race -- two simultaneous calls with the same idempotencyKey and matching content resolve to exactly one row", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();
    const input = {
      projectId,
      partyType: "partner" as const,
      shareId,
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "upi" as const,
      referenceNumber: null,
      notes: null,
      idempotencyKey,
      actorUserId,
    };

    const [resultA, resultB] = await Promise.all([
      port.recordTransaction(input),
      port.recordTransaction(input),
    ]);

    // Exactly one of the two genuinely inserted the row; the other recovered
    // by reading back the winner.
    expect([resultA.created, resultB.created].filter(Boolean)).toHaveLength(1);
    expect(resultA.transaction.id).toBe(resultB.transaction.id);

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalTransactions)
      .where(eq(withdrawalTransactions.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, rows[0]!.id));
    expect(auditRows).toHaveLength(1);
  });

  it("scopes listByProjectId strictly to the given project, ordered chronologically", async () => {
    const port = createWithdrawalTransactionPort();
    const projectA = await seedProject();
    const projectB = await seedProject();
    const actorUserId = await seedActor();

    async function record(projectId: string, amount: string): Promise<void> {
      await port.recordTransaction({
        projectId,
        partyType: "partner",
        shareId: uuidv7(),
        sharePercentSnapshot: "50" as Percent,
        canTakeSnapshot: "500000" as Money,
        amount: amount as Money,
        transactionDate: "2026-10-05",
        paymentMode: "cash",
        referenceNumber: null,
        notes: null,
        idempotencyKey: uuidv7(),
        actorUserId,
      });
    }

    await record(projectA, "100000");
    await record(projectA, "200000");
    await record(projectB, "999999");

    const listed = await port.listByProjectId(projectA);

    expect(listed).toHaveLength(2);
    expect(listed.every((tx) => tx.projectId === projectA)).toBe(true);
    expect(listed[0]?.amount).toBe("100000.00");
    expect(listed[1]?.amount).toBe("200000.00");
  });

  it("returns an empty array for a project with no recorded withdrawals", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();

    const listed = await port.listByProjectId(projectId);

    expect(listed).toEqual([]);
  });
});

/**
 * Live-Postgres coverage for `sumActiveAmountByProjectId` (Story 4.9, FR29,
 * review finding -- this SQL directly feeds the Can Take fix and, before
 * this test, was only ever exercised via a fully-mocked port in
 * `can-take/route.test.ts`, so the actual Drizzle-generated `coalesce(sum(...),
 * 0)` query had zero real coverage). Mirrors
 * `investment-transaction-port.test.ts`'s `sumActiveAmountByProjectId`
 * describe block one ledger over -- multiple rows summed, the zero-case,
 * and strict Project-scoping -- minus a `status` filter, since
 * `withdrawal_transactions` has no `status` column yet (no withdrawal-
 * cancel path exists -- Story 4.11's job).
 */
describe("createWithdrawalTransactionPort.sumActiveAmountByProjectId (live Postgres)", () => {
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
    await db.insert(projects).values({ id: projectId, name: `sum-withdrawn-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedWithdrawal(projectId: string, amount: string): Promise<void> {
    const db = getDb();
    await db.insert(withdrawalTransactions).values({
      id: uuidv7(),
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50",
      canTakeSnapshot: amount,
      amount,
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
    });
  }

  it("sums multiple withdrawal rows for the same project", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();

    await seedWithdrawal(projectId, "200000");
    await seedWithdrawal(projectId, "50000");
    await seedWithdrawal(projectId, "30000");

    const total = await port.sumActiveAmountByProjectId(projectId);

    expect(total).toBe("280000.00");
  });

  it("returns \"0\" for a project with zero withdrawals", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();

    const total = await port.sumActiveAmountByProjectId(projectId);

    expect(total).toBe("0");
  });

  it("scopes strictly to the given projectId -- a withdrawal on a different project is never counted", async () => {
    const port = createWithdrawalTransactionPort();
    const projectA = await seedProject();
    const projectB = await seedProject();

    await seedWithdrawal(projectA, "100000");
    await seedWithdrawal(projectB, "999999");

    const total = await port.sumActiveAmountByProjectId(projectA);

    expect(total).toBe("100000.00");
  });
});

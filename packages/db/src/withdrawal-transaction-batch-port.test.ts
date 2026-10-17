import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { WithdrawalIdempotencyKeyConflictError } from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import {
  createWithdrawalReallocationPort,
  createWithdrawalTransactionPort,
  recordWithdrawalTransactionBatchWithBonusConsumption,
} from "./ports";
import { auditLog, projects, users, withdrawalReallocations, withdrawalTransactions } from "./schema";

// Mirrors `investment-transaction-batch-port.test.ts`'s own defensive
// `DATABASE_URL` loading -- CI already sets it as a job-level env var (a
// no-op here, since `dotenv` never overwrites an already-set variable),
// while local `vitest run` has no other mechanism to pick it up from the
// repo-root `.env`.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createWithdrawalTransactionPort.recordTransactionBatch`
 * (multi-payment-method split withdrawal entry) -- mirrors
 * `investment-transaction-batch-port.test.ts`'s identical describe block one
 * ledger over: the atomic multi-row write (every row + its own paired
 * `audit_log` row, inside one DB transaction), the straightforward
 * batch-level idempotent-replay path, the content-mismatch conflict path,
 * and the concurrent-double-submit unique-violation race-recovery path --
 * all against the real `idempotency_key` UNIQUE constraint each row's
 * deterministic `` `${batchKey}:${index}` `` key depends on.
 *
 * Unlike the investment side, `withdrawal_transactions` has no
 * `requirement_id` foreign key -- it's Project-scoped, not
 * Requirement-scoped (mirrors `withdrawal-transaction-port.test.ts`'s own
 * seeding, no `seedRequirement` helper needed).
 */
describe("createWithdrawalTransactionPort.recordTransactionBatch (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
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
    await db.insert(projects).values({ id: projectId, name: `withdrawal-tx-batch-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `withdrawal-tx-batch-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  function makeBatchInput(overrides: {
    projectId: string;
    shareId: string;
    idempotencyKey: string;
    actorUserId: string;
    rows?: ReadonlyArray<{
      amount: Money;
      paymentMode: "cash" | "cheque" | "neft" | "rtgs" | "imps" | "upi" | "bank_transfer" | "other";
      referenceNumber: string | null;
      notes: string | null;
    }>;
  }) {
    return {
      projectId: overrides.projectId,
      partyType: "partner" as const,
      shareId: overrides.shareId,
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      transactionDate: "2026-10-05",
      rows: overrides.rows ?? [
        { amount: "150000" as Money, paymentMode: "cash" as const, referenceNumber: null, notes: null },
        { amount: "100000" as Money, paymentMode: "rtgs" as const, referenceNumber: "UTR-1", notes: "Split withdrawal" },
      ],
      idempotencyKey: overrides.idempotencyKey,
      actorUserId: overrides.actorUserId,
    };
  }

  it("atomically writes every row plus its own paired audit_log row, inside one DB transaction, each with its own deterministic idempotency_key", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();

    const result = await port.recordTransactionBatch(
      makeBatchInput({ projectId, shareId, idempotencyKey, actorUserId }),
    );

    expect(result.created).toBe(true);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.amount).toBe("150000.00");
    expect(result.transactions[0]?.paymentMode).toBe("cash");
    expect(result.transactions[1]?.amount).toBe("100000.00");
    expect(result.transactions[1]?.paymentMode).toBe("rtgs");
    expect(result.transactions[1]?.referenceNumber).toBe("UTR-1");
    // Both rows share the same party/Can-Take-snapshot -- one Take Now
    // event, split across payment methods.
    for (const tx of result.transactions) {
      expect(tx.projectId).toBe(projectId);
      expect(tx.shareId).toBe(shareId);
      expect(tx.sharePercentSnapshot).toBe("50.0000");
      expect(tx.canTakeSnapshot).toBe("500000.00");
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalTransactions)
      .where(inArray(withdrawalTransactions.idempotencyKey, [`${idempotencyKey}:0`, `${idempotencyKey}:1`]));
    expect(rows).toHaveLength(2);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        inArray(
          auditLog.entityId,
          result.transactions.map((t) => t.id),
        ),
      );
    expect(auditRows).toHaveLength(2);
    for (const entry of auditRows) {
      expect(entry.entityType).toBe("withdrawal_transaction");
      expect(entry.action).toBe("create");
      expect(entry.actorUserId).toBe(actorUserId);
      expect(entry.oldValue).toBeNull();
    }
  });

  it("replays an idempotent resubmission with identical content -- still exactly the original rows, created: false, no duplicates", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();
    const input = makeBatchInput({ projectId, shareId, idempotencyKey, actorUserId });

    const first = await port.recordTransactionBatch(input);
    const second = await port.recordTransactionBatch(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.transactions.map((t) => t.id)).toEqual(first.transactions.map((t) => t.id));

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalTransactions)
      .where(inArray(withdrawalTransactions.idempotencyKey, [`${idempotencyKey}:0`, `${idempotencyKey}:1`]));
    expect(rows).toHaveLength(2);
  });

  it("rejects a same-idempotencyKey resubmission with mismatched content -- WithdrawalIdempotencyKeyConflictError, no new rows", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();

    await port.recordTransactionBatch(makeBatchInput({ projectId, shareId, idempotencyKey, actorUserId }));

    await expect(
      port.recordTransactionBatch(
        makeBatchInput({
          projectId,
          shareId,
          idempotencyKey,
          actorUserId,
          // Mismatched second row amount -- a genuine key collision, not a replay.
          rows: [
            { amount: "150000" as Money, paymentMode: "cash", referenceNumber: null, notes: null },
            { amount: "999999" as Money, paymentMode: "rtgs", referenceNumber: "UTR-1", notes: "Split withdrawal" },
          ],
        }),
      ),
    ).rejects.toThrow(WithdrawalIdempotencyKeyConflictError);

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalTransactions)
      .where(inArray(withdrawalTransactions.idempotencyKey, [`${idempotencyKey}:0`, `${idempotencyKey}:1`]));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.idempotencyKey === `${idempotencyKey}:1`)?.amount).toBe("100000.00");
  });

  it("recovers from a concurrent double-submit race -- two simultaneous identical batches resolve to exactly the same rows, never double-inserted", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();
    const input = makeBatchInput({ projectId, shareId, idempotencyKey, actorUserId });

    const [resultA, resultB] = await Promise.all([
      port.recordTransactionBatch(input),
      port.recordTransactionBatch(input),
    ]);

    expect([resultA.created, resultB.created].filter(Boolean)).toHaveLength(1);
    expect(resultA.transactions.map((t) => t.id)).toEqual(resultB.transactions.map((t) => t.id));

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalTransactions)
      .where(inArray(withdrawalTransactions.idempotencyKey, [`${idempotencyKey}:0`, `${idempotencyKey}:1`]));
    expect(rows).toHaveLength(2);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        inArray(
          auditLog.entityId,
          rows.map((r) => r.id),
        ),
      );
    expect(auditRows).toHaveLength(2);
  });
});

/**
 * Live-Postgres coverage for `recordWithdrawalTransactionBatchWithBonusConsumption`
 * -- mirrors `withdrawal-reallocation-port.test.ts`'s
 * `recordWithdrawalTransactionWithBonusConsumption` describe block one level
 * over (the single-row analog): FIFO leg consumption and the N-row insert
 * happening atomically inside one DB transaction.
 */
describe("recordWithdrawalTransactionBatchWithBonusConsumption (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds));
    }
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      await db.delete(withdrawalTransactions).where(inArray(withdrawalTransactions.projectId, projectIds));
      await db.delete(withdrawalReallocations).where(inArray(withdrawalReallocations.projectId, projectIds));
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `bonus-consumption-batch-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `bonus-consumption-batch-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  function baseBatchInput(overrides: {
    projectId: string;
    shareId: string;
    actorUserId: string;
    rows?: ReadonlyArray<{
      amount: Money;
      paymentMode: "cash" | "cheque" | "neft" | "rtgs" | "imps" | "upi" | "bank_transfer" | "other";
      referenceNumber: string | null;
      notes: string | null;
    }>;
    idempotencyKey?: string;
  }) {
    return {
      projectId: overrides.projectId,
      partyType: "partner" as const,
      shareId: overrides.shareId,
      sharePercentSnapshot: "30" as Percent,
      canTakeSnapshot: "150000" as Money,
      transactionDate: "2026-09-28",
      rows: overrides.rows ?? [
        { amount: "100000" as Money, paymentMode: "bank_transfer" as const, referenceNumber: null, notes: null },
        { amount: "80000" as Money, paymentMode: "cash" as const, referenceNumber: null, notes: null },
      ],
      idempotencyKey: overrides.idempotencyKey ?? uuidv7(),
      actorUserId: overrides.actorUserId,
    };
  }

  it("with bonusToConsume '0', behaves identically to plain recordTransactionBatch -- no reallocation legs touched", async () => {
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();

    const result = await recordWithdrawalTransactionBatchWithBonusConsumption(
      baseBatchInput({ projectId, shareId, actorUserId }),
      "0" as Money,
    );

    expect(result.created).toBe(true);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.amount).toBe("100000.00");
    expect(result.transactions[1]?.amount).toBe("80000.00");
  });

  it("consumes a single recipient leg FIFO and records every row of the batch atomically", async () => {
    const reallocationPort = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const recipientShareId = uuidv7();

    const { allocations, reallocation } = await reallocationPort.record(
      {
        projectId,
        partyType: "partner",
        shareId: uuidv7(),
        declinedAmount: "60000" as Money,
        baseCanTake: "99999999" as Money,
        notes: null,
      },
      [{ partyType: "partner", shareId: recipientShareId, allocatedAmount: "60000" as Money }],
      uuidv7(),
      actorUserId,
    );

    const result = await recordWithdrawalTransactionBatchWithBonusConsumption(
      baseBatchInput({
        projectId,
        shareId: recipientShareId,
        actorUserId,
        rows: [
          { amount: "120000" as Money, paymentMode: "cash", referenceNumber: null, notes: null },
          { amount: "60000" as Money, paymentMode: "neft", referenceNumber: null, notes: null },
        ],
      }),
      "40000" as Money,
    );

    expect(result.created).toBe(true);
    expect(result.transactions).toHaveLength(2);

    const updatedLegs = await reallocationPort.listAllocationsByReallocationId(reallocation.id);
    const leg = updatedLegs.find((l) => l.id === allocations[0]?.id);
    expect(leg?.consumedAmount).toBe("40000.00");
  });

  it("rolls back leg consumption if any row of the batch fails to insert (duplicate idempotency key mismatch never partially applied)", async () => {
    const reallocationPort = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const recipientShareId = uuidv7();
    const sharedIdempotencyKey = uuidv7();

    const { allocations, reallocation } = await reallocationPort.record(
      {
        projectId,
        partyType: "partner",
        shareId: uuidv7(),
        declinedAmount: "30000" as Money,
        baseCanTake: "99999999" as Money,
        notes: null,
      },
      [{ partyType: "partner", shareId: recipientShareId, allocatedAmount: "30000" as Money }],
      uuidv7(),
      actorUserId,
    );

    // Pre-seed a withdrawal_transactions row under the batch's FIRST derived
    // per-row key (`${sharedIdempotencyKey}:0`) but with different content,
    // so the nested recordTransactionBatch call's own insert throws a
    // unique-violation AFTER this function has already planned/written the
    // leg consumption inside the same outer transaction -- proving the
    // whole transaction rolls back together, not just the row insert.
    const db = getDb();
    await db.insert(withdrawalTransactions).values({
      id: uuidv7(),
      projectId,
      partyType: "partner",
      shareId: recipientShareId,
      sharePercentSnapshot: "50",
      canTakeSnapshot: "999999",
      amount: "999999",
      transactionDate: "2026-01-01",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: `${sharedIdempotencyKey}:0`,
    });

    await expect(
      recordWithdrawalTransactionBatchWithBonusConsumption(
        baseBatchInput({
          projectId,
          shareId: recipientShareId,
          actorUserId,
          idempotencyKey: sharedIdempotencyKey,
          rows: [
            { amount: "50000" as Money, paymentMode: "cash", referenceNumber: null, notes: null },
            { amount: "30000" as Money, paymentMode: "neft", referenceNumber: null, notes: null },
          ],
        }),
        "20000" as Money,
      ),
    ).rejects.toThrow();

    const legsAfter = await reallocationPort.listAllocationsByReallocationId(reallocation.id);
    expect(legsAfter.find((l) => l.id === allocations[0]?.id)?.consumedAmount).toBe("0.00");
  });
});

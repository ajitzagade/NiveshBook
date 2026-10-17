import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { IdempotencyKeyConflictError } from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import { createInvestmentTransactionPort } from "./ports";
import { auditLog, investmentRequirements, investmentTransactions, projects, users } from "./schema";

// Mirrors `withdrawal-transaction-port.test.ts`'s own defensive `DATABASE_URL`
// loading -- CI already sets it as a job-level env var (a no-op here, since
// `dotenv` never overwrites an already-set variable), while local
// `vitest run` has no other mechanism to pick it up from the repo-root `.env`.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createInvestmentTransactionPort.recordTransactionBatch`
 * (multi-payment-method entry) -- mirrors `withdrawal-transaction-port.test.ts`'s
 * `recordTransaction` describe block one level over: the atomic multi-row
 * write (every row + its own paired `audit_log` row, inside one DB
 * transaction), the straightforward batch-level idempotent-replay path, the
 * content-mismatch conflict path, and the concurrent-double-submit
 * unique-violation race-recovery path -- all against the real
 * `idempotency_key` UNIQUE constraint each row's deterministic
 * `` `${batchKey}:${index}` `` key depends on.
 */
describe("createInvestmentTransactionPort.recordTransactionBatch (live Postgres)", () => {
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
    await db.insert(projects).values({ id: projectId, name: `investment-tx-batch-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  /** `investment_transactions.requirement_id` is a real FK -- mirrors `investment-transaction-port.test.ts`'s identical `seedRequirement` helper. */
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

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `investment-tx-batch-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  function makeBatchInput(overrides: {
    projectId: string;
    requirementId: string;
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
      requirementId: overrides.requirementId,
      projectId: overrides.projectId,
      partyType: "partner" as const,
      shareId: overrides.shareId,
      sharePercentSnapshot: "50" as Percent,
      shouldPaySnapshot: "500000" as Money,
      transactionDate: "2026-10-05",
      rows: overrides.rows ?? [
        { amount: "500000" as Money, paymentMode: "cash" as const, referenceNumber: null, notes: null },
        { amount: "200000" as Money, paymentMode: "rtgs" as const, referenceNumber: "UTR-1", notes: "Split payment" },
      ],
      idempotencyKey: overrides.idempotencyKey,
      actorUserId: overrides.actorUserId,
    };
  }

  it("atomically writes every row plus its own paired audit_log row, inside one DB transaction, each with its own deterministic idempotency_key", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const requirementId = await seedRequirement(projectId);
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();

    const result = await port.recordTransactionBatch(
      makeBatchInput({ projectId, requirementId, shareId, idempotencyKey, actorUserId }),
    );

    expect(result.created).toBe(true);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.amount).toBe("500000.00");
    expect(result.transactions[0]?.paymentMode).toBe("cash");
    expect(result.transactions[1]?.amount).toBe("200000.00");
    expect(result.transactions[1]?.paymentMode).toBe("rtgs");
    expect(result.transactions[1]?.referenceNumber).toBe("UTR-1");
    // Both rows share the same party/requirement/Should-Pay-snapshot -- one
    // contribution, split across payment methods.
    for (const tx of result.transactions) {
      expect(tx.requirementId).toBe(requirementId);
      expect(tx.shareId).toBe(shareId);
      expect(tx.sharePercentSnapshot).toBe("50.0000");
      expect(tx.shouldPaySnapshot).toBe("500000.00");
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(investmentTransactions)
      .where(inArray(investmentTransactions.idempotencyKey, [`${idempotencyKey}:0`, `${idempotencyKey}:1`]));
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
      expect(entry.entityType).toBe("investment_transaction");
      expect(entry.action).toBe("create");
      expect(entry.actorUserId).toBe(actorUserId);
      expect(entry.oldValue).toBeNull();
    }
  });

  it("replays an idempotent resubmission with identical content -- still exactly the original rows, created: false, no duplicates", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const requirementId = await seedRequirement(projectId);
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();
    const input = makeBatchInput({ projectId, requirementId, shareId, idempotencyKey, actorUserId });

    const first = await port.recordTransactionBatch(input);
    const second = await port.recordTransactionBatch(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.transactions.map((t) => t.id)).toEqual(first.transactions.map((t) => t.id));

    const db = getDb();
    const rows = await db
      .select()
      .from(investmentTransactions)
      .where(inArray(investmentTransactions.idempotencyKey, [`${idempotencyKey}:0`, `${idempotencyKey}:1`]));
    expect(rows).toHaveLength(2);
  });

  it("rejects a same-idempotencyKey resubmission with mismatched content -- IdempotencyKeyConflictError, no new rows", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const requirementId = await seedRequirement(projectId);
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();

    await port.recordTransactionBatch(
      makeBatchInput({ projectId, requirementId, shareId, idempotencyKey, actorUserId }),
    );

    await expect(
      port.recordTransactionBatch(
        makeBatchInput({
          projectId,
          requirementId,
          shareId,
          idempotencyKey,
          actorUserId,
          // Mismatched second row amount -- a genuine key collision, not a replay.
          rows: [
            { amount: "500000" as Money, paymentMode: "cash", referenceNumber: null, notes: null },
            { amount: "999999" as Money, paymentMode: "rtgs", referenceNumber: "UTR-1", notes: "Split payment" },
          ],
        }),
      ),
    ).rejects.toThrow(IdempotencyKeyConflictError);

    const db = getDb();
    const rows = await db
      .select()
      .from(investmentTransactions)
      .where(inArray(investmentTransactions.idempotencyKey, [`${idempotencyKey}:0`, `${idempotencyKey}:1`]));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.idempotencyKey === `${idempotencyKey}:1`)?.amount).toBe("200000.00");
  });

  it("recovers from a concurrent double-submit race -- two simultaneous identical batches resolve to exactly the same rows, never double-inserted", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const requirementId = await seedRequirement(projectId);
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();
    const input = makeBatchInput({ projectId, requirementId, shareId, idempotencyKey, actorUserId });

    const [resultA, resultB] = await Promise.all([
      port.recordTransactionBatch(input),
      port.recordTransactionBatch(input),
    ]);

    expect([resultA.created, resultB.created].filter(Boolean)).toHaveLength(1);
    expect(resultA.transactions.map((t) => t.id)).toEqual(resultB.transactions.map((t) => t.id));

    const db = getDb();
    const rows = await db
      .select()
      .from(investmentTransactions)
      .where(inArray(investmentTransactions.idempotencyKey, [`${idempotencyKey}:0`, `${idempotencyKey}:1`]));
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

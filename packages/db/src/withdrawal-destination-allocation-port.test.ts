import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  AlreadyAllocatedError,
  WithdrawalDestinationAllocationIdempotencyKeyConflictError,
  type CreateWithdrawalDestinationAllocationLegInput,
} from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import { createWithdrawalDestinationAllocationPort, createWithdrawalTransactionPort } from "./ports";
import { auditLog, projects, users, withdrawalDestinationAllocations } from "./schema";

// Mirrors `withdrawal-transaction-port.test.ts`'s own defensive
// `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for
 * `createWithdrawalDestinationAllocationPort.recordAllocation` (Story 4.7,
 * FR27) -- mirrors `withdrawal-transaction-port.test.ts`'s established
 * pattern one story over, applied to the multi-row atomic write + write-once
 * precondition + idempotent-replay + content-mismatch-conflict + concurrent-
 * race paths this story's own Decisions/I-O matrix call out for real DB
 * coverage: this table's `idempotencyKey` column is deliberately NOT unique
 * (schema.ts -- one save inserts several sibling rows sharing a key), so the
 * concurrency-correctness story here rests entirely on the port's `SELECT
 * ... FOR UPDATE` lock on the parent `withdrawal_transactions` row, not on a
 * UNIQUE-constraint-violation race recovery like
 * `createWithdrawalTransactionPort`'s.
 */
describe("createWithdrawalDestinationAllocationPort.recordAllocation (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds.splice(0)));
    }
    for (const id of seededProjectIds.splice(0)) {
      // withdrawal_transactions cascade-deletes via projects; withdrawal_destination_allocations
      // cascade-deletes via withdrawal_transactions -- one project delete clears the whole chain.
      await db.delete(projects).where(eq(projects.id, id));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `alloc-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `alloc-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  async function seedWithdrawal(projectId: string, actorUserId: string, amount: string): Promise<string> {
    const port = createWithdrawalTransactionPort();
    const result = await port.recordTransaction({
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: amount as Money,
      transactionDate: "2026-10-05",
      paymentMode: "neft",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });
    return result.transaction.id;
  }

  function legs(
    overrides: Partial<CreateWithdrawalDestinationAllocationLegInput>[] = [{}],
  ): CreateWithdrawalDestinationAllocationLegInput[] {
    return overrides.map((override) => ({
      destinationType: "other",
      amount: "250000" as Money,
      destinationProjectId: null,
      personName: null,
      notes: "Kept as cash",
      ...override,
    }));
  }

  it("atomically writes every leg row plus one paired audit_log row (AC1 -- 3 legs, every column mapped correctly)", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const idempotencyKey = uuidv7();

    const result = await port.recordAllocation(
      withdrawalTransactionId,
      legs([
        { destinationType: "project", amount: "150000" as Money, destinationProjectId },
        { destinationType: "person", amount: "50000" as Money, personName: "Person X", notes: null },
        { destinationType: "available_balance", amount: "50000" as Money, notes: null },
      ]),
      idempotencyKey,
      actorUserId,
    );

    expect(result.created).toBe(true);
    expect(result.allocations).toHaveLength(3);
    expect(result.allocations.every((a) => a.withdrawalTransactionId === withdrawalTransactionId)).toBe(true);

    const projectLeg = result.allocations.find((a) => a.destinationType === "project");
    expect(projectLeg?.destinationProjectId).toBe(destinationProjectId);
    expect(projectLeg?.amount).toBe("150000.00");

    const personLeg = result.allocations.find((a) => a.destinationType === "person");
    expect(personLeg?.personName).toBe("Person X");

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));
    expect(rows).toHaveLength(3);

    // `withdrawalTransactionId` is also the `entityId` of the *withdrawal
    // transaction's own* "create" audit entry (`seedWithdrawal`'s call) --
    // filter by `entityType` too so that pre-existing row never inflates
    // this count.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, withdrawalTransactionId),
          eq(auditLog.entityType, "withdrawal_destination_allocation"),
        ),
      );
    expect(auditRows).toHaveLength(1);
    const entry = auditRows[0];
    expect(entry?.entityType).toBe("withdrawal_destination_allocation");
    expect(entry?.action).toBe("create");
    expect(entry?.actorUserId).toBe(actorUserId);
    expect(entry?.oldValue).toBeNull();
    expect(Array.isArray(entry?.newValue)).toBe(true);
    expect((entry?.newValue as unknown[]).length).toBe(3);
  });

  it("replays an idempotent resubmission with identical content -- exactly one set of rows, created: false, same allocations returned", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const idempotencyKey = uuidv7();
    const input = legs();

    const first = await port.recordAllocation(withdrawalTransactionId, input, idempotencyKey, actorUserId);
    const second = await port.recordAllocation(withdrawalTransactionId, input, idempotencyKey, actorUserId);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.allocations.map((a) => a.id).sort()).toEqual(first.allocations.map((a) => a.id).sort());

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));
    expect(rows).toHaveLength(1);
  });

  it("rejects a second allocation attempt for an already-allocated withdrawal (different idempotencyKey) -- AlreadyAllocatedError, no new rows", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");

    await port.recordAllocation(withdrawalTransactionId, legs(), uuidv7(), actorUserId);

    await expect(
      port.recordAllocation(withdrawalTransactionId, legs(), uuidv7(), actorUserId),
    ).rejects.toThrow(AlreadyAllocatedError);

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));
    expect(rows).toHaveLength(1);
  });

  it("rejects a same-idempotencyKey resubmission with mismatched content -- WithdrawalDestinationAllocationIdempotencyKeyConflictError, no new rows", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const idempotencyKey = uuidv7();

    await port.recordAllocation(withdrawalTransactionId, legs(), idempotencyKey, actorUserId);

    await expect(
      port.recordAllocation(
        withdrawalTransactionId,
        legs([{ amount: "999999" as Money }]),
        idempotencyKey,
        actorUserId,
      ),
    ).rejects.toThrow(WithdrawalDestinationAllocationIdempotencyKeyConflictError);

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe("250000.00");
  });

  it("rejects an idempotencyKey already used for a different withdrawal's allocation", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionIdA = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const withdrawalTransactionIdB = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const idempotencyKey = uuidv7();

    await port.recordAllocation(withdrawalTransactionIdA, legs(), idempotencyKey, actorUserId);

    await expect(
      port.recordAllocation(withdrawalTransactionIdB, legs(), idempotencyKey, actorUserId),
    ).rejects.toThrow(WithdrawalDestinationAllocationIdempotencyKeyConflictError);

    const db = getDb();
    const rowsB = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionIdB));
    expect(rowsB).toHaveLength(0);
  });

  it("recovers from a concurrent double-submit race -- two simultaneous calls with the same idempotencyKey and matching content resolve to exactly one set of rows", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const idempotencyKey = uuidv7();
    const input = legs();

    const [resultA, resultB] = await Promise.all([
      port.recordAllocation(withdrawalTransactionId, input, idempotencyKey, actorUserId),
      port.recordAllocation(withdrawalTransactionId, input, idempotencyKey, actorUserId),
    ]);

    expect([resultA.created, resultB.created].filter(Boolean)).toHaveLength(1);
    expect(resultA.allocations.map((a) => a.id).sort()).toEqual(resultB.allocations.map((a) => a.id).sort());

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));
    expect(rows).toHaveLength(1);

    // `withdrawalTransactionId` is also the `entityId` of the *withdrawal
    // transaction's own* "create" audit entry (`seedWithdrawal`'s call) --
    // filter by `entityType` too so that pre-existing row never inflates
    // this count.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, withdrawalTransactionId),
          eq(auditLog.entityType, "withdrawal_destination_allocation"),
        ),
      );
    expect(auditRows).toHaveLength(1);
  });

  it("listByWithdrawalTransactionId returns [] before any allocation is saved, and every leg afterward", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");

    expect(await port.listByWithdrawalTransactionId(withdrawalTransactionId)).toEqual([]);

    await port.recordAllocation(withdrawalTransactionId, legs(), uuidv7(), actorUserId);

    const listed = await port.listByWithdrawalTransactionId(withdrawalTransactionId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.withdrawalTransactionId).toBe(withdrawalTransactionId);
  });

  it("hasConflictingAllocation: false before any save, false for the exact idempotencyKey used, true for a different one", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const idempotencyKey = uuidv7();

    expect(await port.hasConflictingAllocation(withdrawalTransactionId, idempotencyKey)).toBe(false);

    await port.recordAllocation(withdrawalTransactionId, legs(), idempotencyKey, actorUserId);

    expect(await port.hasConflictingAllocation(withdrawalTransactionId, idempotencyKey)).toBe(false);
    expect(await port.hasConflictingAllocation(withdrawalTransactionId, uuidv7())).toBe(true);
  });
});

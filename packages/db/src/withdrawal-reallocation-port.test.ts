import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  WithdrawalReallocationIdempotencyKeyConflictError,
  WithdrawalReallocationNotFoundError,
  WithdrawalReallocationAlreadyCancelledError,
  WithdrawalReallocationAlreadyConsumedError,
} from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import {
  createWithdrawalReallocationPort,
  recordWithdrawalTransactionWithBonusConsumption,
} from "./ports";
import {
  withdrawalReallocations,
  withdrawalReallocationAllocations,
  withdrawalTransactions,
  auditLog,
  projects,
  users,
} from "./schema";

config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createWithdrawalReallocationPort` and
 * `recordWithdrawalTransactionWithBonusConsumption` (flexible pro-rata
 * withdrawal reallocation): the decline+legs write path (atomic create,
 * idempotent replay, key-conflict, cancel guard), and the FIFO bonus-
 * consumption path atomically paired with recording a withdrawal
 * transaction.
 */
describe("createWithdrawalReallocationPort (live Postgres)", () => {
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
    await db.insert(projects).values({ id: projectId, name: `withdrawal-realloc-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `withdrawal-realloc-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  it("inserts a reallocation row plus every allocation leg plus exactly one paired audit_log row, inside one atomic write -- created: true", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareIdA = uuidv7();
    const shareIdB = uuidv7();
    const shareIdC = uuidv7();

    const result = await port.record(
      { projectId, partyType: "partner", shareId: shareIdA, declinedAmount: "100000" as Money, baseCanTake: "99999999" as Money, notes: "Skipping this round" },
      [
        { partyType: "partner", shareId: shareIdB, allocatedAmount: "60000" as Money },
        { partyType: "partner", shareId: shareIdC, allocatedAmount: "40000" as Money },
      ],
      uuidv7(),
      actorUserId,
    );

    expect(result.created).toBe(true);
    expect(result.reallocation.projectId).toBe(projectId);
    expect(result.reallocation.shareId).toBe(shareIdA);
    expect(result.reallocation.declinedAmount).toBe("100000.00");
    expect(result.reallocation.status).toBe("active");
    expect(result.allocations).toHaveLength(2);
    expect(result.allocations.map((a) => a.allocatedAmount).sort()).toEqual(["40000.00", "60000.00"]);
    expect(result.allocations.every((a) => a.consumedAmount === "0.00")).toBe(true);

    const db = getDb();
    const legRows = await db
      .select()
      .from(withdrawalReallocationAllocations)
      .where(eq(withdrawalReallocationAllocations.reallocationId, result.reallocation.id));
    expect(legRows).toHaveLength(2);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, result.reallocation.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("create");
    expect(auditRows[0]?.entityType).toBe("withdrawal_reallocation");
  });

  it("replays an idempotent resubmission with identical content -- created: false, same reallocation id, no duplicate rows", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const idempotencyKey = uuidv7();
    const input = {
      projectId,
      partyType: "partner" as const,
      shareId: uuidv7(),
      declinedAmount: "50000" as Money, baseCanTake: "99999999" as Money,
      notes: null,
    };
    const legs = [{ partyType: "partner" as const, shareId: uuidv7(), allocatedAmount: "50000" as Money }];

    const first = await port.record(input, legs, idempotencyKey, actorUserId);
    const second = await port.record(input, legs, idempotencyKey, actorUserId);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.reallocation.id).toBe(first.reallocation.id);

    const db = getDb();
    const rows = await db.select().from(withdrawalReallocations).where(eq(withdrawalReallocations.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it("rejects a same-idempotencyKey resubmission with mismatched content -- WithdrawalReallocationIdempotencyKeyConflictError", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const idempotencyKey = uuidv7();
    const shareId = uuidv7();
    const recipient = uuidv7();

    await port.record(
      { projectId, partyType: "partner", shareId, declinedAmount: "10000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: recipient, allocatedAmount: "10000" as Money }],
      idempotencyKey,
      actorUserId,
    );

    await expect(
      port.record(
        { projectId, partyType: "partner", shareId, declinedAmount: "9999" as Money, baseCanTake: "99999999" as Money, notes: null },
        [{ partyType: "partner", shareId: recipient, allocatedAmount: "9999" as Money }],
        idempotencyKey,
        actorUserId,
      ),
    ).rejects.toBeInstanceOf(WithdrawalReallocationIdempotencyKeyConflictError);
  });

  it("re-validates declinedAmount against a fresh read of this share's active declines at record time, not just the caller's own pre-check -- WithdrawalReallocationExceedsAvailableError once a prior decline for the same share already consumed the ceiling", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const decliningShareId = uuidv7();
    const recipient = uuidv7();

    // First decline: 60000 of a 100000 baseCanTake -- leaves only 40000
    // effectively available for this share going forward.
    await port.record(
      {
        projectId,
        partyType: "partner",
        shareId: decliningShareId,
        declinedAmount: "60000" as Money,
        baseCanTake: "100000" as Money,
        notes: null,
      },
      [{ partyType: "partner", shareId: recipient, allocatedAmount: "60000" as Money }],
      uuidv7(),
      actorUserId,
    );

    // A second, independent decline request for the SAME share -- as if the
    // caller's own pre-check ran against a stale snapshot that didn't yet
    // see the first decline above (the exact race this re-check closes).
    // 50000 no longer fits within the 40000 truly still available.
    await expect(
      port.record(
        {
          projectId,
          partyType: "partner",
          shareId: decliningShareId,
          declinedAmount: "50000" as Money,
          baseCanTake: "100000" as Money,
          notes: null,
        },
        [{ partyType: "partner", shareId: recipient, allocatedAmount: "50000" as Money }],
        uuidv7(),
        actorUserId,
      ),
    ).rejects.toThrow("Cannot decline more than this Partner/Sub-partner's own currently-available Can Take.");

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalReallocations)
      .where(eq(withdrawalReallocations.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it("listActiveByProjectId and listActiveAllocationsByProjectId include a freshly-recorded active decline, scoped to the project", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const recipient = uuidv7();

    const { reallocation, allocations } = await port.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "20000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: recipient, allocatedAmount: "20000" as Money }],
      uuidv7(),
      actorUserId,
    );

    const activeReallocations = await port.listActiveByProjectId(projectId);
    const activeAllocations = await port.listActiveAllocationsByProjectId(projectId);

    expect(activeReallocations.find((r) => r.id === reallocation.id)).toBeDefined();
    expect(activeAllocations.find((a) => a.id === allocations[0]?.id)).toBeDefined();
  });

  it("cancel marks an unconsumed reallocation cancelled and writes a paired audit_log row", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();

    const { reallocation } = await port.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "30000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: uuidv7(), allocatedAmount: "30000" as Money }],
      uuidv7(),
      actorUserId,
    );

    const cancelled = await port.cancel(reallocation.id, actorUserId);

    expect(cancelled.status).toBe("cancelled");
    const activeAfter = await port.listActiveByProjectId(projectId);
    expect(activeAfter.find((r) => r.id === reallocation.id)).toBeUndefined();

    const db = getDb();
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, reallocation.id));
    expect(auditRows.some((row) => row.action === "cancel")).toBe(true);
  });

  it("cancel throws WithdrawalReallocationNotFoundError for an id that doesn't exist", async () => {
    const port = createWithdrawalReallocationPort();
    const actorUserId = await seedActor();

    await expect(port.cancel(uuidv7(), actorUserId)).rejects.toBeInstanceOf(WithdrawalReallocationNotFoundError);
  });

  it("cancel throws WithdrawalReallocationAlreadyCancelledError on a second cancel of the same reallocation", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();

    const { reallocation } = await port.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "5000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: uuidv7(), allocatedAmount: "5000" as Money }],
      uuidv7(),
      actorUserId,
    );

    await port.cancel(reallocation.id, actorUserId);

    await expect(port.cancel(reallocation.id, actorUserId)).rejects.toBeInstanceOf(
      WithdrawalReallocationAlreadyCancelledError,
    );
  });

  it("cancel throws WithdrawalReallocationAlreadyConsumedError once any leg has been consumed", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const recipientShareId = uuidv7();

    const { reallocation, allocations } = await port.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "20000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: recipientShareId, allocatedAmount: "20000" as Money }],
      uuidv7(),
      actorUserId,
    );

    await port.consumeAllocationLegs([{ id: allocations[0]?.id as string, newConsumedAmount: "5000" as Money }]);

    await expect(port.cancel(reallocation.id, actorUserId)).rejects.toBeInstanceOf(
      WithdrawalReallocationAlreadyConsumedError,
    );
  });

  it("findById returns the matching reallocation, or null for an unknown id", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();

    const { reallocation } = await port.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "1000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: uuidv7(), allocatedAmount: "1000" as Money }],
      uuidv7(),
      actorUserId,
    );

    expect(await port.findById(reallocation.id)).toEqual(reallocation);
    expect(await port.findById(uuidv7())).toBeNull();
  });

  it("listAll/listAllAllocations include rows across every project", async () => {
    const port = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();

    const { reallocation, allocations } = await port.record(
      { projectId, partyType: "sub_partner", shareId: uuidv7(), declinedAmount: "7000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: uuidv7(), allocatedAmount: "7000" as Money }],
      uuidv7(),
      actorUserId,
    );

    const all = await port.listAll();
    const allAllocations = await port.listAllAllocations();

    expect(all.find((r) => r.id === reallocation.id)).toEqual(reallocation);
    expect(allAllocations.find((a) => a.id === allocations[0]?.id)).toEqual(allocations[0]);
  });
});

describe("recordWithdrawalTransactionWithBonusConsumption (live Postgres)", () => {
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
    await db.insert(projects).values({ id: projectId, name: `bonus-consumption-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `bonus-consumption-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  function baseWithdrawalInput(overrides: Partial<Parameters<typeof recordWithdrawalTransactionWithBonusConsumption>[0]>) {
    return {
      projectId: overrides.projectId as string,
      partyType: "partner" as const,
      shareId: overrides.shareId as string,
      sharePercentSnapshot: "30" as Percent,
      canTakeSnapshot: "150000" as Money,
      amount: "150000" as Money,
      transactionDate: "2026-09-28",
      paymentMode: "bank_transfer" as const,
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId: overrides.actorUserId as string,
      ...overrides,
    };
  }

  it("with bonusToConsume '0', behaves identically to plain recordTransaction -- no reallocation legs touched", async () => {
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();

    const result = await recordWithdrawalTransactionWithBonusConsumption(
      baseWithdrawalInput({ projectId, shareId, actorUserId, amount: "100000" as Money }),
      "0" as Money,
    );

    expect(result.created).toBe(true);
    expect(result.transaction.amount).toBe("100000.00");
  });

  it("consumes a single recipient leg FIFO and records the withdrawal transaction atomically", async () => {
    const reallocationPort = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const recipientShareId = uuidv7();

    const { allocations, reallocation } = await reallocationPort.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "60000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: recipientShareId, allocatedAmount: "60000" as Money }],
      uuidv7(),
      actorUserId,
    );

    const result = await recordWithdrawalTransactionWithBonusConsumption(
      baseWithdrawalInput({ projectId, shareId: recipientShareId, actorUserId, amount: "180000" as Money }),
      "40000" as Money,
    );

    expect(result.created).toBe(true);
    expect(result.transaction.amount).toBe("180000.00");

    const updatedLegs = await reallocationPort.listAllocationsByReallocationId(reallocation.id);
    const leg = updatedLegs.find((l) => l.id === allocations[0]?.id);
    expect(leg?.consumedAmount).toBe("40000.00");
  });

  it("draws FIFO across two legs from different declines, oldest first", async () => {
    const reallocationPort = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const recipientShareId = uuidv7();

    const first = await reallocationPort.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "20000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: recipientShareId, allocatedAmount: "20000" as Money }],
      uuidv7(),
      actorUserId,
    );
    const second = await reallocationPort.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "50000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: recipientShareId, allocatedAmount: "50000" as Money }],
      uuidv7(),
      actorUserId,
    );

    await recordWithdrawalTransactionWithBonusConsumption(
      baseWithdrawalInput({ projectId, shareId: recipientShareId, actorUserId, amount: "35000" as Money }),
      "35000" as Money,
    );

    const firstLegs = await reallocationPort.listAllocationsByReallocationId(first.reallocation.id);
    const secondLegs = await reallocationPort.listAllocationsByReallocationId(second.reallocation.id);

    expect(firstLegs[0]?.consumedAmount).toBe("20000.00");
    expect(secondLegs[0]?.consumedAmount).toBe("15000.00");
  });

  it("rolls back leg consumption if the withdrawal transaction insert fails (duplicate idempotency key mismatch never partially applied)", async () => {
    const reallocationPort = createWithdrawalReallocationPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const recipientShareId = uuidv7();
    const sharedIdempotencyKey = uuidv7();

    const { allocations, reallocation } = await reallocationPort.record(
      { projectId, partyType: "partner", shareId: uuidv7(), declinedAmount: "30000" as Money, baseCanTake: "99999999" as Money, notes: null },
      [{ partyType: "partner", shareId: recipientShareId, allocatedAmount: "30000" as Money }],
      uuidv7(),
      actorUserId,
    );

    // Pre-seed a withdrawal_transactions row under the same idempotency key
    // but with different content, so the nested recordTransaction call
    // throws a conflict AFTER this function has already planned/written the
    // leg consumption inside the same outer transaction -- proving the whole
    // transaction rolls back together, not just the transaction insert.
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
      idempotencyKey: sharedIdempotencyKey,
    });

    await expect(
      recordWithdrawalTransactionWithBonusConsumption(
        baseWithdrawalInput({
          projectId,
          shareId: recipientShareId,
          actorUserId,
          amount: "50000" as Money,
          idempotencyKey: sharedIdempotencyKey,
        }),
        "20000" as Money,
      ),
    ).rejects.toThrow();

    const legsAfter = await reallocationPort.listAllocationsByReallocationId(reallocation.id);
    expect(legsAfter.find((l) => l.id === allocations[0]?.id)?.consumedAmount).toBe("0.00");
  });
});

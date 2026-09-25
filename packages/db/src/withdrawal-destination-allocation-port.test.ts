import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  AlreadyAllocatedError,
  SharesNotFullyAllocatedError,
  WithdrawalDestinationAllocationIdempotencyKeyConflictError,
  type CreateWithdrawalDestinationAllocationLegInput,
  type DestinationSnapshotInput,
} from "@niveshbook/core";
import type { InvestmentRequirement, Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import { createWithdrawalDestinationAllocationPort, createWithdrawalTransactionPort } from "./ports";
import {
  auditLog,
  investmentRequirements,
  investmentTransactions,
  moneyMovements,
  partnerShares,
  projects,
  users,
  withdrawalDestinationAllocations,
} from "./schema";

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
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      // Story 4.8: `money_movements.sourceProjectId`/`destinationProjectId`
      // deliberately have NO `onDelete: "cascade"` on their own direct
      // `projects` FKs (schema.ts's own doc comment) -- the indirect cascade
      // path (projects -> withdrawal_transactions -> withdrawal_destination_allocations
      // -> money_movements) does NOT satisfy Postgres's independent check of
      // that direct FK, so a leftover money_movements row from a "project"
      // leg test blocks `DELETE FROM projects` below unless removed first.
      await db.delete(moneyMovements).where(inArray(moneyMovements.sourceProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.destinationProjectId, projectIds));
    }
    for (const id of projectIds) {
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

  /**
   * Seeds a destination Project's funding requirement + a single 100%
   * Partner Share (Story 4.8) -- fully allocated, so `buildTransactionSnapshot`
   * succeeds -- and returns the `DestinationSnapshotInput`
   * `moveWithdrawalToProject()` needs, plus the raw ids a "project" leg's
   * `destinationRequirementId`/`destinationShareId` reference. Cleaned up
   * via `seedProject`'s own project-delete cascade (investment_requirements/
   * partner_shares both cascade-delete via projects).
   */
  async function seedDestinationRequirementAndShare(
    destinationProjectId: string,
    sharePercent = "100",
  ): Promise<{ requirementId: string; partnerId: string; snapshot: DestinationSnapshotInput }> {
    const db = getDb();
    const requirementId = uuidv7();
    await db.insert(investmentRequirements).values({
      id: requirementId,
      projectId: destinationProjectId,
      amount: "1000000",
      requirementDate: "2026-10-01",
    });
    const partnerId = uuidv7();
    await db.insert(partnerShares).values({
      id: uuidv7(),
      partnerId,
      projectId: destinationProjectId,
      name: "Destination Partner",
      sharePercent,
    });

    const requirement: InvestmentRequirement = {
      id: requirementId,
      projectId: destinationProjectId,
      amount: "1000000" as Money,
      requirementDate: "2026-10-01",
      createdAt: new Date().toISOString(),
    };
    const snapshot: DestinationSnapshotInput = {
      requirement,
      partnerShares: [
        {
          id: "fake-row",
          partnerId,
          projectId: destinationProjectId,
          name: "Destination Partner",
          sharePercent: sharePercent as Percent,
          userId: null,
          subPartnerVisibilityGrant: false,
          effectiveFrom: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      subPartnerSharesByPartnerId: {},
    };
    return { requirementId, partnerId, snapshot };
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
      destinationRequirementId: null,
      destinationShareId: null,
      destinationPartyType: null,
      destinationSnapshotInput: null,
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
    const { requirementId, partnerId, snapshot } = await seedDestinationRequirementAndShare(
      destinationProjectId,
    );

    const result = await port.recordAllocation(
      withdrawalTransactionId,
      legs([
        {
          destinationType: "project",
          amount: "150000" as Money,
          destinationProjectId,
          destinationRequirementId: requirementId,
          destinationShareId: partnerId,
          destinationPartyType: "partner",
          destinationSnapshotInput: snapshot,
        },
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
    expect(projectLeg?.destinationRequirementId).toBe(requirementId);
    expect(projectLeg?.destinationShareId).toBe(partnerId);
    expect(projectLeg?.destinationPartyType).toBe("partner");

    const personLeg = result.allocations.find((a) => a.destinationType === "person");
    expect(personLeg?.personName).toBe("Person X");

    // Story 4.8 (FR28): the "project" leg's auto-created linked investment
    // record + money movement, all inside the same atomic write.
    expect(result.moneyMovements).toHaveLength(1);
    const movement = result.moneyMovements[0];
    expect(movement?.withdrawalDestinationAllocationId).toBe(projectLeg?.id);
    expect(movement?.sourceProjectId).toBe(sourceProjectId);
    expect(movement?.destinationProjectId).toBe(destinationProjectId);
    expect(movement?.amount).toBe("150000.00");

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));
    expect(rows).toHaveLength(3);

    const investmentTransactionRows = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.id, movement?.destinationInvestmentTransactionId as string));
    expect(investmentTransactionRows).toHaveLength(1);
    const investmentTransactionRow = investmentTransactionRows[0];
    expect(investmentTransactionRow?.projectId).toBe(destinationProjectId);
    expect(investmentTransactionRow?.requirementId).toBe(requirementId);
    expect(investmentTransactionRow?.shareId).toBe(partnerId);
    expect(investmentTransactionRow?.partyType).toBe("partner");
    expect(investmentTransactionRow?.amount).toBe("150000.00");
    // buildTransactionSnapshot's own live computation, exactly as a manual
    // Add Money entry would get -- 100% share of a ₹10,00,000 requirement.
    expect(investmentTransactionRow?.sharePercentSnapshot).toBe("100.0000");
    expect(investmentTransactionRow?.shouldPaySnapshot).toBe("1000000.00");
    expect(investmentTransactionRow?.idempotencyKey).toBe(`${idempotencyKey}:move:0`);

    // The auto-created investment_transactions row's OWN paired "create"
    // audit_log entry (InvestmentTransactionPort.recordTransaction's
    // existing, unmodified atomicity contract) -- distinct from the
    // allocation's own "create" entry asserted below.
    const investmentAuditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, investmentTransactionRow?.id as string),
          eq(auditLog.entityType, "investment_transaction"),
        ),
      );
    expect(investmentAuditRows).toHaveLength(1);

    const movementRows = await db
      .select()
      .from(moneyMovements)
      .where(eq(moneyMovements.withdrawalDestinationAllocationId, projectLeg?.id as string));
    expect(movementRows).toHaveLength(1);
    expect(movementRows[0]?.destinationInvestmentTransactionId).toBe(investmentTransactionRow?.id);

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

  it("writes two 'project' legs to two DIFFERENT destination Projects in one call -- both get their own correct investment_transactions/money_movements rows (I/O matrix row 5, review finding)", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const destinationProjectIdA = await seedProject();
    const destinationProjectIdB = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const idempotencyKey = uuidv7();
    const seedA = await seedDestinationRequirementAndShare(destinationProjectIdA);
    const seedB = await seedDestinationRequirementAndShare(destinationProjectIdB);

    const result = await port.recordAllocation(
      withdrawalTransactionId,
      legs([
        {
          destinationType: "project",
          amount: "150000" as Money,
          destinationProjectId: destinationProjectIdA,
          destinationRequirementId: seedA.requirementId,
          destinationShareId: seedA.partnerId,
          destinationPartyType: "partner",
          destinationSnapshotInput: seedA.snapshot,
        },
        {
          destinationType: "project",
          amount: "100000" as Money,
          destinationProjectId: destinationProjectIdB,
          destinationRequirementId: seedB.requirementId,
          destinationShareId: seedB.partnerId,
          destinationPartyType: "partner",
          destinationSnapshotInput: seedB.snapshot,
        },
      ]),
      idempotencyKey,
      actorUserId,
    );

    expect(result.created).toBe(true);
    expect(result.allocations).toHaveLength(2);
    expect(result.moneyMovements).toHaveLength(2);

    const allocationA = result.allocations.find((a) => a.destinationProjectId === destinationProjectIdA);
    const allocationB = result.allocations.find((a) => a.destinationProjectId === destinationProjectIdB);
    expect(allocationA?.amount).toBe("150000.00");
    expect(allocationB?.amount).toBe("100000.00");

    const movementA = result.moneyMovements.find((m) => m.destinationProjectId === destinationProjectIdA);
    const movementB = result.moneyMovements.find((m) => m.destinationProjectId === destinationProjectIdB);
    expect(movementA?.withdrawalDestinationAllocationId).toBe(allocationA?.id);
    expect(movementB?.withdrawalDestinationAllocationId).toBe(allocationB?.id);
    expect(movementA?.sourceProjectId).toBe(sourceProjectId);
    expect(movementB?.sourceProjectId).toBe(sourceProjectId);
    expect(movementA?.amount).toBe("150000.00");
    expect(movementB?.amount).toBe("100000.00");

    const db = getDb();
    const investmentTransactionRowsA = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.id, movementA?.destinationInvestmentTransactionId as string));
    expect(investmentTransactionRowsA).toHaveLength(1);
    expect(investmentTransactionRowsA[0]?.projectId).toBe(destinationProjectIdA);
    expect(investmentTransactionRowsA[0]?.requirementId).toBe(seedA.requirementId);
    expect(investmentTransactionRowsA[0]?.shareId).toBe(seedA.partnerId);
    expect(investmentTransactionRowsA[0]?.amount).toBe("150000.00");

    const investmentTransactionRowsB = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.id, movementB?.destinationInvestmentTransactionId as string));
    expect(investmentTransactionRowsB).toHaveLength(1);
    expect(investmentTransactionRowsB[0]?.projectId).toBe(destinationProjectIdB);
    expect(investmentTransactionRowsB[0]?.requirementId).toBe(seedB.requirementId);
    expect(investmentTransactionRowsB[0]?.shareId).toBe(seedB.partnerId);
    expect(investmentTransactionRowsB[0]?.amount).toBe("100000.00");

    // Each leg's derived idempotency key uses ITS OWN index within the
    // caller's legs array (this story's Decisions) -- confirms the
    // pre-generated `legIds[index]`/derived-idempotency-key-per-index
    // pairing stays correct even with two "project" legs sharing one batch
    // (the exact scenario that sequential, index-based logic exists to
    // protect, per the review finding this test closes).
    expect(investmentTransactionRowsA[0]?.idempotencyKey).toBe(`${idempotencyKey}:move:0`);
    expect(investmentTransactionRowsB[0]?.idempotencyKey).toBe(`${idempotencyKey}:move:1`);

    const movementRows = await db
      .select()
      .from(moneyMovements)
      .where(inArray(moneyMovements.destinationProjectId, [destinationProjectIdA, destinationProjectIdB]));
    expect(movementRows).toHaveLength(2);
  });

  it("replaying an already-processed allocation with a 'project' leg does NOT duplicate the investment_transactions/money_movements rows (idempotent replay)", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "150000");
    const idempotencyKey = uuidv7();
    const { requirementId, partnerId, snapshot } = await seedDestinationRequirementAndShare(
      destinationProjectId,
    );
    const input = legs([
      {
        destinationType: "project",
        amount: "150000" as Money,
        destinationProjectId,
        destinationRequirementId: requirementId,
        destinationShareId: partnerId,
        destinationPartyType: "partner",
        destinationSnapshotInput: snapshot,
      },
    ]);

    const first = await port.recordAllocation(withdrawalTransactionId, input, idempotencyKey, actorUserId);
    const second = await port.recordAllocation(withdrawalTransactionId, input, idempotencyKey, actorUserId);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.moneyMovements).toHaveLength(1);
    expect(second.moneyMovements).toHaveLength(1);
    expect(second.moneyMovements[0]?.id).toBe(first.moneyMovements[0]?.id);

    const db = getDb();
    const movementRows = await db
      .select()
      .from(moneyMovements)
      .where(eq(moneyMovements.destinationProjectId, destinationProjectId));
    expect(movementRows).toHaveLength(1);

    const investmentTransactionRows = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.projectId, destinationProjectId));
    expect(investmentTransactionRows).toHaveLength(1);
  });

  it("rolls back the whole batch -- no partial allocation rows, no partial investment/movement rows -- when a 'project' leg's snapshot precondition fails (SharesNotFullyAllocatedError)", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
    const idempotencyKey = uuidv7();
    // Partner Shares total only 60% at the destination Project -- not fully
    // allocated, so buildTransactionSnapshot's computeShouldPay throws.
    const { requirementId, partnerId, snapshot } = await seedDestinationRequirementAndShare(
      destinationProjectId,
      "60",
    );

    await expect(
      port.recordAllocation(
        withdrawalTransactionId,
        legs([
          {
            destinationType: "project",
            amount: "150000" as Money,
            destinationProjectId,
            destinationRequirementId: requirementId,
            destinationShareId: partnerId,
            destinationPartyType: "partner",
            destinationSnapshotInput: snapshot,
          },
          { destinationType: "other", amount: "100000" as Money, notes: "Held as cash" },
        ]),
        idempotencyKey,
        actorUserId,
      ),
    ).rejects.toBeInstanceOf(SharesNotFullyAllocatedError);

    const db = getDb();
    const allocationRows = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));
    expect(allocationRows).toHaveLength(0);

    const investmentTransactionRows = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.projectId, destinationProjectId));
    expect(investmentTransactionRows).toHaveLength(0);

    const movementRows = await db
      .select()
      .from(moneyMovements)
      .where(eq(moneyMovements.destinationProjectId, destinationProjectId));
    expect(movementRows).toHaveLength(0);
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

  it("recovers from a concurrent double-submit race with a 'project' leg -- exactly one investment_transactions row and one money_movements row survive (review finding, Story 4.8)", async () => {
    const port = createWithdrawalDestinationAllocationPort();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const actorUserId = await seedActor();
    const withdrawalTransactionId = await seedWithdrawal(sourceProjectId, actorUserId, "150000");
    const idempotencyKey = uuidv7();
    const { requirementId, partnerId, snapshot } = await seedDestinationRequirementAndShare(
      destinationProjectId,
    );
    const input = legs([
      {
        destinationType: "project",
        amount: "150000" as Money,
        destinationProjectId,
        destinationRequirementId: requirementId,
        destinationShareId: partnerId,
        destinationPartyType: "partner",
        destinationSnapshotInput: snapshot,
      },
    ]);

    const [resultA, resultB] = await Promise.all([
      port.recordAllocation(withdrawalTransactionId, input, idempotencyKey, actorUserId),
      port.recordAllocation(withdrawalTransactionId, input, idempotencyKey, actorUserId),
    ]);

    expect([resultA.created, resultB.created].filter(Boolean)).toHaveLength(1);
    expect(resultA.allocations.map((a) => a.id).sort()).toEqual(resultB.allocations.map((a) => a.id).sort());
    // The parent withdrawal_transactions row's SELECT ... FOR UPDATE lock
    // (this port's own established concurrency mechanism, unchanged by
    // Story 4.8) serializes these two calls just as fully for the new
    // investment_transactions/money_movements path as it already does for
    // the allocation rows themselves -- both racers resolve to the exact
    // same linked movement, never two independent ones.
    expect(resultA.moneyMovements).toHaveLength(1);
    expect(resultB.moneyMovements).toHaveLength(1);
    expect(resultA.moneyMovements[0]?.id).toBe(resultB.moneyMovements[0]?.id);

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalDestinationAllocations)
      .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));
    expect(rows).toHaveLength(1);

    const investmentTransactionRows = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.projectId, destinationProjectId));
    expect(investmentTransactionRows).toHaveLength(1);

    const movementRows = await db
      .select()
      .from(moneyMovements)
      .where(eq(moneyMovements.destinationProjectId, destinationProjectId));
    expect(movementRows).toHaveLength(1);
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

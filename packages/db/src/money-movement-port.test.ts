import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { DestinationSnapshotInput } from "@niveshbook/core";
import type { InvestmentRequirement, Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import {
  createAvailableBalancePort,
  createAvailableBalanceSpendPort,
  createMoneyMovementPort,
  createWithdrawalDestinationAllocationPort,
  createWithdrawalTransactionPort,
} from "./ports";
import {
  auditLog,
  availableBalanceSpends,
  availableBalances,
  investmentRequirements,
  moneyMovements,
  partnerShares,
  projects,
  users,
  withdrawalDestinationAllocations,
} from "./schema";

// Mirrors `withdrawal-destination-allocation-port.test.ts`'s own defensive
// `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createMoneyMovementPort`'s three new Story
 * 4.10 (FR30) trail-walking finders --
 * `findByDestinationInvestmentTransactionId`/`findByWithdrawalDestinationAllocationId`/
 * `findByAvailableBalanceSpendId` -- each at-most-one by construction (this
 * port's own doc comments). Seeds a real "project" allocation leg (via
 * `createWithdrawalDestinationAllocationPort.recordAllocation`) and a real
 * "project" Available Balance spend (via
 * `createAvailableBalanceSpendPort.recordSpend`) rather than raw inserts --
 * both already-proven-working write paths, exercising the exact rows
 * `assembleMoneyTrail()` will later read.
 */
describe("createMoneyMovementPort's new Story 4.10 finders (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds));
    }
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      // `withdrawal_destination_allocations.destinationProjectId`/
      // `money_movements.sourceProjectId`/`destinationProjectId` all have NO
      // `onDelete: "cascade"` on their direct `projects` FKs (schema.ts) --
      // the indirect cascade path via `withdrawal_transactions` does NOT
      // satisfy Postgres's independent check of those direct FKs, so a
      // leftover row from a "project" leg/spend test blocks `DELETE FROM
      // projects` below unless removed first (mirrors
      // `withdrawal-destination-allocation-port.test.ts`'s own cleanup).
      await db
        .delete(withdrawalDestinationAllocations)
        .where(inArray(withdrawalDestinationAllocations.destinationProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.sourceProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.destinationProjectId, projectIds));
      await db.delete(availableBalanceSpends).where(inArray(availableBalanceSpends.sourceProjectId, projectIds));
      await db.delete(availableBalances).where(inArray(availableBalances.projectId, projectIds));
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `mm-finder-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `mm-finder-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  /** Mirrors `withdrawal-destination-allocation-port.test.ts`'s identical fixture. */
  async function seedDestinationRequirementAndShare(
    destinationProjectId: string,
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
      sharePercent: "100",
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
          sharePercent: "100" as Percent,
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

  it("findByWithdrawalDestinationAllocationId / findByDestinationInvestmentTransactionId: found for a real 'project' leg's linked movement, null otherwise", async () => {
    const allocationPort = createWithdrawalDestinationAllocationPort();
    const withdrawalPort = createWithdrawalTransactionPort();
    const movementPort = createMoneyMovementPort();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const actorUserId = await seedActor();
    const { transaction } = await withdrawalPort.recordTransaction({
      projectId: sourceProjectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "150000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });
    const { requirementId, partnerId, snapshot } = await seedDestinationRequirementAndShare(destinationProjectId);

    const result = await allocationPort.recordAllocation(
      transaction.id,
      [
        {
          destinationType: "project",
          amount: "150000" as Money,
          destinationProjectId,
          personName: null,
          notes: null,
          destinationRequirementId: requirementId,
          destinationShareId: partnerId,
          destinationPartyType: "partner",
          destinationSnapshotInput: snapshot,
        },
      ],
      uuidv7(),
      actorUserId,
    );
    const allocation = result.allocations[0];
    const movement = result.moneyMovements[0];
    expect(allocation).toBeDefined();
    expect(movement).toBeDefined();

    const byAllocation = await movementPort.findByWithdrawalDestinationAllocationId(allocation!.id);
    expect(byAllocation?.id).toBe(movement!.id);
    expect(byAllocation?.withdrawalDestinationAllocationId).toBe(allocation!.id);

    const byInvestmentTransaction = await movementPort.findByDestinationInvestmentTransactionId(
      movement!.destinationInvestmentTransactionId,
    );
    expect(byInvestmentTransaction?.id).toBe(movement!.id);

    expect(await movementPort.findByWithdrawalDestinationAllocationId(uuidv7())).toBeNull();
    expect(await movementPort.findByDestinationInvestmentTransactionId(uuidv7())).toBeNull();
  });

  it("findByAvailableBalanceSpendId: found for a real 'project' spend's linked movement, null for a 'person' spend (no linked movement) and a nonexistent id", async () => {
    const balancePort = createAvailableBalancePort();
    const spendPort = createAvailableBalanceSpendPort();
    const movementPort = createMoneyMovementPort();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    await balancePort.creditBalance({
      projectId: sourceProjectId,
      partyType: "partner",
      shareId,
      amount: "50000" as Money,
    });
    const { requirementId, partnerId, snapshot } = await seedDestinationRequirementAndShare(destinationProjectId);

    const projectSpend = await spendPort.recordSpend(
      {
        sourceProjectId,
        partyType: "partner",
        shareId,
        destinationType: "project",
        amount: "30000" as Money,
        notes: null,
        destinationProjectId,
        destinationRequirementId: requirementId,
        destinationShareId: partnerId,
        destinationPartyType: "partner",
        destinationSnapshotInput: snapshot,
        personName: null,
      },
      uuidv7(),
      actorUserId,
    );
    expect(projectSpend.moneyMovement).not.toBeNull();

    const found = await movementPort.findByAvailableBalanceSpendId(projectSpend.spend.id);
    expect(found?.id).toBe(projectSpend.moneyMovement!.id);
    expect(found?.availableBalanceSpendId).toBe(projectSpend.spend.id);

    const personSpend = await spendPort.recordSpend(
      {
        sourceProjectId,
        partyType: "partner",
        shareId,
        destinationType: "person",
        amount: "5000" as Money,
        notes: null,
        destinationProjectId: null,
        destinationRequirementId: null,
        destinationShareId: null,
        destinationPartyType: null,
        destinationSnapshotInput: null,
        personName: "Person X",
      },
      uuidv7(),
      actorUserId,
    );
    expect(await movementPort.findByAvailableBalanceSpendId(personSpend.spend.id)).toBeNull();
    expect(await movementPort.findByAvailableBalanceSpendId(uuidv7())).toBeNull();
  });
});

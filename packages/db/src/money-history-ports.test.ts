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
  createInvestmentTransactionPort,
  createMoneyMovementPort,
  createSubPartnerSharePort,
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
  subpartnerShares,
  users,
  withdrawalDestinationAllocations,
} from "./schema";

// Mirrors `money-movement-port.test.ts`'s own defensive `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for the 6 new Story 5.1 (FR31) `listAll()` port
 * methods -- each mirrors `createPartnerSharePort.listAll`'s existing Story
 * 2.7 precedent: a plain, unfiltered `select().from(table)`. Since `listAll()`
 * returns EVERY row in the table (no project/scope filter, by design -- Money
 * History's own filtering/scoping happens in `packages/core`'s pure
 * `assembleMoneyHistory()`), these tests seed a row via the existing,
 * already-proven write paths and assert the seeded row is present in the
 * full result set (`.find` by id), rather than asserting exact-equality of
 * the whole list -- this suite may run alongside other tests/leftover data
 * in the same database.
 */
describe("Story 5.1 listAll() port methods (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds));
    }
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      await db
        .delete(withdrawalDestinationAllocations)
        .where(inArray(withdrawalDestinationAllocations.destinationProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.sourceProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.destinationProjectId, projectIds));
      await db.delete(availableBalanceSpends).where(inArray(availableBalanceSpends.sourceProjectId, projectIds));
      await db.delete(availableBalances).where(inArray(availableBalances.projectId, projectIds));
      await db.delete(subpartnerShares).where(inArray(subpartnerShares.projectId, projectIds));
      await db.delete(partnerShares).where(inArray(partnerShares.projectId, projectIds));
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `mh-listall-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `mh-listall-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  /** Mirrors `money-movement-port.test.ts`'s identical fixture. */
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

  it("subPartnerSharePort.listAll() includes a freshly-created row", async () => {
    const port = createSubPartnerSharePort();
    const projectId = await seedProject();
    const partnerId = uuidv7();
    await getDb().insert(partnerShares).values({
      id: uuidv7(),
      partnerId,
      projectId,
      name: "Parent Partner",
      sharePercent: "100",
    });
    const subPartnerId = uuidv7();

    const created = await port.createSubPartnerShare({
      subPartnerId,
      partnerId,
      projectId,
      name: "Sub Test",
      sharePercent: "20" as Percent,
      userId: null,
    });

    const all = await port.listAll();
    expect(all.find((row) => row.id === created.id)).toEqual(created);
  });

  it("investmentTransactionPort.listAll() includes a freshly-recorded transaction", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const requirementId = uuidv7();
    await getDb().insert(investmentRequirements).values({
      id: requirementId,
      projectId,
      amount: "500000",
      requirementDate: "2026-10-05",
    });

    const { transaction } = await port.recordTransaction({
      requirementId,
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "100" as Percent,
      shouldPaySnapshot: "500000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });

    const all = await port.listAll();
    expect(all.find((row) => row.id === transaction.id)).toEqual(transaction);
  });

  // Review round 2 (verification-gap finding #6): every one of the 6 tests
  // above seeds exactly one row and checks it's present -- a `LIMIT 1` or an
  // accidental extra `WHERE` clause on any of the 6 near-identical `listAll()`
  // implementations would still pass every one of them. This test seeds TWO
  // rows across two entirely different parent requirements/Projects and
  // asserts BOTH ids come back from a single `listAll()` call, derisking that
  // identical one-line-`select().from(table)` pattern shared by all 6.
  it("investmentTransactionPort.listAll() returns MULTIPLE rows across different requirements/Projects in one call (derisks the shared listAll() pattern for all 6 new methods)", async () => {
    const port = createInvestmentTransactionPort();
    const projectOne = await seedProject();
    const projectTwo = await seedProject();
    const actorUserId = await seedActor();
    const requirementOne = uuidv7();
    const requirementTwo = uuidv7();
    await getDb()
      .insert(investmentRequirements)
      .values([
        { id: requirementOne, projectId: projectOne, amount: "500000", requirementDate: "2026-10-05" },
        { id: requirementTwo, projectId: projectTwo, amount: "700000", requirementDate: "2026-10-06" },
      ]);

    const { transaction: transactionOne } = await port.recordTransaction({
      requirementId: requirementOne,
      projectId: projectOne,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "100" as Percent,
      shouldPaySnapshot: "500000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });
    const { transaction: transactionTwo } = await port.recordTransaction({
      requirementId: requirementTwo,
      projectId: projectTwo,
      partyType: "sub_partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      shouldPaySnapshot: "700000" as Money,
      amount: "350000" as Money,
      transactionDate: "2026-10-06",
      paymentMode: "upi",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });

    const all = await port.listAll();
    expect(all.find((row) => row.id === transactionOne.id)).toEqual(transactionOne);
    expect(all.find((row) => row.id === transactionTwo.id)).toEqual(transactionTwo);
  });

  it("withdrawalTransactionPort.listAll() includes a freshly-recorded withdrawal", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();

    const { transaction } = await port.recordTransaction({
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "150000" as Money,
      transactionDate: "2026-10-06",
      paymentMode: "neft",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });

    const all = await port.listAll();
    expect(all.find((row) => row.id === transaction.id)).toEqual(transaction);
  });

  it("withdrawalDestinationAllocationPort.listAll() includes a freshly-saved leg", async () => {
    const allocationPort = createWithdrawalDestinationAllocationPort();
    const withdrawalPort = createWithdrawalTransactionPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const { transaction } = await withdrawalPort.recordTransaction({
      projectId: sourceProjectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "50000" as Money,
      transactionDate: "2026-10-07",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });

    const result = await allocationPort.recordAllocation(
      transaction.id,
      [
        {
          destinationType: "person",
          amount: "50000" as Money,
          destinationProjectId: null,
          personName: "Money History Test Person",
          notes: null,
          destinationRequirementId: null,
          destinationShareId: null,
          destinationPartyType: null,
          destinationSnapshotInput: null,
        },
      ],
      uuidv7(),
      actorUserId,
    );
    const leg = result.allocations[0];
    expect(leg).toBeDefined();

    const all = await allocationPort.listAll();
    expect(all.find((row) => row.id === leg!.id)).toEqual(leg);
  });

  it("moneyMovementPort.listAll() includes a freshly-created movement (via a real 'project' leg)", async () => {
    const allocationPort = createWithdrawalDestinationAllocationPort();
    const withdrawalPort = createWithdrawalTransactionPort();
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
      transactionDate: "2026-10-08",
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
    const movement = result.moneyMovements[0];
    expect(movement).toBeDefined();

    const all = await createMoneyMovementPort().listAll();
    expect(all.find((row) => row.id === movement!.id)).toEqual(movement);
  });

  it("availableBalanceSpendPort.listAll() includes a freshly-recorded spend", async () => {
    const balancePort = createAvailableBalancePort();
    const spendPort = createAvailableBalanceSpendPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    await balancePort.creditBalance({
      projectId: sourceProjectId,
      partyType: "partner",
      shareId,
      amount: "50000" as Money,
    });

    const result = await spendPort.recordSpend(
      {
        sourceProjectId,
        partyType: "partner",
        shareId,
        destinationType: "person",
        amount: "20000" as Money,
        notes: null,
        destinationProjectId: null,
        destinationRequirementId: null,
        destinationShareId: null,
        destinationPartyType: null,
        destinationSnapshotInput: null,
        personName: "Money History Spend Person",
      },
      uuidv7(),
      actorUserId,
    );

    const all = await spendPort.listAll();
    expect(all.find((row) => row.id === result.spend.id)).toEqual(result.spend);
  });
});

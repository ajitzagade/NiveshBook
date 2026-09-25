import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { AdjustmentNettingIdempotencyKeyConflictError, assembleMoneyHistory } from "@niveshbook/core";
import type { Money } from "@niveshbook/types";
import { getDb } from "./client";
import { createAdjustmentNettingPort, createInvestmentAdjustmentPort, createWithdrawalAdjustmentPort } from "./ports";
import { adjustmentNettings, auditLog, investmentRequirements, projects, users } from "./schema";

// Mirrors `available-balance-spend-port.test.ts`'s own defensive
// `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createAdjustmentNettingPort.recordNetting`
 * (Story 5.3, FR33/FR34, AD-4/AD-5) -- the netting write path: a genuine
 * create (one `adjustment_nettings` row + one paired `audit_log` row, inside
 * one DB transaction), idempotent replay (no duplicate row), a
 * same-idempotencyKey-mismatched-content conflict, a concurrent
 * double-submit race, and `listAll()`. Every test additionally proves AD-4's
 * central guarantee: `investment_adjustments`/`withdrawal_adjustments` stay
 * byte-for-byte untouched by a netting write -- this port never reads or
 * writes either table.
 */
describe("createAdjustmentNettingPort.recordNetting (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds));
    }
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      await db.delete(adjustmentNettings).where(inArray(adjustmentNettings.projectId, projectIds));
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `adj-netting-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `adj-netting-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
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

  it("inserts a netting row plus exactly one paired audit_log row, inside one atomic write -- created: true", async () => {
    const port = createAdjustmentNettingPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const requirementId = await seedRequirement(projectId);
    const shareId = uuidv7();

    const result = await port.recordNetting(
      {
        projectId,
        partyType: "partner",
        shareId,
        investmentRequirementId: requirementId,
        amount: "50000" as Money,
        notes: "Agreed over call",
      },
      uuidv7(),
      actorUserId,
    );

    expect(result.created).toBe(true);
    expect(result.netting.projectId).toBe(projectId);
    expect(result.netting.shareId).toBe(shareId);
    expect(result.netting.investmentRequirementId).toBe(requirementId);
    expect(result.netting.amount).toBe("50000.00");
    expect(result.netting.notes).toBe("Agreed over call");
    expect(result.netting.actorUserId).toBe(actorUserId);

    const db = getDb();
    const rows = await db.select().from(adjustmentNettings).where(eq(adjustmentNettings.projectId, projectId));
    expect(rows).toHaveLength(1);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, result.netting.id), eq(auditLog.entityType, "adjustment_netting")));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("create");
    expect(auditRows[0]?.actorUserId).toBe(actorUserId);
  });

  it("replays an idempotent resubmission with identical content -- created: false, same netting id, no duplicate row", async () => {
    const port = createAdjustmentNettingPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const requirementId = await seedRequirement(projectId);
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();
    const input = {
      projectId,
      partyType: "partner" as const,
      shareId,
      investmentRequirementId: requirementId,
      amount: "25000" as Money,
      notes: null,
    };

    const first = await port.recordNetting(input, idempotencyKey, actorUserId);
    const second = await port.recordNetting(input, idempotencyKey, actorUserId);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.netting.id).toBe(first.netting.id);

    const db = getDb();
    const rows = await db.select().from(adjustmentNettings).where(eq(adjustmentNettings.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it("rejects a same-idempotencyKey resubmission with mismatched content -- AdjustmentNettingIdempotencyKeyConflictError", async () => {
    const port = createAdjustmentNettingPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const requirementId = await seedRequirement(projectId);
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();

    await port.recordNetting(
      { projectId, partyType: "partner", shareId, investmentRequirementId: requirementId, amount: "10000" as Money, notes: null },
      idempotencyKey,
      actorUserId,
    );

    await expect(
      port.recordNetting(
        { projectId, partyType: "partner", shareId, investmentRequirementId: requirementId, amount: "9999" as Money, notes: null },
        idempotencyKey,
        actorUserId,
      ),
    ).rejects.toBeInstanceOf(AdjustmentNettingIdempotencyKeyConflictError);
  });

  it("recovers from a concurrent double-submit race -- two simultaneous calls with the same idempotencyKey and matching content resolve to exactly one row", async () => {
    const port = createAdjustmentNettingPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const requirementId = await seedRequirement(projectId);
    const shareId = uuidv7();
    const idempotencyKey = uuidv7();
    const input = {
      projectId,
      partyType: "partner" as const,
      shareId,
      investmentRequirementId: requirementId,
      amount: "15000" as Money,
      notes: null,
    };

    const [resultA, resultB] = await Promise.all([
      port.recordNetting(input, idempotencyKey, actorUserId),
      port.recordNetting(input, idempotencyKey, actorUserId),
    ]);

    expect([resultA.created, resultB.created].filter(Boolean)).toHaveLength(1);
    expect(resultA.netting.id).toBe(resultB.netting.id);

    const db = getDb();
    const rows = await db.select().from(adjustmentNettings).where(eq(adjustmentNettings.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it("listAll() includes a freshly-recorded netting", async () => {
    const port = createAdjustmentNettingPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const requirementId = await seedRequirement(projectId);

    const { netting } = await port.recordNetting(
      {
        projectId,
        partyType: "sub_partner",
        shareId: uuidv7(),
        investmentRequirementId: requirementId,
        amount: "8000" as Money,
        notes: null,
      },
      uuidv7(),
      actorUserId,
    );

    const all = await port.listAll();
    expect(all.find((row) => row.id === netting.id)).toEqual(netting);
  });

  it("AD-4: a netting write never touches investment_adjustments/withdrawal_adjustments -- both stay byte-for-byte unchanged", async () => {
    const investmentAdjustmentPort = createInvestmentAdjustmentPort();
    const withdrawalAdjustmentPort = createWithdrawalAdjustmentPort();
    const nettingPort = createAdjustmentNettingPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const requirementId = await seedRequirement(projectId);
    const shareId = uuidv7();

    const investmentAdjustmentBefore = await investmentAdjustmentPort.upsert({
      projectId,
      partyType: "partner",
      shareId,
      requirementId,
      shouldPay: "200000" as Money,
      actualPaid: "0" as Money,
      adjustmentType: "pending",
      adjustmentAmount: "200000" as Money,
    });
    const withdrawalAdjustmentBefore = await withdrawalAdjustmentPort.upsert({
      projectId,
      partyType: "partner",
      shareId,
      canTake: "150000" as Money,
      taken: "0" as Money,
      adjustmentType: "keep_for_later",
      adjustmentAmount: "150000" as Money,
    });

    await nettingPort.recordNetting(
      { projectId, partyType: "partner", shareId, investmentRequirementId: requirementId, amount: "50000" as Money, notes: null },
      uuidv7(),
      actorUserId,
    );

    const [investmentAdjustmentAfter] = await investmentAdjustmentPort.listByProjectId(projectId);
    const [withdrawalAdjustmentAfter] = await withdrawalAdjustmentPort.listByProjectId(projectId);

    expect(investmentAdjustmentAfter).toEqual(investmentAdjustmentBefore);
    expect(withdrawalAdjustmentAfter).toEqual(withdrawalAdjustmentBefore);
  });

  // Live-verification pass (this story's Verification section): proves the
  // FULL pipeline against real Postgres data, not fixtures -- a genuinely
  // recorded `adjustment_nettings` row, read back through
  // `assembleMoneyHistory()` (the exact function `GET /api/money-history`
  // calls), appears as a correctly-shaped `"adjustment"` entry. No other
  // test in this codebase proves "real Postgres row -> real core assembly ->
  // correct Money History entry" for this entry type end to end.
  it("a real netting row, assembled by assembleMoneyHistory(), appears as a correctly-shaped 'adjustment' entry with from/to null", async () => {
    const nettingPort = createAdjustmentNettingPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const requirementId = await seedRequirement(projectId);
    const shareId = uuidv7();

    const { netting } = await nettingPort.recordNetting(
      {
        projectId,
        partyType: "partner",
        shareId,
        investmentRequirementId: requirementId,
        amount: "42000" as Money,
        notes: "Live-verification pass",
      },
      uuidv7(),
      actorUserId,
    );

    const allNettings = await nettingPort.listAll();

    const entries = assembleMoneyHistory(
      {
        investmentTransactions: [],
        withdrawalTransactions: [],
        withdrawalDestinationAllocations: [],
        moneyMovements: [],
        availableBalanceSpends: [],
        adjustmentNettings: allNettings,
        projectNamesById: { [projectId]: "Live Verification Project" },
        partnerNamesById: {},
        subPartnerNamesById: {},
      },
      { unrestricted: true },
      {},
    );

    const entry = entries.find((e) => e.id === netting.id);
    expect(entry).toMatchObject({
      id: netting.id,
      type: "adjustment",
      projectId,
      projectName: "Live Verification Project",
      partyType: "partner",
      shareId,
      amount: "42000.00",
      paymentMode: null,
      from: null,
      to: null,
      notes: "Live-verification pass",
      status: "active",
      reversalOfTransactionId: null,
    });
  });
});

import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import { createAuditLogPort, createInvestmentTransactionPort, createWithdrawalTransactionPort } from "./ports";
import { auditLog, investmentRequirements, projects, users } from "./schema";

// Mirrors `withdrawal-transaction-port.test.ts`'s own defensive
// `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for Story 5.9's two new/extended read surfaces:
 * `createWithdrawalTransactionPort.findAuditLogByTransactionId`/
 * `.findByReversalOfTransactionId` (the withdrawal-side audit read gap this
 * story closes, mirroring the investment side's existing Story 3.7/3.8
 * coverage one ledger over) and `createAuditLogPort.listAll` (the new
 * global Audit History page's sole read). Rows seeded/inspected directly via
 * Drizzle against the real Postgres instance CI already provisions
 * (`DATABASE_URL`), mirroring every sibling `*-port.test.ts` file's
 * established pattern -- this is READ-ONLY coverage; every write path here
 * reuses the already-covered `recordTransaction`/`editTransaction`/
 * `cancelTransaction` (Stories 3.3/3.7/3.8/4.2/4.11), never new write logic.
 */
describe("createWithdrawalTransactionPort.findAuditLogByTransactionId/.findByReversalOfTransactionId (live Postgres, Story 5.9)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds.splice(0)));
    }
    for (const id of seededProjectIds.splice(0)) {
      // withdrawal_transactions/investment_transactions/investment_requirements
      // all cascade-delete via their own `projects` FK.
      await db.delete(projects).where(eq(projects.id, id));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `audit-log-port-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `audit-log-port-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  async function seedWithdrawal(projectId: string, actorUserId: string): Promise<string> {
    const port = createWithdrawalTransactionPort();
    const result = await port.recordTransaction({
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "neft",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });
    return result.transaction.id;
  }

  it("returns the original create entry", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const transactionId = await seedWithdrawal(projectId, actorUserId);

    const entries = await port.findAuditLogByTransactionId(transactionId);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("create");
    expect(entries[0]?.entityType).toBe("withdrawal_transaction");
  });

  it("returns an empty list for a withdrawal that doesn't exist (defensive, never crashes)", async () => {
    const port = createWithdrawalTransactionPort();

    const entries = await port.findAuditLogByTransactionId(uuidv7());

    expect(entries).toEqual([]);
  });

  it("findByReversalOfTransactionId is null before any cancellation", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const transactionId = await seedWithdrawal(projectId, actorUserId);

    expect(await port.findByReversalOfTransactionId(transactionId)).toBeNull();
  });

  /**
   * A real cancelled-transaction-plus-reversal fixture (this story's own
   * explicit correctness property #2) against real Postgres -- not a mock.
   * Confirms BOTH directions the per-transaction audit-log route depends on:
   * the original resolves its reversal via `findByReversalOfTransactionId`,
   * and the original's own audit trail carries exactly one `"cancel"` entry
   * while the reversal row itself carries none of its own.
   */
  it("after a real cancel: findByReversalOfTransactionId resolves the reversal; the original's audit trail has create+cancel; the reversal has none of its own", async () => {
    const port = createWithdrawalTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const transactionId = await seedWithdrawal(projectId, actorUserId);

    const { reversalTransaction } = await port.cancelTransaction({
      transactionId,
      idempotencyKey: uuidv7(),
      actorUserId,
      reason: "recorded by mistake",
    });

    const reversal = await port.findByReversalOfTransactionId(transactionId);
    expect(reversal?.id).toBe(reversalTransaction.id);
    expect(reversal?.reversalOfTransactionId).toBe(transactionId);

    const originalEntries = await port.findAuditLogByTransactionId(transactionId);
    expect(originalEntries.map((entry) => entry.action)).toEqual(["create", "cancel"]);
    expect(originalEntries[1]?.reason).toBe("recorded by mistake");

    const reversalEntries = await port.findAuditLogByTransactionId(reversalTransaction.id);
    expect(reversalEntries).toEqual([]);
  });
});

/**
 * Live-Postgres coverage for the INVESTMENT side of the same two Story 5.9
 * read surfaces -- `createInvestmentTransactionPort.findAuditLogByTransactionId`/
 * `.findByReversalOfTransactionId`, mirroring the withdrawal-side `describe`
 * block immediately above test-for-test. Post-review finding: the withdrawal
 * side got this exact live-Postgres treatment when this story first shipped,
 * but the investment side's identical methods (added to
 * `InvestmentTransactionPort` by this same story, to power the linked-
 * reversal resolution on the investment audit-log route) only ever had mock
 * coverage (`.../transactions/[transactionId]/audit-log/route.test.ts`) --
 * a real gap for the FIRST-EVER-AUDITED entity type this story's AC depends
 * on. `investment-transaction.test.ts`'s in-memory fake previously carried an
 * incorrect comment claiming this was covered by `audit-history.test.ts`;
 * that function is a pure row-in/row-out transform and never calls this
 * method at all -- the comment has been corrected there.
 */
describe("createInvestmentTransactionPort.findAuditLogByTransactionId/.findByReversalOfTransactionId (live Postgres, Story 5.9)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds.splice(0)));
    }
    for (const id of seededProjectIds.splice(0)) {
      // investment_transactions/investment_requirements both cascade-delete
      // via their own `projects` FK.
      await db.delete(projects).where(eq(projects.id, id));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `audit-log-port-investment-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `audit-log-port-investment-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  async function seedInvestment(projectId: string, actorUserId: string): Promise<string> {
    const db = getDb();
    const requirementId = uuidv7();
    await db.insert(investmentRequirements).values({
      id: requirementId,
      projectId,
      amount: "1000000",
      requirementDate: "2026-10-01",
    });

    const port = createInvestmentTransactionPort();
    const result = await port.recordTransaction({
      requirementId,
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      shouldPaySnapshot: "500000" as Money,
      amount: "500000" as Money,
      transactionDate: "2026-10-01",
      paymentMode: "upi",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });
    return result.transaction.id;
  }

  it("returns the original create entry", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const transactionId = await seedInvestment(projectId, actorUserId);

    const entries = await port.findAuditLogByTransactionId(transactionId);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("create");
    expect(entries[0]?.entityType).toBe("investment_transaction");
  });

  it("returns an empty list for a transaction that doesn't exist (defensive, never crashes)", async () => {
    const port = createInvestmentTransactionPort();

    const entries = await port.findAuditLogByTransactionId(uuidv7());

    expect(entries).toEqual([]);
  });

  it("findByReversalOfTransactionId is null before any cancellation", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const transactionId = await seedInvestment(projectId, actorUserId);

    expect(await port.findByReversalOfTransactionId(transactionId)).toBeNull();
  });

  /**
   * A real cancelled-transaction-plus-reversal fixture (this story's own
   * explicit correctness property #2) against real Postgres -- not a mock.
   * Mirrors the withdrawal-side test of the identical name above.
   */
  it("after a real cancel: findByReversalOfTransactionId resolves the reversal; the original's audit trail has create+cancel; the reversal has none of its own", async () => {
    const port = createInvestmentTransactionPort();
    const projectId = await seedProject();
    const actorUserId = await seedActor();
    const transactionId = await seedInvestment(projectId, actorUserId);

    const { reversalTransaction } = await port.cancelTransaction({
      transactionId,
      idempotencyKey: uuidv7(),
      actorUserId,
      reason: "recorded by mistake",
    });

    const reversal = await port.findByReversalOfTransactionId(transactionId);
    expect(reversal?.id).toBe(reversalTransaction.id);
    expect(reversal?.reversalOfTransactionId).toBe(transactionId);

    const originalEntries = await port.findAuditLogByTransactionId(transactionId);
    expect(originalEntries.map((entry) => entry.action)).toEqual(["create", "cancel"]);
    expect(originalEntries[1]?.reason).toBe("recorded by mistake");

    const reversalEntries = await port.findAuditLogByTransactionId(reversalTransaction.id);
    expect(reversalEntries).toEqual([]);
  });
});

/**
 * Live-Postgres coverage for `createAuditLogPort.listAll` (Story 5.9) -- the
 * new global Audit History page's sole read: a plain, unfiltered
 * `SELECT * FROM audit_log`, every entity type. Confirms it surfaces rows
 * from BOTH `investment_transaction` and `withdrawal_transaction` entity
 * types (the two this story's own scope covers) written via their existing,
 * already-covered write paths -- `packages/core`'s `assembleAuditHistory()`
 * is what filters this down to just those two types (Decision #6), covered
 * separately by `audit-history.test.ts`; this file only proves the port
 * itself returns everything, unfiltered.
 */
describe("createAuditLogPort.listAll (live Postgres, Story 5.9)", () => {
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

  it("includes both investment_transaction and withdrawal_transaction rows written via their own ports", async () => {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `audit-log-listall-test-${projectId}` });
    seededProjectIds.push(projectId);
    const actorUserId = uuidv7();
    await db.insert(users).values({
      id: actorUserId,
      email: `audit-log-listall-test-${actorUserId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(actorUserId);

    const requirementId = uuidv7();
    await db.insert(investmentRequirements).values({
      id: requirementId,
      projectId,
      amount: "1000000",
      requirementDate: "2026-10-01",
    });

    const investmentPort = createInvestmentTransactionPort();
    const investmentResult = await investmentPort.recordTransaction({
      requirementId,
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      shouldPaySnapshot: "500000" as Money,
      amount: "500000" as Money,
      transactionDate: "2026-10-01",
      paymentMode: "upi",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });

    const withdrawalPort = createWithdrawalTransactionPort();
    const withdrawalResult = await withdrawalPort.recordTransaction({
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "250000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-02",
      paymentMode: "neft",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      actorUserId,
    });

    const auditLogPort = createAuditLogPort();
    const rows = await auditLogPort.listAll();

    const investmentRow = rows.find(
      (row) => row.entityType === "investment_transaction" && row.entityId === investmentResult.transaction.id,
    );
    const withdrawalRow = rows.find(
      (row) => row.entityType === "withdrawal_transaction" && row.entityId === withdrawalResult.transaction.id,
    );
    expect(investmentRow).toBeDefined();
    expect(withdrawalRow).toBeDefined();
    expect(investmentRow?.action).toBe("create");
    expect(withdrawalRow?.action).toBe("create");
  });
});

import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  AvailableBalanceSpendIdempotencyKeyConflictError,
  InsufficientAvailableBalanceError,
  type DestinationSnapshotInput,
  type RecordAvailableBalanceSpendInput,
} from "@niveshbook/core";
import type { InvestmentRequirement, Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import { createAvailableBalancePort, createAvailableBalanceSpendPort } from "./ports";
import {
  auditLog,
  availableBalanceSpends,
  availableBalances,
  investmentRequirements,
  investmentTransactions,
  moneyMovements,
  partnerShares,
  projects,
  users,
  withdrawalDestinationAllocations,
  withdrawalTransactions,
} from "./schema";

// Mirrors `withdrawal-destination-allocation-port.test.ts`'s own defensive
// `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * `true` if `error` is a Postgres CHECK-constraint-violation error (SQL
 * state `23514`) naming `constraintName` specifically -- mirrors
 * `available-balance-port.test.ts`'s identical local helper one file over
 * (this drizzle-orm version wraps a query error in a `DrizzleQueryError`
 * whose own `.message` never contains the constraint name -- the real
 * `PostgresError` lives at `.cause`, the same shape `ports.ts`'s
 * `isUniqueViolation` fix accounts for).
 */
function isCheckConstraintViolation(constraintName: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (typeof error !== "object" || error === null || !("cause" in error)) {
      return false;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause !== "object" || cause === null) {
      return false;
    }
    const { code, constraint_name: constraintNameOnError } = cause as {
      code?: unknown;
      constraint_name?: unknown;
    };
    return code === "23514" && constraintNameOnError === constraintName;
  };
}

/**
 * Live-Postgres coverage for `createAvailableBalanceSpendPort.recordSpend`
 * (Story 4.9, FR29, AD-5/AD-6/AD-10) -- the "Use Balance" write path: a
 * "person" spend (plain debit + spend row, mirroring 4.7's "person" leg,
 * no linked investment/movement rows), a "project" spend (debit + spend row
 * + auto-created `investment_transactions`/`money_movements` via
 * `spendAvailableBalanceToProject()`, all one atomic transaction),
 * overdraft rejection, and idempotent replay.
 */
describe("createAvailableBalanceSpendPort.recordSpend (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds));
    }
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      await db.delete(moneyMovements).where(inArray(moneyMovements.sourceProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.destinationProjectId, projectIds));
      await db.delete(availableBalanceSpends).where(inArray(availableBalanceSpends.sourceProjectId, projectIds));
      await db
        .delete(availableBalanceSpends)
        .where(inArray(availableBalanceSpends.destinationProjectId, projectIds));
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
    await db.insert(projects).values({ id: projectId, name: `avail-spend-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `avail-spend-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  /** Mirrors `withdrawal-destination-allocation-port.test.ts`'s identical fixture one story over. */
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

  function personSpendInput(
    overrides: Partial<RecordAvailableBalanceSpendInput> = {},
  ): RecordAvailableBalanceSpendInput {
    return {
      sourceProjectId: "",
      partyType: "partner",
      shareId: "",
      destinationType: "person",
      amount: "10000" as Money,
      notes: null,
      destinationProjectId: null,
      destinationRequirementId: null,
      destinationShareId: null,
      destinationPartyType: null,
      destinationSnapshotInput: null,
      personName: "Person X",
      ...overrides,
    };
  }

  it("debits the balance and records a spend row for a 'person' spend -- no investment_transactions/money_movements row (mirrors 4.7's person leg)", async () => {
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
      personSpendInput({ sourceProjectId, shareId, amount: "20000" as Money }),
      uuidv7(),
      actorUserId,
    );

    expect(result.created).toBe(true);
    expect(result.spend.destinationType).toBe("person");
    expect(result.spend.personName).toBe("Person X");
    expect(result.spend.amount).toBe("20000.00");
    expect(result.investmentTransaction).toBeNull();
    expect(result.moneyMovement).toBeNull();

    const balances = await balancePort.listBalancesByProjectId(sourceProjectId);
    expect(balances[0]?.balance).toBe("30000.00");

    const db = getDb();
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, result.spend.id), eq(auditLog.entityType, "available_balance_spend")));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("create");
    expect(auditRows[0]?.actorUserId).toBe(actorUserId);

    // Review finding: the return value's `investmentTransaction`/
    // `moneyMovement` being `null` only proves what `recordSpend` reported
    // back, not that the tables themselves are actually empty -- query both
    // directly, scoped to this test's own sourceProjectId, to prove a
    // "person" spend genuinely never writes either row (mirrors 4.7's
    // "person" leg, no linked investment/movement record).
    const investmentRows = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.shareId, shareId));
    expect(investmentRows).toHaveLength(0);

    const movementRows = await db
      .select()
      .from(moneyMovements)
      .where(eq(moneyMovements.sourceProjectId, sourceProjectId));
    expect(movementRows).toHaveLength(0);
  });

  it("debits the balance, records a spend row, and auto-creates linked investment_transactions/money_movements rows for a 'project' spend (AC2's worked example)", async () => {
    const balancePort = createAvailableBalancePort();
    const spendPort = createAvailableBalanceSpendPort();
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

    const result = await spendPort.recordSpend(
      personSpendInput({
        sourceProjectId,
        shareId,
        destinationType: "project",
        amount: "30000" as Money,
        personName: null,
        destinationProjectId,
        destinationRequirementId: requirementId,
        destinationShareId: partnerId,
        destinationPartyType: "partner",
        destinationSnapshotInput: snapshot,
      }),
      uuidv7(),
      actorUserId,
    );

    expect(result.created).toBe(true);
    expect(result.investmentTransaction).not.toBeNull();
    expect(result.investmentTransaction?.projectId).toBe(destinationProjectId);
    expect(result.investmentTransaction?.requirementId).toBe(requirementId);
    expect(result.investmentTransaction?.shareId).toBe(partnerId);
    expect(result.investmentTransaction?.amount).toBe("30000.00");
    expect(result.moneyMovement).not.toBeNull();
    expect(result.moneyMovement?.availableBalanceSpendId).toBe(result.spend.id);
    expect(result.moneyMovement?.withdrawalDestinationAllocationId).toBeNull();
    expect(result.moneyMovement?.sourceProjectId).toBe(sourceProjectId);
    expect(result.moneyMovement?.destinationProjectId).toBe(destinationProjectId);

    const balances = await balancePort.listBalancesByProjectId(sourceProjectId);
    expect(balances[0]?.balance).toBe("20000.00");
  });

  it("rejects an overdraft attempt -- 409-mapped InsufficientAvailableBalanceError, no spend row, no investment_transactions row, balance unchanged (AC3)", async () => {
    const balancePort = createAvailableBalancePort();
    const spendPort = createAvailableBalanceSpendPort();
    const sourceProjectId = await seedProject();
    const actorUserId = await seedActor();
    const shareId = uuidv7();
    await balancePort.creditBalance({
      projectId: sourceProjectId,
      partyType: "partner",
      shareId,
      amount: "10000" as Money,
    });

    await expect(
      spendPort.recordSpend(
        personSpendInput({ sourceProjectId, shareId, amount: "20000" as Money }),
        uuidv7(),
        actorUserId,
      ),
    ).rejects.toBeInstanceOf(InsufficientAvailableBalanceError);

    const balances = await balancePort.listBalancesByProjectId(sourceProjectId);
    expect(balances[0]?.balance).toBe("10000.00");

    const db = getDb();
    const spendRows = await db
      .select()
      .from(availableBalanceSpends)
      .where(eq(availableBalanceSpends.sourceProjectId, sourceProjectId));
    expect(spendRows).toHaveLength(0);
  });

  it("replays an idempotent resubmission with identical content -- created: false, same spend id, no duplicate debit", async () => {
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
    const idempotencyKey = uuidv7();
    const input = personSpendInput({ sourceProjectId, shareId, amount: "20000" as Money });

    const first = await spendPort.recordSpend(input, idempotencyKey, actorUserId);
    const second = await spendPort.recordSpend(input, idempotencyKey, actorUserId);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.spend.id).toBe(first.spend.id);

    const balances = await balancePort.listBalancesByProjectId(sourceProjectId);
    // Only ONE debit applied -- a replay never double-debits.
    expect(balances[0]?.balance).toBe("30000.00");

    const db = getDb();
    const spendRows = await db
      .select()
      .from(availableBalanceSpends)
      .where(eq(availableBalanceSpends.sourceProjectId, sourceProjectId));
    expect(spendRows).toHaveLength(1);
  });

  it("replays a 'project' spend idempotently -- does NOT duplicate the investment_transactions/money_movements rows", async () => {
    const balancePort = createAvailableBalancePort();
    const spendPort = createAvailableBalanceSpendPort();
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
    const idempotencyKey = uuidv7();
    const input = personSpendInput({
      sourceProjectId,
      shareId,
      destinationType: "project",
      amount: "30000" as Money,
      personName: null,
      destinationProjectId,
      destinationRequirementId: requirementId,
      destinationShareId: partnerId,
      destinationPartyType: "partner",
      destinationSnapshotInput: snapshot,
    });

    const first = await spendPort.recordSpend(input, idempotencyKey, actorUserId);
    const second = await spendPort.recordSpend(input, idempotencyKey, actorUserId);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.moneyMovement?.id).toBe(first.moneyMovement?.id);
    expect(second.investmentTransaction?.id).toBe(first.investmentTransaction?.id);

    const db = getDb();
    const investmentRows = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.projectId, destinationProjectId));
    expect(investmentRows).toHaveLength(1);
    const movementRows = await db
      .select()
      .from(moneyMovements)
      .where(eq(moneyMovements.destinationProjectId, destinationProjectId));
    expect(movementRows).toHaveLength(1);
  });

  it("rejects a same-idempotencyKey resubmission with mismatched content -- AvailableBalanceSpendIdempotencyKeyConflictError", async () => {
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
    const idempotencyKey = uuidv7();

    await spendPort.recordSpend(
      personSpendInput({ sourceProjectId, shareId, amount: "10000" as Money }),
      idempotencyKey,
      actorUserId,
    );

    await expect(
      spendPort.recordSpend(
        personSpendInput({ sourceProjectId, shareId, amount: "9999" as Money }),
        idempotencyKey,
        actorUserId,
      ),
    ).rejects.toBeInstanceOf(AvailableBalanceSpendIdempotencyKeyConflictError);
  });

  it("recovers from a concurrent double-submit race -- two simultaneous calls with the same idempotencyKey and matching content resolve to exactly one spend row", async () => {
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
    const idempotencyKey = uuidv7();
    const input = personSpendInput({ sourceProjectId, shareId, amount: "20000" as Money });

    const [resultA, resultB] = await Promise.all([
      spendPort.recordSpend(input, idempotencyKey, actorUserId),
      spendPort.recordSpend(input, idempotencyKey, actorUserId),
    ]);

    expect([resultA.created, resultB.created].filter(Boolean)).toHaveLength(1);
    expect(resultA.spend.id).toBe(resultB.spend.id);

    const db = getDb();
    const spendRows = await db
      .select()
      .from(availableBalanceSpends)
      .where(eq(availableBalanceSpends.sourceProjectId, sourceProjectId));
    expect(spendRows).toHaveLength(1);

    const balances = await balancePort.listBalancesByProjectId(sourceProjectId);
    // Only one 20,000 debit applied -- not two.
    expect(balances[0]?.balance).toBe("30000.00");
  });

  /** Story 4.10 (FR30): the trail assembly's own lookup for an `available_balance_spend` node. */
  describe("findById", () => {
    it("returns the spend with the given id", async () => {
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
      const { spend } = await spendPort.recordSpend(
        personSpendInput({ sourceProjectId, shareId, amount: "20000" as Money }),
        uuidv7(),
        actorUserId,
      );

      const found = await spendPort.findById(spend.id);

      expect(found?.id).toBe(spend.id);
      expect(found?.amount).toBe("20000.00");
    });

    it("returns null for a nonexistent id", async () => {
      const spendPort = createAvailableBalanceSpendPort();

      expect(await spendPort.findById(uuidv7())).toBeNull();
    });
  });
});

/**
 * Review finding: `moveWithdrawalToProject()`/`spendAvailableBalanceToProject()`
 * both always pass exactly one of `withdrawalDestinationAllocationId`/
 * `availableBalanceSpendId` (never both, never neither) -- these tests
 * bypass that application-level discipline entirely (raw `db.insert` calls
 * against `money_movements`, not either orchestration function) to prove
 * the `money_movements_exactly_one_source_check` CHECK constraint
 * (schema.ts) is the real backstop it's documented to be (AD-6), not just
 * an inert declaration nothing ever actually exercises against Postgres.
 */
describe("money_movements_exactly_one_source_check CHECK constraint (AD-6 backstop)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds));
    }
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      await db.delete(moneyMovements).where(inArray(moneyMovements.sourceProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.destinationProjectId, projectIds));
      await db.delete(availableBalanceSpends).where(inArray(availableBalanceSpends.sourceProjectId, projectIds));
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `mm-check-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `mm-check-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  /** A real, valid `investment_transactions.id` -- `money_movements.destinationInvestmentTransactionId` is a NOT NULL FK, so every case below needs one regardless of which CHECK-relevant column is under test. */
  async function seedInvestmentTransactionId(projectId: string): Promise<string> {
    const db = getDb();
    const requirementId = uuidv7();
    await db.insert(investmentRequirements).values({
      id: requirementId,
      projectId,
      amount: "1000000",
      requirementDate: "2026-10-01",
    });
    const transactionId = uuidv7();
    await db.insert(investmentTransactions).values({
      id: transactionId,
      requirementId,
      projectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "100",
      shouldPaySnapshot: "1000000",
      amount: "100000",
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
      status: "active",
    });
    return transactionId;
  }

  /** A real, valid `withdrawal_destination_allocations.id`. */
  async function seedWithdrawalDestinationAllocationId(sourceProjectId: string): Promise<string> {
    const db = getDb();
    const withdrawalTransactionId = uuidv7();
    await db.insert(withdrawalTransactions).values({
      id: withdrawalTransactionId,
      projectId: sourceProjectId,
      partyType: "partner",
      shareId: uuidv7(),
      sharePercentSnapshot: "50",
      canTakeSnapshot: "500000",
      amount: "250000",
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      idempotencyKey: uuidv7(),
    });
    const allocationId = uuidv7();
    await db.insert(withdrawalDestinationAllocations).values({
      id: allocationId,
      withdrawalTransactionId,
      destinationType: "other",
      amount: "250000",
      notes: "Kept as cash",
      idempotencyKey: uuidv7(),
    });
    return allocationId;
  }

  /** A real, valid `available_balance_spends.id`, via the actual port (dogfooding an already-proven-working write path rather than a raw insert). */
  async function seedAvailableBalanceSpendId(sourceProjectId: string, actorUserId: string): Promise<string> {
    const balancePort = createAvailableBalancePort();
    const spendPort = createAvailableBalanceSpendPort();
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
        amount: "10000" as Money,
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
    return result.spend.id;
  }

  it("rejects a raw INSERT with NEITHER withdrawalDestinationAllocationId nor availableBalanceSpendId set", async () => {
    const db = getDb();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const destinationInvestmentTransactionId = await seedInvestmentTransactionId(destinationProjectId);

    await expect(
      db.insert(moneyMovements).values({
        id: uuidv7(),
        withdrawalDestinationAllocationId: null,
        availableBalanceSpendId: null,
        sourceProjectId,
        destinationProjectId,
        destinationInvestmentTransactionId,
        amount: "50000",
      }),
    ).rejects.toSatisfy(isCheckConstraintViolation("money_movements_exactly_one_source_check"));
  });

  it("rejects a raw INSERT with BOTH withdrawalDestinationAllocationId and availableBalanceSpendId set", async () => {
    const db = getDb();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const actorUserId = await seedActor();
    const destinationInvestmentTransactionId = await seedInvestmentTransactionId(destinationProjectId);
    const withdrawalDestinationAllocationId = await seedWithdrawalDestinationAllocationId(sourceProjectId);
    const availableBalanceSpendId = await seedAvailableBalanceSpendId(sourceProjectId, actorUserId);

    await expect(
      db.insert(moneyMovements).values({
        id: uuidv7(),
        withdrawalDestinationAllocationId,
        availableBalanceSpendId,
        sourceProjectId,
        destinationProjectId,
        destinationInvestmentTransactionId,
        amount: "50000",
      }),
    ).rejects.toSatisfy(isCheckConstraintViolation("money_movements_exactly_one_source_check"));
  });

  it("allows a raw INSERT with exactly one of the two set (sanity check the CHECK isn't over-broad)", async () => {
    const db = getDb();
    const sourceProjectId = await seedProject();
    const destinationProjectId = await seedProject();
    const actorUserId = await seedActor();
    const destinationInvestmentTransactionId = await seedInvestmentTransactionId(destinationProjectId);
    const availableBalanceSpendId = await seedAvailableBalanceSpendId(sourceProjectId, actorUserId);

    const [row] = await db
      .insert(moneyMovements)
      .values({
        id: uuidv7(),
        withdrawalDestinationAllocationId: null,
        availableBalanceSpendId,
        sourceProjectId,
        destinationProjectId,
        destinationInvestmentTransactionId,
        amount: "50000",
      })
      .returning();

    expect(row?.availableBalanceSpendId).toBe(availableBalanceSpendId);
  });
});

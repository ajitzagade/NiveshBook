import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  InsufficientAvailableBalanceError,
  WithdrawalAlreadyCancelledError,
  WithdrawalAmountLockedByAllocationError,
  WithdrawalIdempotencyKeyConflictError,
  type DestinationSnapshotInput,
} from "@niveshbook/core";
import type { InvestmentRequirement, Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import {
  createAvailableBalancePort,
  createInvestmentTransactionPort,
  createWithdrawalDestinationAllocationPort,
  createWithdrawalTransactionPort,
} from "./ports";
import {
  auditLog,
  investmentRequirements,
  investmentTransactions,
  moneyMovements,
  partnerShares,
  projects,
  users,
  withdrawalTransactions,
} from "./schema";

// Mirrors `withdrawal-transaction-port.test.ts`'s own defensive
// `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createWithdrawalTransactionPort.editTransaction`/
 * `.cancelTransaction` (Story 4.11) -- the genuinely new cross-cutting
 * concern this story adds: unlike the investment side's Stories 3.7/3.8
 * (mirrored here for the single-table edit/cancel mechanics), a withdrawal's
 * cancel cascades to every linked destination-allocation leg, so this file
 * specifically exercises every leg-type branch for real against real
 * Postgres, not just a mocked port -- the "project" leg cascade cancelling
 * its own destination `investment_transactions` row, the "available_balance"
 * leg's successful pool reversal, and (this story's trickiest, most
 * important behavior) the full-transaction rollback when that pool has
 * already been partly spent elsewhere.
 */
describe("createWithdrawalTransactionPort.editTransaction/.cancelTransaction (live Postgres, Story 4.11)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds.splice(0)));
    }
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      // `money_movements` has no cascading FK on either of its own
      // `projects` references (schema.ts's own doc comment) -- clear it
      // first, mirroring `withdrawal-destination-allocation-port.test.ts`'s
      // identical cleanup precedent.
      await db.delete(moneyMovements).where(inArray(moneyMovements.sourceProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.destinationProjectId, projectIds));
    }
    for (const id of projectIds) {
      // withdrawal_transactions/investment_transactions/withdrawal_destination_allocations/
      // available_balances all cascade-delete via their own `projects` FK --
      // one project delete clears the whole chain.
      await db.delete(projects).where(eq(projects.id, id));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `withdrawal-edit-cancel-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `withdrawal-edit-cancel-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  /** Mirrors `withdrawal-destination-allocation-port.test.ts`'s identical helper -- a fully-allocated (100%) destination Partner Share so `buildTransactionSnapshot` succeeds. */
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

  async function seedWithdrawal(
    projectId: string,
    actorUserId: string,
    amount = "250000",
  ): Promise<string> {
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

  describe("editTransaction", () => {
    it("atomically updates the row and inserts one paired 'edit' audit_log entry", async () => {
      const port = createWithdrawalTransactionPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId, "250000");

      const result = await port.editTransaction({
        transactionId,
        amount: "300000" as Money,
        transactionDate: "2026-10-06",
        paymentMode: "upi",
        referenceNumber: "REF-2",
        notes: "corrected",
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: "typo'd amount",
      });

      expect(result.edited).toBe(true);
      expect(result.transaction.amount).toBe("300000.00");
      expect(result.transaction.paymentMode).toBe("upi");
      expect(result.transaction.referenceNumber).toBe("REF-2");
      expect(result.transaction.notes).toBe("corrected");

      const db = getDb();
      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, transactionId), eq(auditLog.entityType, "withdrawal_transaction")));
      const editEntry = auditRows.find((row) => row.action === "edit");
      expect(editEntry).toBeDefined();
      expect(editEntry?.reason).toBe("typo'd amount");
      expect((editEntry?.oldValue as { amount?: string } | null)?.amount).toBe("250000.00");
      expect((editEntry?.newValue as { amount?: string } | null)?.amount).toBe("300000.00");
    });

    it("replays an idempotent resubmission -- exactly one edit audit entry, edited: false", async () => {
      const port = createWithdrawalTransactionPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId);
      const idempotencyKey = uuidv7();
      const editInput = {
        transactionId,
        amount: "300000" as Money,
        transactionDate: "2026-10-06",
        paymentMode: "upi" as const,
        referenceNumber: null,
        notes: null,
        idempotencyKey,
        actorUserId,
        reason: null,
      };

      const first = await port.editTransaction(editInput);
      const second = await port.editTransaction(editInput);

      expect(first.edited).toBe(true);
      expect(second.edited).toBe(false);
      expect(second.transaction).toEqual(first.transaction);

      const db = getDb();
      const editEntries = (
        await db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.entityId, transactionId), eq(auditLog.entityType, "withdrawal_transaction")))
      ).filter((row) => row.action === "edit");
      expect(editEntries).toHaveLength(1);
    });

    it("rejects a genuine key collision with a DIFFERENT withdrawal's edit -- IdempotencyKeyConflictError", async () => {
      const port = createWithdrawalTransactionPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionIdA = await seedWithdrawal(projectId, actorUserId);
      const transactionIdB = await seedWithdrawal(projectId, actorUserId);
      const sharedKey = uuidv7();

      await port.editTransaction({
        transactionId: transactionIdA,
        amount: "300000" as Money,
        transactionDate: "2026-10-06",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
        idempotencyKey: sharedKey,
        actorUserId,
        reason: null,
      });

      await expect(
        port.editTransaction({
          transactionId: transactionIdB,
          amount: "300000" as Money,
          transactionDate: "2026-10-06",
          paymentMode: "upi",
          referenceNumber: null,
          notes: null,
          idempotencyKey: sharedKey,
          actorUserId,
          reason: null,
        }),
      ).rejects.toThrow(WithdrawalIdempotencyKeyConflictError);
    });

    it("rejects editing amount once a destination allocation leg has been recorded (this story's Decisions #5) -- 409-mappable WithdrawalAmountLockedByAllocationError", async () => {
      const withdrawalPort = createWithdrawalTransactionPort();
      const allocationPort = createWithdrawalDestinationAllocationPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId, "250000");

      await allocationPort.recordAllocation(
        transactionId,
        [
          {
            destinationType: "other",
            amount: "250000" as Money,
            destinationProjectId: null,
            personName: null,
            notes: "Kept as cash",
            destinationRequirementId: null,
            destinationShareId: null,
            destinationPartyType: null,
            destinationSnapshotInput: null,
          },
        ],
        uuidv7(),
        actorUserId,
      );

      await expect(
        withdrawalPort.editTransaction({
          transactionId,
          amount: "300000" as Money,
          transactionDate: "2026-10-05",
          paymentMode: "neft",
          referenceNumber: null,
          notes: null,
          idempotencyKey: uuidv7(),
          actorUserId,
          reason: null,
        }),
      ).rejects.toThrow(WithdrawalAmountLockedByAllocationError);

      // Non-amount fields stay freely editable regardless of allocation status.
      const nonAmountResult = await withdrawalPort.editTransaction({
        transactionId,
        amount: "250000" as Money,
        transactionDate: "2026-10-05",
        paymentMode: "cash",
        referenceNumber: "still editable",
        notes: null,
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: null,
      });
      expect(nonAmountResult.edited).toBe(true);
      expect(nonAmountResult.transaction.paymentMode).toBe("cash");
    });

    it("rejects editing an already-cancelled withdrawal -- 409-mappable WithdrawalAlreadyCancelledError", async () => {
      const port = createWithdrawalTransactionPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId);

      await port.cancelTransaction({
        transactionId,
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: null,
      });

      await expect(
        port.editTransaction({
          transactionId,
          amount: "300000" as Money,
          transactionDate: "2026-10-06",
          paymentMode: "upi",
          referenceNumber: null,
          notes: null,
          idempotencyKey: uuidv7(),
          actorUserId,
          reason: null,
        }),
      ).rejects.toThrow(WithdrawalAlreadyCancelledError);
    });
  });

  describe("cancelTransaction", () => {
    it("flips the original row to cancelled and inserts a linked reversal row, for a withdrawal with no legs", async () => {
      const port = createWithdrawalTransactionPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId, "250000");

      const result = await port.cancelTransaction({
        transactionId,
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: "recorded by mistake",
      });

      expect(result.cancelled).toBe(true);
      expect(result.originalTransaction.status).toBe("cancelled");
      expect(result.reversalTransaction.status).toBe("cancelled");
      expect(result.reversalTransaction.reversalOfTransactionId).toBe(transactionId);
      expect(result.reversalTransaction.amount).toBe("250000.00");

      const db = getDb();
      const rows = await db
        .select()
        .from(withdrawalTransactions)
        .where(eq(withdrawalTransactions.projectId, projectId));
      expect(rows).toHaveLength(2);

      const cancelEntries = (
        await db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.entityId, transactionId), eq(auditLog.entityType, "withdrawal_transaction")))
      ).filter((row) => row.action === "cancel");
      expect(cancelEntries).toHaveLength(1);
      expect(cancelEntries[0]?.reason).toBe("recorded by mistake");
    });

    it("cancelling a 'project' leg cascades to cancel the destination investment_transactions row too, atomically", async () => {
      const port = createWithdrawalTransactionPort();
      const allocationPort = createWithdrawalDestinationAllocationPort();
      const investmentTransactionPort = createInvestmentTransactionPort();
      const sourceProjectId = await seedProject();
      const destinationProjectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(sourceProjectId, actorUserId, "150000");
      const { requirementId, partnerId, snapshot } = await seedDestinationRequirementAndShare(
        destinationProjectId,
      );

      const allocationResult = await allocationPort.recordAllocation(
        transactionId,
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
      const destinationInvestmentTransactionId =
        allocationResult.moneyMovements[0]?.destinationInvestmentTransactionId;
      expect(destinationInvestmentTransactionId).toBeDefined();

      const result = await port.cancelTransaction({
        transactionId,
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: null,
      });

      expect(result.cancelled).toBe(true);
      expect(result.originalTransaction.status).toBe("cancelled");

      // The destination investment_transactions row is ALSO cancelled, via
      // the unchanged, already-shipped `InvestmentTransactionPort.cancelTransaction()`
      // (this story's Boundaries -- no new cancel-shaped logic for that half).
      const destinationTx = await investmentTransactionPort.findById(
        destinationInvestmentTransactionId as string,
      );
      expect(destinationTx?.status).toBe("cancelled");

      // The destination row's own reversal row exists too (Story 3.8's
      // unmodified contract, exercised here only as a side effect).
      const db = getDb();
      const destinationProjectTxRows = await db
        .select()
        .from(investmentTransactions)
        .where(eq(investmentTransactions.projectId, destinationProjectId));
      expect(destinationProjectTxRows).toHaveLength(2);

      // `money_movements`/`withdrawal_destination_allocations` rows are
      // NEVER touched by a cancel (this story's Decisions #3/#4).
      const legRows = await allocationPort.listByWithdrawalTransactionId(transactionId);
      expect(legRows).toHaveLength(1);
      const movementRows = await db
        .select()
        .from(moneyMovements)
        .where(eq(moneyMovements.destinationProjectId, destinationProjectId));
      expect(movementRows).toHaveLength(1);
    });

    it("cancelling TWO 'project' legs to two DIFFERENT destination Projects cascades to cancel both destination rows -- proves the derived :cancel-cascade:0/:1 idempotency keys don't collide against the real audit_log UNIQUE constraint", async () => {
      const port = createWithdrawalTransactionPort();
      const allocationPort = createWithdrawalDestinationAllocationPort();
      const investmentTransactionPort = createInvestmentTransactionPort();
      const sourceProjectId = await seedProject();
      const destinationProjectIdA = await seedProject();
      const destinationProjectIdB = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(sourceProjectId, actorUserId, "250000");
      const seedA = await seedDestinationRequirementAndShare(destinationProjectIdA);
      const seedB = await seedDestinationRequirementAndShare(destinationProjectIdB);

      const allocationResult = await allocationPort.recordAllocation(
        transactionId,
        [
          {
            destinationType: "project",
            amount: "150000" as Money,
            destinationProjectId: destinationProjectIdA,
            personName: null,
            notes: null,
            destinationRequirementId: seedA.requirementId,
            destinationShareId: seedA.partnerId,
            destinationPartyType: "partner",
            destinationSnapshotInput: seedA.snapshot,
          },
          {
            destinationType: "project",
            amount: "100000" as Money,
            destinationProjectId: destinationProjectIdB,
            personName: null,
            notes: null,
            destinationRequirementId: seedB.requirementId,
            destinationShareId: seedB.partnerId,
            destinationPartyType: "partner",
            destinationSnapshotInput: seedB.snapshot,
          },
        ],
        uuidv7(),
        actorUserId,
      );
      const movementA = allocationResult.moneyMovements.find(
        (m) => m.destinationProjectId === destinationProjectIdA,
      );
      const movementB = allocationResult.moneyMovements.find(
        (m) => m.destinationProjectId === destinationProjectIdB,
      );
      expect(movementA).toBeDefined();
      expect(movementB).toBeDefined();

      const result = await port.cancelTransaction({
        transactionId,
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: null,
      });

      expect(result.cancelled).toBe(true);
      expect(result.originalTransaction.status).toBe("cancelled");

      // Both destination investment_transactions rows are cancelled -- each
      // via its own genuinely-inserted `audit_log` "cancel" row, keyed by
      // its own derived `:cancel-cascade:<legIndex>` idempotency key. If the
      // two derived keys ever collided against the real, live
      // `audit_log.idempotencyKey` UNIQUE constraint, the second leg's
      // cancel would fail with a unique-violation (or silently replay the
      // first leg's cancel instead of performing its own) -- this is the
      // only way to prove that never happens, since a fake-backed unit test
      // has no real UNIQUE constraint to violate.
      const destinationTxA = await investmentTransactionPort.findById(
        movementA?.destinationInvestmentTransactionId as string,
      );
      const destinationTxB = await investmentTransactionPort.findById(
        movementB?.destinationInvestmentTransactionId as string,
      );
      expect(destinationTxA?.status).toBe("cancelled");
      expect(destinationTxB?.status).toBe("cancelled");

      const db = getDb();
      const cancelAuditRowsA = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, movementA?.destinationInvestmentTransactionId as string),
            eq(auditLog.entityType, "investment_transaction"),
            eq(auditLog.action, "cancel"),
          ),
        );
      const cancelAuditRowsB = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, movementB?.destinationInvestmentTransactionId as string),
            eq(auditLog.entityType, "investment_transaction"),
            eq(auditLog.action, "cancel"),
          ),
        );
      expect(cancelAuditRowsA).toHaveLength(1);
      expect(cancelAuditRowsB).toHaveLength(1);
      expect(cancelAuditRowsA[0]?.idempotencyKey).not.toBe(cancelAuditRowsB[0]?.idempotencyKey);
      expect(cancelAuditRowsA[0]?.idempotencyKey).toMatch(/:cancel-cascade:0$/);
      expect(cancelAuditRowsB[0]?.idempotencyKey).toMatch(/:cancel-cascade:1$/);
    });

    it("cancelling an 'available_balance' leg whose pool is untouched reverses the credit exactly (pool returns to its pre-credit balance)", async () => {
      const port = createWithdrawalTransactionPort();
      const allocationPort = createWithdrawalDestinationAllocationPort();
      const balancePort = createAvailableBalancePort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId, "250000");

      await allocationPort.recordAllocation(
        transactionId,
        [
          {
            destinationType: "available_balance",
            amount: "250000" as Money,
            destinationProjectId: null,
            personName: null,
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

      const balancesBefore = await balancePort.listBalancesByProjectId(projectId);
      expect(balancesBefore[0]?.balance).toBe("250000.00");

      const result = await port.cancelTransaction({
        transactionId,
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: null,
      });

      expect(result.cancelled).toBe(true);
      const balancesAfter = await balancePort.listBalancesByProjectId(projectId);
      // Reversed back to exactly its pre-credit balance -- "0.00".
      expect(balancesAfter[0]?.balance).toBe("0.00");
    });

    it("cancelling an 'available_balance' leg whose pool was already PARTLY SPENT elsewhere rejects the whole cancel and rolls back everything (this story's Decisions #2 -- the trickiest, most important case)", async () => {
      const port = createWithdrawalTransactionPort();
      const allocationPort = createWithdrawalDestinationAllocationPort();
      const balancePort = createAvailableBalancePort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId, "250000");
      const withdrawalRows = await getDb()
        .select()
        .from(withdrawalTransactions)
        .where(eq(withdrawalTransactions.id, transactionId));
      const shareId = withdrawalRows[0]?.shareId;
      expect(shareId).toBeDefined();

      await allocationPort.recordAllocation(
        transactionId,
        [
          {
            destinationType: "available_balance",
            amount: "250000" as Money,
            destinationProjectId: null,
            personName: null,
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

      // Simulate "already spent onward" (Story 4.9) by directly debiting
      // part of the pool -- leaves only ₹1,00,000 of the ₹2,50,000 this leg
      // originally credited.
      await balancePort.debitBalance({
        projectId,
        partyType: "partner",
        shareId: shareId as string,
        amount: "150000" as Money,
      });
      const balancesBeforeAttempt = await balancePort.listBalancesByProjectId(projectId);
      expect(balancesBeforeAttempt[0]?.balance).toBe("100000.00");

      await expect(
        port.cancelTransaction({
          transactionId,
          idempotencyKey: uuidv7(),
          actorUserId,
          reason: null,
        }),
      ).rejects.toThrow(InsufficientAvailableBalanceError);

      // NOTHING partially cancelled: the pool's balance is untouched by the
      // failed attempt, the withdrawal is still active, and no reversal row
      // was created -- the entire cancellation rolled back (this story's
      // Decisions #2).
      const balancesAfterAttempt = await balancePort.listBalancesByProjectId(projectId);
      expect(balancesAfterAttempt[0]?.balance).toBe("100000.00");

      const db = getDb();
      const rows = await db
        .select()
        .from(withdrawalTransactions)
        .where(eq(withdrawalTransactions.projectId, projectId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("active");

      const cancelEntries = (
        await db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.entityId, transactionId), eq(auditLog.entityType, "withdrawal_transaction")))
      ).filter((row) => row.action === "cancel");
      expect(cancelEntries).toHaveLength(0);
    });

    it("'person'/'other' legs are never touched by a cancel -- the withdrawal still cancels cleanly", async () => {
      const port = createWithdrawalTransactionPort();
      const allocationPort = createWithdrawalDestinationAllocationPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId, "250000");

      await allocationPort.recordAllocation(
        transactionId,
        [
          {
            destinationType: "person",
            amount: "150000" as Money,
            destinationProjectId: null,
            personName: "Person X",
            notes: null,
            destinationRequirementId: null,
            destinationShareId: null,
            destinationPartyType: null,
            destinationSnapshotInput: null,
          },
          {
            destinationType: "other",
            amount: "100000" as Money,
            destinationProjectId: null,
            personName: null,
            notes: "Petty cash",
            destinationRequirementId: null,
            destinationShareId: null,
            destinationPartyType: null,
            destinationSnapshotInput: null,
          },
        ],
        uuidv7(),
        actorUserId,
      );

      const result = await port.cancelTransaction({
        transactionId,
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: null,
      });

      expect(result.cancelled).toBe(true);
      const legRows = await allocationPort.listByWithdrawalTransactionId(transactionId);
      expect(legRows).toHaveLength(2);
    });

    it("rejects an already-cancelled withdrawal -- 409-mappable WithdrawalAlreadyCancelledError, no second reversal row", async () => {
      const port = createWithdrawalTransactionPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId);

      await port.cancelTransaction({
        transactionId,
        idempotencyKey: uuidv7(),
        actorUserId,
        reason: null,
      });

      await expect(
        port.cancelTransaction({
          transactionId,
          idempotencyKey: uuidv7(),
          actorUserId,
          reason: null,
        }),
      ).rejects.toThrow(WithdrawalAlreadyCancelledError);

      const db = getDb();
      const rows = await db
        .select()
        .from(withdrawalTransactions)
        .where(eq(withdrawalTransactions.projectId, projectId));
      expect(rows).toHaveLength(2);
    });

    it("replays an idempotent resubmission of a cancel -- cancelled: false, no second reversal row", async () => {
      const port = createWithdrawalTransactionPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId);
      const idempotencyKey = uuidv7();

      const first = await port.cancelTransaction({
        transactionId,
        idempotencyKey,
        actorUserId,
        reason: null,
      });
      const second = await port.cancelTransaction({
        transactionId,
        idempotencyKey,
        actorUserId,
        reason: null,
      });

      expect(first.cancelled).toBe(true);
      expect(second.cancelled).toBe(false);
      expect(second.originalTransaction).toEqual(first.originalTransaction);
      expect(second.reversalTransaction).toEqual(first.reversalTransaction);

      const db = getDb();
      const rows = await db
        .select()
        .from(withdrawalTransactions)
        .where(eq(withdrawalTransactions.projectId, projectId));
      expect(rows).toHaveLength(2);
    });

    it("a concurrent double-cancel race resolves to exactly one reversal row -- the loser recovers via the race-winner replay path, never a genuine second cancel", async () => {
      const port = createWithdrawalTransactionPort();
      const projectId = await seedProject();
      const actorUserId = await seedActor();
      const transactionId = await seedWithdrawal(projectId, actorUserId);
      // Both requests carry the SAME idempotencyKey -- a genuinely concurrent
      // double-submit of the identical logical cancel attempt (e.g. a
      // doubly-clicked Confirm Cancel button), mirroring this story's I/O
      // matrix ("Idempotent replay of a cancel").
      const idempotencyKey = uuidv7();

      const [first, second] = await Promise.all([
        port.cancelTransaction({ transactionId, idempotencyKey, actorUserId, reason: null }),
        port.cancelTransaction({ transactionId, idempotencyKey, actorUserId, reason: null }),
      ]);

      // Exactly one of the two genuinely performed the cancel; the other
      // resolved to the race-winner's replay result.
      expect([first.cancelled, second.cancelled].sort()).toEqual([false, true]);
      expect(first.originalTransaction.id).toBe(second.originalTransaction.id);
      expect(first.reversalTransaction.id).toBe(second.reversalTransaction.id);

      const db = getDb();
      const rows = await db
        .select()
        .from(withdrawalTransactions)
        .where(eq(withdrawalTransactions.projectId, projectId));
      expect(rows).toHaveLength(2);
      const cancelEntries = (
        await db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.entityId, transactionId), eq(auditLog.entityType, "withdrawal_transaction")))
      ).filter((row) => row.action === "cancel");
      expect(cancelEntries).toHaveLength(1);
    });
  });
});

import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  assertExtraWithdrawalAuthorized,
  type DestinationSnapshotInput,
} from "@niveshbook/core";
import type { InvestmentRequirement, Money, Percent } from "@niveshbook/types";
import { getDb } from "./client";
import {
  createAdjustmentNettingPort,
  createInvestmentAdjustmentPort,
  createWithdrawalAdjustmentPort,
  createWithdrawalDestinationAllocationPort,
  createWithdrawalTransactionPort,
} from "./ports";
import {
  auditLog,
  investmentRequirements,
  moneyMovements,
  partnerShares,
  projects,
  users,
} from "./schema";

// Mirrors `withdrawal-destination-allocation-port.test.ts`'s own defensive
// `DATABASE_URL` loading.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Integration coverage for a real-world chain that's only ever been
 * exercised piece-by-piece in isolated unit/port tests (`extra-withdrawal.ts`,
 * `withdrawal-destination-allocation-port.test.ts`,
 * `adjustment-netting-port.test.ts`), never together end to end against real
 * Postgres: one party's withdrawal exceeds their Can Take (Extra Withdrawal
 * authorization, Story 4.5), the withdrawn amount is reinvested into a
 * different Project (the "project" destination leg, Story 4.7/4.8), and the
 * resulting gap is later recorded as an Adjustment Netting (Story 5.3) --
 * all three touching the same (partyType, shareId) across two Projects in
 * one session. The manual, non-CI `uat-rareearth-lifecycle.spec.ts` is the
 * only other place this combination is exercised at all. This proves the
 * chain doesn't corrupt either Project's own ledger and, critically, that
 * `investment_adjustments`/`withdrawal_adjustments` for this exact party stay
 * byte-for-byte unchanged through the WHOLE chain (AD-4), not just through
 * an isolated netting call with no surrounding activity.
 */
describe("extra-withdrawal + cross-project reinvestment + adjustment netting chain (live Postgres)", () => {
  const seededProjectIds: string[] = [];
  const seededUserIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    if (seededUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorUserId, seededUserIds));
    }
    const projectIds = seededProjectIds.splice(0);
    if (projectIds.length > 0) {
      // Mirrors `withdrawal-destination-allocation-port.test.ts`'s identical
      // cleanup precedent -- `money_movements`' own `projects` FKs have no
      // cascade, so clear it before the project delete.
      await db.delete(moneyMovements).where(inArray(moneyMovements.sourceProjectId, projectIds));
      await db.delete(moneyMovements).where(inArray(moneyMovements.destinationProjectId, projectIds));
    }
    for (const id of projectIds) {
      await db.delete(projects).where(eq(projects.id, id));
    }
    for (const id of seededUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `extra-reinvest-netting-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  async function seedActor(): Promise<string> {
    const db = getDb();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: `extra-reinvest-netting-test-${userId}@niveshbook.test`,
      passwordHash: "irrelevant-hash",
      role: "owner_admin",
    });
    seededUserIds.push(userId);
    return userId;
  }

  /** Mirrors `withdrawal-destination-allocation-port.test.ts`'s identical fixture -- a fully-allocated (100%) destination Partner Share so `buildTransactionSnapshot` succeeds. */
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

  it(
    "an over-Can-Take withdrawal, reinvested cross-Project, then netted -- both Projects' ledgers stay correct and this party's existing adjustments stay byte-for-byte unchanged",
    async () => {
      const sourceProjectId = await seedProject();
      const destinationProjectId = await seedProject();
      const actorUserId = await seedActor();
      const shareId = uuidv7();

      // A pre-existing adjustment for this exact party, on the SOURCE
      // Project -- the thing this test actually proves stays untouched
      // through the whole chain below, not just through an isolated
      // netting call with nothing else going on.
      const investmentAdjustmentPort = createInvestmentAdjustmentPort();
      const withdrawalAdjustmentPort = createWithdrawalAdjustmentPort();
      const sourceRequirementId = uuidv7();
      await getDb().insert(investmentRequirements).values({
        id: sourceRequirementId,
        projectId: sourceProjectId,
        amount: "500000",
        requirementDate: "2026-09-01",
      });
      const investmentAdjustmentBefore = await investmentAdjustmentPort.upsert({
        projectId: sourceProjectId,
        partyType: "partner",
        shareId,
        requirementId: sourceRequirementId,
        shouldPay: "500000" as Money,
        actualPaid: "500000" as Money,
        adjustmentType: "none",
        adjustmentAmount: "0" as Money,
      });
      const withdrawalAdjustmentBefore = await withdrawalAdjustmentPort.upsert({
        projectId: sourceProjectId,
        partyType: "partner",
        shareId,
        canTake: "500000" as Money,
        taken: "0" as Money,
        adjustmentType: "keep_for_later",
        adjustmentAmount: "500000" as Money,
      });

      // Step 1 (Story 4.5): this party's live Can Take is 500,000 -- a
      // 600,000 Take Now request exceeds it, so the server-side gate must
      // require Owner/Admin + the extra-withdrawal confirmation. An eligible,
      // confirming Owner/Admin passes with no throw.
      const requestedAmount = "600000" as Money;
      const liveCanTake = "500000" as Money;
      expect(() =>
        assertExtraWithdrawalAuthorized({
          requestedAmount,
          canTake: liveCanTake,
          actorRole: "owner_admin",
          actorCanApproveExtraWithdrawal: true,
          extraWithdrawalAuthorized: true,
        }),
      ).not.toThrow();

      // Step 2 (Story 4.2): the gate passed, so the full 600,000 Take Now is
      // recorded -- the data layer itself enforces no cap (documented
      // non-goal, see `withdrawal-transaction-port.test.ts`'s own
      // `sumActiveAmountByProjectId` regression).
      const withdrawalPort = createWithdrawalTransactionPort();
      const { transaction: withdrawal } = await withdrawalPort.recordTransaction({
        projectId: sourceProjectId,
        partyType: "partner",
        shareId,
        sharePercentSnapshot: "100" as Percent,
        canTakeSnapshot: liveCanTake,
        amount: requestedAmount,
        transactionDate: "2026-10-07",
        paymentMode: "neft",
        referenceNumber: null,
        notes: "Extra withdrawal, Owner/Admin-authorized",
        idempotencyKey: uuidv7(),
        actorUserId,
      });
      expect(withdrawal.amount).toBe("600000.00");

      // Step 3 (Story 4.7/4.8): the whole withdrawal is reinvested into a
      // different Project via a "project" destination leg -- auto-creates
      // the destination investment_transactions row + linking money_movement.
      const { requirementId: destinationRequirementId, partnerId: destinationPartnerId, snapshot } =
        await seedDestinationRequirementAndShare(destinationProjectId);
      const allocationPort = createWithdrawalDestinationAllocationPort();
      const allocationResult = await allocationPort.recordAllocation(
        withdrawal.id,
        [
          {
            destinationType: "project",
            amount: requestedAmount,
            destinationProjectId,
            destinationRequirementId,
            destinationShareId: destinationPartnerId,
            destinationPartyType: "partner",
            destinationSnapshotInput: snapshot,
            personName: null,
            notes: null,
          },
        ],
        uuidv7(),
        actorUserId,
      );
      expect(allocationResult.created).toBe(true);
      const projectLeg = allocationResult.allocations[0];
      expect(projectLeg?.destinationProjectId).toBe(destinationProjectId);
      expect(projectLeg?.amount).toBe("600000.00");

      const movements = await getDb()
        .select()
        .from(moneyMovements)
        .where(eq(moneyMovements.sourceProjectId, sourceProjectId));
      expect(movements).toHaveLength(1);
      expect(movements[0]?.destinationProjectId).toBe(destinationProjectId);
      expect(movements[0]?.amount).toBe("600000.00");

      // Step 4 (Story 5.3): the 100,000 gap between live Can Take (500,000)
      // and what was actually taken (600,000) is recorded as a deliberate,
      // audited netting decision against this SAME party's investment side.
      const nettingPort = createAdjustmentNettingPort();
      const nettingResult = await nettingPort.recordNetting(
        {
          projectId: sourceProjectId,
          partyType: "partner",
          shareId,
          investmentRequirementId: sourceRequirementId,
          amount: "100000" as Money,
          notes: "Extra 100,000 taken above Can Take, netted against this round's investment side",
        },
        uuidv7(),
        actorUserId,
      );
      expect(nettingResult.created).toBe(true);

      // The whole chain above -- extra withdrawal, cross-Project
      // reinvestment, AND the netting write -- must leave this party's
      // pre-existing adjustments on the source Project byte-for-byte
      // unchanged (AD-4), not just the netting call in isolation.
      const [investmentAdjustmentAfter] = await investmentAdjustmentPort.listByProjectId(sourceProjectId);
      const [withdrawalAdjustmentAfter] = await withdrawalAdjustmentPort.listByProjectId(sourceProjectId);
      expect(investmentAdjustmentAfter).toEqual(investmentAdjustmentBefore);
      expect(withdrawalAdjustmentAfter).toEqual(withdrawalAdjustmentBefore);
    },
  );
});

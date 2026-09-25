import { describe, it, expect } from "vitest";
import type {
  InvestmentRequirement,
  InvestmentTransaction,
  Money,
  MoneyMovement,
  PartnerShare,
  Percent,
  SubPartnerShare,
} from "@niveshbook/types";
import type { CreateInvestmentTransactionInput, InvestmentTransactionPort } from "./investment-transaction-port";
import type { CreateMoneyMovementInput, MoneyMovementPort } from "./money-movement-port";
import { spendAvailableBalanceToProject } from "./spend-available-balance";
import { ShareNotFoundError } from "./investment-transaction";
import { SharesNotFullyAllocatedError, SubPartnerSharesOverAllocatedError } from "./should-pay";

/**
 * Mirrors `move-withdrawal-to-project.test.ts`'s identical fixtures/fakes --
 * `spendAvailableBalanceToProject()` is this story's new, additive sibling
 * of `moveWithdrawalToProject()`, exercising the exact same
 * `buildTransactionSnapshot` -> `recordTransaction` -> `moneyMovements.record`
 * shape one story over.
 */
function makeRequirement(overrides: Partial<InvestmentRequirement> = {}): InvestmentRequirement {
  return {
    id: "req-2",
    projectId: "project-2",
    amount: "1000000" as Money,
    requirementDate: "2026-10-01",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePartner(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "row-1",
    partnerId: "partner-2",
    projectId: "project-2",
    name: "Partner B",
    sharePercent: "100" as Percent,
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createFakeInvestmentTransactionPort(): InvestmentTransactionPort & {
  calls: CreateInvestmentTransactionInput[];
} {
  const calls: CreateInvestmentTransactionInput[] = [];
  return {
    calls,
    async recordTransaction(input) {
      calls.push(input);
      const transaction: InvestmentTransaction = {
        id: `tx-${calls.length}`,
        requirementId: input.requirementId,
        projectId: input.projectId,
        partyType: input.partyType,
        shareId: input.shareId,
        sharePercentSnapshot: input.sharePercentSnapshot,
        shouldPaySnapshot: input.shouldPaySnapshot,
        amount: input.amount,
        transactionDate: input.transactionDate,
        paymentMode: input.paymentMode,
        referenceNumber: input.referenceNumber,
        notes: input.notes,
        status: "active",
        reversalOfTransactionId: null,
        createdAt: new Date().toISOString(),
      };
      return { transaction, created: true };
    },
    async listByRequirementId() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
    async findById() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
    async editTransaction() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
    async findAuditLogByTransactionId() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
    async cancelTransaction() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
    async sumActiveAmountByProjectId() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
  };
}

function createFakeMoneyMovementPort(): MoneyMovementPort & { calls: CreateMoneyMovementInput[] } {
  const calls: CreateMoneyMovementInput[] = [];
  return {
    calls,
    async record(input) {
      calls.push(input);
      const movement: MoneyMovement = {
        id: `movement-${calls.length}`,
        withdrawalDestinationAllocationId: input.withdrawalDestinationAllocationId ?? null,
        availableBalanceSpendId: input.availableBalanceSpendId ?? null,
        sourceProjectId: input.sourceProjectId,
        destinationProjectId: input.destinationProjectId,
        destinationInvestmentTransactionId: input.destinationInvestmentTransactionId,
        amount: input.amount,
        createdAt: new Date().toISOString(),
      };
      return movement;
    },
    async listByDestinationProjectId() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
    async findByDestinationInvestmentTransactionId() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
    async findByWithdrawalDestinationAllocationId() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
    async findByAvailableBalanceSpendId() {
      throw new Error("not exercised by spendAvailableBalanceToProject");
    },
  };
}

describe("spendAvailableBalanceToProject (Story 4.9, FR29, AD-6)", () => {
  it("builds the snapshot via buildTransactionSnapshot, records the investment transaction, and links a money movement via availableBalanceSpendId (AC2's worked example)", async () => {
    const investmentTransactions = createFakeInvestmentTransactionPort();
    const moneyMovements = createFakeMoneyMovementPort();
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partnerShares = [makePartner({ partnerId: "partner-2", sharePercent: "100" as Percent })];

    const result = await spendAvailableBalanceToProject(
      "spend-1",
      "project-1",
      "project-2",
      requirement,
      partnerShares,
      {},
      "partner",
      "partner-2",
      "30000" as Money,
      "idem-1:spend",
      "actor-1",
      { investmentTransactions, moneyMovements },
    );

    expect(investmentTransactions.calls).toHaveLength(1);
    const call = investmentTransactions.calls[0];
    expect(call?.requirementId).toBe("req-2");
    expect(call?.projectId).toBe("project-2");
    expect(call?.partyType).toBe("partner");
    expect(call?.shareId).toBe("partner-2");
    expect(call?.amount).toBe("30000");
    // buildTransactionSnapshot's own live computation -- never a client-
    // supplied value: 100% share of a ₹10,00,000 requirement is ₹10,00,000
    // Should Pay, snapshotted exactly as a manual Add Money entry would get.
    expect(call?.sharePercentSnapshot).toBe("100");
    expect(call?.shouldPaySnapshot).toBe("1000000");
    expect(call?.idempotencyKey).toBe("idem-1:spend");
    expect(call?.actorUserId).toBe("actor-1");
    expect(call?.referenceNumber).toBeNull();
    expect(call?.notes).toBeNull();
    expect(call?.transactionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(moneyMovements.calls).toHaveLength(1);
    const movementCall = moneyMovements.calls[0];
    expect(movementCall).toEqual({
      withdrawalDestinationAllocationId: null,
      availableBalanceSpendId: "spend-1",
      sourceProjectId: "project-1",
      destinationProjectId: "project-2",
      destinationInvestmentTransactionId: result.investmentTransaction.id,
      amount: "30000",
    });

    expect(result.investmentTransaction.id).toBe(result.moneyMovement.destinationInvestmentTransactionId);
    expect(result.moneyMovement.availableBalanceSpendId).toBe("spend-1");
    expect(result.moneyMovement.withdrawalDestinationAllocationId).toBeNull();
  });

  it("resolves a sub_partner target via buildTransactionSnapshot exactly as a manual Add Money entry would", async () => {
    const investmentTransactions = createFakeInvestmentTransactionPort();
    const moneyMovements = createFakeMoneyMovementPort();
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partnerShares = [makePartner({ partnerId: "partner-2", sharePercent: "100" as Percent })];
    const subPartnerSharesByPartnerId: Record<string, SubPartnerShare[]> = {
      "partner-2": [
        {
          id: "sub-row-1",
          subPartnerId: "sub-2",
          partnerId: "partner-2",
          projectId: "project-2",
          name: "Sub B",
          sharePercent: "25" as Percent,
          userId: null,
          effectiveFrom: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
    };

    await spendAvailableBalanceToProject(
      "spend-2",
      "project-1",
      "project-2",
      requirement,
      partnerShares,
      subPartnerSharesByPartnerId,
      "sub_partner",
      "sub-2",
      "10000" as Money,
      "idem-2:spend",
      "actor-1",
      { investmentTransactions, moneyMovements },
    );

    const call = investmentTransactions.calls[0];
    expect(call?.partyType).toBe("sub_partner");
    expect(call?.shareId).toBe("sub-2");
    expect(call?.sharePercentSnapshot).toBe("25");
    expect(call?.shouldPaySnapshot).toBe("250000");
  });

  it("lets ShareNotFoundError propagate unchanged when targetShareId doesn't resolve, without calling either port", async () => {
    const investmentTransactions = createFakeInvestmentTransactionPort();
    const moneyMovements = createFakeMoneyMovementPort();
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partnerShares = [makePartner({ partnerId: "partner-2" })];

    await expect(
      spendAvailableBalanceToProject(
        "spend-3",
        "project-1",
        "project-2",
        requirement,
        partnerShares,
        {},
        "partner",
        "no-such-partner",
        "10000" as Money,
        "idem-3:spend",
        "actor-1",
        { investmentTransactions, moneyMovements },
      ),
    ).rejects.toBeInstanceOf(ShareNotFoundError);

    expect(investmentTransactions.calls).toHaveLength(0);
    expect(moneyMovements.calls).toHaveLength(0);
  });

  it("lets computeShouldPay's SharesNotFullyAllocatedError propagate unchanged", async () => {
    const investmentTransactions = createFakeInvestmentTransactionPort();
    const moneyMovements = createFakeMoneyMovementPort();
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partnerShares = [makePartner({ partnerId: "partner-2", sharePercent: "60" as Percent })];

    await expect(
      spendAvailableBalanceToProject(
        "spend-4",
        "project-1",
        "project-2",
        requirement,
        partnerShares,
        {},
        "partner",
        "partner-2",
        "10000" as Money,
        "idem-4:spend",
        "actor-1",
        { investmentTransactions, moneyMovements },
      ),
    ).rejects.toBeInstanceOf(SharesNotFullyAllocatedError);

    expect(investmentTransactions.calls).toHaveLength(0);
    expect(moneyMovements.calls).toHaveLength(0);
  });

  it("lets computeShouldPay's SubPartnerSharesOverAllocatedError propagate unchanged", async () => {
    const investmentTransactions = createFakeInvestmentTransactionPort();
    const moneyMovements = createFakeMoneyMovementPort();
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partnerShares = [makePartner({ partnerId: "partner-2", sharePercent: "100" as Percent })];
    const subPartnerSharesByPartnerId: Record<string, SubPartnerShare[]> = {
      "partner-2": [
        {
          id: "sub-row-1",
          subPartnerId: "sub-2",
          partnerId: "partner-2",
          projectId: "project-2",
          name: "Sub B",
          sharePercent: "60" as Percent,
          userId: null,
          effectiveFrom: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          id: "sub-row-2",
          subPartnerId: "sub-3",
          partnerId: "partner-2",
          projectId: "project-2",
          name: "Sub C",
          sharePercent: "60" as Percent,
          userId: null,
          effectiveFrom: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
    };

    await expect(
      spendAvailableBalanceToProject(
        "spend-5",
        "project-1",
        "project-2",
        requirement,
        partnerShares,
        subPartnerSharesByPartnerId,
        "partner",
        "partner-2",
        "10000" as Money,
        "idem-5:spend",
        "actor-1",
        { investmentTransactions, moneyMovements },
      ),
    ).rejects.toBeInstanceOf(SubPartnerSharesOverAllocatedError);

    expect(investmentTransactions.calls).toHaveLength(0);
    expect(moneyMovements.calls).toHaveLength(0);
  });
});

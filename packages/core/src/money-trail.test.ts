import { describe, it, expect } from "vitest";
import type {
  AvailableBalance,
  AvailableBalanceSpend,
  InvestmentTransaction,
  Money,
  MoneyMovement,
  Percent,
  WithdrawalDestinationAllocation,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { assembleMoneyTrail, MoneyTrailEntityNotFoundError, type MoneyTrailDeps } from "./money-trail";

/**
 * Builds the full worked example from spec-4-10's I/O matrix: ₹10,00,000
 * invested into Project A -> ₹5,00,000 withdrawn, split ₹3,00,000 to
 * Project B (a "project" leg), ₹1,00,000 to a Person, ₹1,00,000 to
 * Available Balance -> later ₹30,000 spent from that balance into Project C.
 * Every fake port method below throws if called with an id this fixture
 * never seeded, so an accidental wrong-edge traversal fails loudly rather
 * than silently returning `undefined`/`null`.
 */
function buildWorkedExample(): {
  deps: MoneyTrailDeps;
  originInvestmentTransactionId: string;
  withdrawalTransactionId: string;
  projectLegId: string;
  personLegId: string;
  availableBalanceLegId: string;
  projectBInvestmentTransactionId: string;
  projectBMovementId: string;
  availableBalanceSpendId: string;
  projectCInvestmentTransactionId: string;
  spendMovementId: string;
} {
  const originInvestmentTransactionId = "inv-a-origin";
  const withdrawalTransactionId = "withdrawal-1";
  const projectLegId = "leg-project";
  const personLegId = "leg-person";
  const availableBalanceLegId = "leg-balance";
  const projectBInvestmentTransactionId = "inv-b";
  const projectBMovementId = "movement-1";
  const availableBalanceSpendId = "spend-1";
  const projectCInvestmentTransactionId = "inv-c";
  const spendMovementId = "movement-2";

  const projectAId = "project-a";
  const projectBId = "project-b";
  const projectCId = "project-c";
  const partyType = "partner" as const;
  const shareId = "share-1";

  const originInvestmentTransaction: InvestmentTransaction = {
    id: originInvestmentTransactionId,
    requirementId: "req-a",
    projectId: projectAId,
    partyType,
    shareId,
    sharePercentSnapshot: "100" as Percent,
    shouldPaySnapshot: "1000000" as Money,
    amount: "1000000" as Money,
    transactionDate: "2026-09-01",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
  };

  const withdrawal: WithdrawalTransaction = {
    id: withdrawalTransactionId,
    projectId: projectAId,
    partyType,
    shareId,
    sharePercentSnapshot: "100" as Percent,
    canTakeSnapshot: "1000000" as Money,
    amount: "500000" as Money,
    transactionDate: "2026-09-10",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
  };

  const projectLeg: WithdrawalDestinationAllocation = {
    id: projectLegId,
    withdrawalTransactionId,
    destinationType: "project",
    amount: "300000" as Money,
    destinationProjectId: projectBId,
    personName: null,
    notes: null,
    destinationRequirementId: "req-b",
    destinationShareId: "share-b",
    destinationPartyType: "partner",
    createdAt: new Date().toISOString(),
  };

  const personLeg: WithdrawalDestinationAllocation = {
    id: personLegId,
    withdrawalTransactionId,
    destinationType: "person",
    amount: "100000" as Money,
    destinationProjectId: null,
    personName: "Person X",
    notes: null,
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date().toISOString(),
  };

  const availableBalanceLeg: WithdrawalDestinationAllocation = {
    id: availableBalanceLegId,
    withdrawalTransactionId,
    destinationType: "available_balance",
    amount: "100000" as Money,
    destinationProjectId: null,
    personName: null,
    notes: null,
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date().toISOString(),
  };

  const projectBInvestmentTransaction: InvestmentTransaction = {
    id: projectBInvestmentTransactionId,
    requirementId: "req-b",
    projectId: projectBId,
    partyType: "partner",
    shareId: "share-b",
    sharePercentSnapshot: "100" as Percent,
    shouldPaySnapshot: "300000" as Money,
    amount: "300000" as Money,
    transactionDate: "2026-09-10",
    paymentMode: "other",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
  };

  const projectBMovement: MoneyMovement = {
    id: projectBMovementId,
    withdrawalDestinationAllocationId: projectLegId,
    availableBalanceSpendId: null,
    sourceProjectId: projectAId,
    destinationProjectId: projectBId,
    destinationInvestmentTransactionId: projectBInvestmentTransactionId,
    amount: "300000" as Money,
    createdAt: new Date().toISOString(),
  };

  const availableBalance: AvailableBalance = {
    id: "balance-1",
    projectId: projectAId,
    partyType,
    shareId,
    // Net of the later 30,000 spend below (100,000 credited - 30,000 spent).
    balance: "70000" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  const availableBalanceSpend: AvailableBalanceSpend = {
    id: availableBalanceSpendId,
    sourceProjectId: projectAId,
    partyType,
    shareId,
    destinationType: "project",
    destinationProjectId: projectCId,
    destinationRequirementId: "req-c",
    destinationShareId: "share-c",
    destinationPartyType: "partner",
    personName: null,
    amount: "30000" as Money,
    notes: null,
    createdAt: new Date().toISOString(),
  };

  const projectCInvestmentTransaction: InvestmentTransaction = {
    id: projectCInvestmentTransactionId,
    requirementId: "req-c",
    projectId: projectCId,
    partyType: "partner",
    shareId: "share-c",
    sharePercentSnapshot: "100" as Percent,
    shouldPaySnapshot: "30000" as Money,
    amount: "30000" as Money,
    transactionDate: "2026-09-20",
    paymentMode: "other",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
  };

  const spendMovement: MoneyMovement = {
    id: spendMovementId,
    withdrawalDestinationAllocationId: null,
    availableBalanceSpendId,
    sourceProjectId: projectAId,
    destinationProjectId: projectCId,
    destinationInvestmentTransactionId: projectCInvestmentTransactionId,
    amount: "30000" as Money,
    createdAt: new Date().toISOString(),
  };

  const investmentTransactionsById = new Map<string, InvestmentTransaction>([
    [originInvestmentTransactionId, originInvestmentTransaction],
    [projectBInvestmentTransactionId, projectBInvestmentTransaction],
    [projectCInvestmentTransactionId, projectCInvestmentTransaction],
  ]);
  const withdrawalTransactionsById = new Map<string, WithdrawalTransaction>([
    [withdrawalTransactionId, withdrawal],
  ]);
  const legsById = new Map<string, WithdrawalDestinationAllocation>([
    [projectLegId, projectLeg],
    [personLegId, personLeg],
    [availableBalanceLegId, availableBalanceLeg],
  ]);
  const movementsById = new Map<string, MoneyMovement>([
    [projectBMovementId, projectBMovement],
    [spendMovementId, spendMovement],
  ]);
  const spendsById = new Map<string, AvailableBalanceSpend>([[availableBalanceSpendId, availableBalanceSpend]]);

  const deps: MoneyTrailDeps = {
    investmentTransactions: {
      async findById(id) {
        return investmentTransactionsById.get(id) ?? null;
      },
      async sumActiveAmountByProjectId(projectId) {
        if (projectId === projectAId) return "1000000" as Money;
        throw new Error(`not exercised for projectId ${projectId}`);
      },
    },
    withdrawalTransactions: {
      async findById(id) {
        return withdrawalTransactionsById.get(id) ?? null;
      },
    },
    withdrawalDestinationAllocations: {
      async findById(id) {
        return legsById.get(id) ?? null;
      },
      async listByWithdrawalTransactionId(id) {
        if (id !== withdrawalTransactionId) return [];
        return [projectLeg, personLeg, availableBalanceLeg];
      },
    },
    moneyMovements: {
      async findByDestinationInvestmentTransactionId(investmentTransactionId) {
        return (
          [...movementsById.values()].find(
            (m) => m.destinationInvestmentTransactionId === investmentTransactionId,
          ) ?? null
        );
      },
      async findByWithdrawalDestinationAllocationId(allocationId) {
        return [...movementsById.values()].find((m) => m.withdrawalDestinationAllocationId === allocationId) ?? null;
      },
      async findByAvailableBalanceSpendId(spendId) {
        return [...movementsById.values()].find((m) => m.availableBalanceSpendId === spendId) ?? null;
      },
    },
    availableBalances: {
      async findBalance(partyTypeArg, shareIdArg, projectIdArg) {
        if (partyTypeArg === partyType && shareIdArg === shareId && projectIdArg === projectAId) {
          return availableBalance;
        }
        return null;
      },
    },
    availableBalanceSpends: {
      async findById(id) {
        return spendsById.get(id) ?? null;
      },
    },
  };

  return {
    deps,
    originInvestmentTransactionId,
    withdrawalTransactionId,
    projectLegId,
    personLegId,
    availableBalanceLegId,
    projectBInvestmentTransactionId,
    projectBMovementId,
    availableBalanceSpendId,
    projectCInvestmentTransactionId,
    spendMovementId,
  };
}

describe("assembleMoneyTrail (Story 4.10, FR30)", () => {
  it("viewed from the withdrawal: upstream is the source Project's pool reference, downstream is all 3 legs, the project leg reaches Project B's investment_transaction, the available_balance leg reaches the pool reference (I/O matrix row 1)", async () => {
    const fixture = buildWorkedExample();

    const trail = await assembleMoneyTrail(
      { type: "withdrawal_transaction", id: fixture.withdrawalTransactionId },
      fixture.deps,
    );

    expect(trail.type).toBe("withdrawal_transaction");
    expect(trail.amount).toBe("500000");
    expect(trail.upstream).toHaveLength(1);
    expect(trail.upstream[0]?.type).toBe("project_investment_pool");
    expect(trail.upstream[0]?.upstream).toEqual([]);
    expect(trail.upstream[0]?.downstream).toEqual([]);
    expect((trail.upstream[0]?.data as { totalActiveInvested: Money }).totalActiveInvested).toBe("1000000");

    expect(trail.downstream).toHaveLength(3);
    const projectLegNode = trail.downstream.find((n) => n.id === fixture.projectLegId);
    const personLegNode = trail.downstream.find((n) => n.id === fixture.personLegId);
    const balanceLegNode = trail.downstream.find((n) => n.id === fixture.availableBalanceLegId);
    expect(projectLegNode).toBeDefined();
    expect(personLegNode).toBeDefined();
    expect(balanceLegNode).toBeDefined();

    // The "project" leg's downstream reaches Project B's investment_transaction.
    expect(projectLegNode?.downstream).toHaveLength(1);
    expect(projectLegNode?.downstream[0]?.type).toBe("money_movement");
    const movementNode = projectLegNode?.downstream[0];
    expect(movementNode?.downstream).toHaveLength(1);
    expect(movementNode?.downstream[0]?.type).toBe("investment_transaction");
    expect(movementNode?.downstream[0]?.id).toBe(fixture.projectBInvestmentTransactionId);
    // investment_transaction's own downstream is always [] (spec-4-10's Decisions #4).
    expect(movementNode?.downstream[0]?.downstream).toEqual([]);

    // The "person" leg is a leaf -- no downstream.
    expect(personLegNode?.downstream).toEqual([]);

    // The "available_balance" leg's downstream is the balance pool reference (terminal).
    expect(balanceLegNode?.downstream).toHaveLength(1);
    expect(balanceLegNode?.downstream[0]?.type).toBe("available_balance_pool");
    expect(balanceLegNode?.downstream[0]?.upstream).toEqual([]);
    expect(balanceLegNode?.downstream[0]?.downstream).toEqual([]);
    expect((balanceLegNode?.downstream[0]?.data as { balance: Money }).balance).toBe("70000");
  });

  it("viewed from Project C's investment_transaction: upstream chain reaches money_movement -> available_balance_spend -> available_balance_pool reference (terminal) (I/O matrix row 2)", async () => {
    const fixture = buildWorkedExample();

    const trail = await assembleMoneyTrail(
      { type: "investment_transaction", id: fixture.projectCInvestmentTransactionId },
      fixture.deps,
    );

    expect(trail.type).toBe("investment_transaction");
    expect(trail.downstream).toEqual([]);
    expect(trail.upstream).toHaveLength(1);

    const movementNode = trail.upstream[0];
    expect(movementNode?.type).toBe("money_movement");
    expect(movementNode?.id).toBe(fixture.spendMovementId);
    expect(movementNode?.upstream).toHaveLength(1);

    const spendNode = movementNode?.upstream[0];
    expect(spendNode?.type).toBe("available_balance_spend");
    expect(spendNode?.id).toBe(fixture.availableBalanceSpendId);
    expect(spendNode?.upstream).toHaveLength(1);

    const poolNode = spendNode?.upstream[0];
    expect(poolNode?.type).toBe("available_balance_pool");
    expect(poolNode?.upstream).toEqual([]);
    expect(poolNode?.downstream).toEqual([]);
  });

  it("viewed from the original Project A investment: no upstream (true origin), no downstream (pool-level, not FK-level) (I/O matrix row 3)", async () => {
    const fixture = buildWorkedExample();

    const trail = await assembleMoneyTrail(
      { type: "investment_transaction", id: fixture.originInvestmentTransactionId },
      fixture.deps,
    );

    expect(trail.upstream).toEqual([]);
    expect(trail.downstream).toEqual([]);
  });

  it("a withdrawal with no allocation recorded yet has downstream: [] (a valid state, not an error)", async () => {
    const fixture = buildWorkedExample();
    const depsWithNoLegs: MoneyTrailDeps = {
      ...fixture.deps,
      withdrawalDestinationAllocations: {
        ...fixture.deps.withdrawalDestinationAllocations,
        async listByWithdrawalTransactionId() {
          return [];
        },
      },
    };

    const trail = await assembleMoneyTrail(
      { type: "withdrawal_transaction", id: fixture.withdrawalTransactionId },
      depsWithNoLegs,
    );

    expect(trail.downstream).toEqual([]);
  });

  it("cycle protection: a leg's upstream withdrawal_transaction back-reference is a terminal stub, not re-expanded (never infinite recursion)", async () => {
    const fixture = buildWorkedExample();

    const trail = await assembleMoneyTrail(
      { type: "withdrawal_transaction", id: fixture.withdrawalTransactionId },
      fixture.deps,
    );

    const projectLegNode = trail.downstream.find((n) => n.id === fixture.projectLegId);
    expect(projectLegNode?.upstream).toHaveLength(1);
    const backReference = projectLegNode?.upstream[0];
    // Same withdrawal_transaction node the trail started from...
    expect(backReference?.type).toBe("withdrawal_transaction");
    expect(backReference?.id).toBe(fixture.withdrawalTransactionId);
    expect(backReference?.amount).toBe(trail.amount);
    // ...but NOT re-expanded -- already on the current path when reached the
    // second time, so this codepath returns a terminal leaf instead of
    // recursing back into the same 3 legs forever.
    expect(backReference?.upstream).toEqual([]);
    expect(backReference?.downstream).toEqual([]);
  });

  it("cycle protection, full sibling check: starting from one leg of a 3-leg withdrawal, the back-referenced withdrawal's OTHER legs are fully expanded (not hidden/collapsed), only the starting leg itself is a stub", async () => {
    const fixture = buildWorkedExample();

    // Start directly from the "project" leg -- the exact scenario the
    // review asked to verify by hand: walking backward to the withdrawal
    // and confirming sibling legs aren't hidden by cycle protection.
    const trail = await assembleMoneyTrail(
      { type: "withdrawal_destination_allocation", id: fixture.projectLegId },
      fixture.deps,
    );

    expect(trail.upstream).toHaveLength(1);
    const withdrawalNode = trail.upstream[0];
    expect(withdrawalNode?.type).toBe("withdrawal_transaction");
    expect(withdrawalNode?.id).toBe(fixture.withdrawalTransactionId);
    expect(withdrawalNode?.downstream).toHaveLength(3);

    const startingLegStub = withdrawalNode?.downstream.find((n) => n.id === fixture.projectLegId);
    const personLegSibling = withdrawalNode?.downstream.find((n) => n.id === fixture.personLegId);
    const balanceLegSibling = withdrawalNode?.downstream.find((n) => n.id === fixture.availableBalanceLegId);
    expect(startingLegStub).toBeDefined();
    expect(personLegSibling).toBeDefined();
    expect(balanceLegSibling).toBeDefined();

    // The starting leg, reached a second time via the back-reference, is a
    // terminal stub -- already on the current path.
    expect(startingLegStub?.upstream).toEqual([]);
    expect(startingLegStub?.downstream).toEqual([]);

    // Its two SIBLINGS are NOT collapsed by the same cycle guard -- they were
    // never on the current path, so they're fully expanded with their real
    // edges, exactly like the "viewed from the withdrawal" test's shape.
    expect(personLegSibling?.downstream).toEqual([]);
    expect(balanceLegSibling?.downstream).toHaveLength(1);
    expect(balanceLegSibling?.downstream[0]?.type).toBe("available_balance_pool");
    expect(balanceLegSibling?.downstream[0]?.upstream).toEqual([]);
    expect(balanceLegSibling?.downstream[0]?.downstream).toEqual([]);
  });

  it("an 'other' leg resolves as a leaf (downstream: []), same as a 'person' leg", async () => {
    const fixture = buildWorkedExample();
    const otherLegId = "leg-other";
    const otherLeg: WithdrawalDestinationAllocation = {
      id: otherLegId,
      withdrawalTransactionId: fixture.withdrawalTransactionId,
      destinationType: "other",
      amount: "5000" as Money,
      destinationProjectId: null,
      personName: null,
      notes: "Held as cash",
      destinationRequirementId: null,
      destinationShareId: null,
      destinationPartyType: null,
      createdAt: new Date().toISOString(),
    };
    const depsWithOtherLeg: MoneyTrailDeps = {
      ...fixture.deps,
      withdrawalDestinationAllocations: {
        ...fixture.deps.withdrawalDestinationAllocations,
        async findById(id) {
          if (id === otherLegId) return otherLeg;
          return fixture.deps.withdrawalDestinationAllocations.findById(id);
        },
      },
    };

    const trail = await assembleMoneyTrail(
      { type: "withdrawal_destination_allocation", id: otherLegId },
      depsWithOtherLeg,
    );

    expect(trail.type).toBe("withdrawal_destination_allocation");
    expect(trail.upstream).toHaveLength(1);
    expect(trail.upstream[0]?.type).toBe("withdrawal_transaction");
    // Same leaf shape as a "person" leg -- no downstream edge exists for
    // "other" either (`buildWithdrawalDestinationAllocationNode`'s
    // fallthrough).
    expect(trail.downstream).toEqual([]);
  });

  it("available_balance_pool falls back to \"0\" when the (partyType, shareId, projectId) key was never credited -- never crashes, never returns something else", async () => {
    const fixture = buildWorkedExample();
    const depsWithNoCredit: MoneyTrailDeps = {
      ...fixture.deps,
      availableBalances: {
        async findBalance() {
          return null;
        },
      },
    };

    const trail = await assembleMoneyTrail(
      { type: "withdrawal_destination_allocation", id: fixture.availableBalanceLegId },
      depsWithNoCredit,
    );

    expect(trail.downstream).toHaveLength(1);
    const poolNode = trail.downstream[0];
    expect(poolNode?.type).toBe("available_balance_pool");
    expect(poolNode?.amount).toBe("0");
    expect((poolNode?.data as { balance: Money }).balance).toBe("0");
    expect(poolNode?.upstream).toEqual([]);
    expect(poolNode?.downstream).toEqual([]);
  });

  it("throws MoneyTrailEntityNotFoundError for a well-formed but nonexistent starting id", async () => {
    const fixture = buildWorkedExample();

    await expect(
      assembleMoneyTrail({ type: "withdrawal_transaction", id: "does-not-exist" }, fixture.deps),
    ).rejects.toBeInstanceOf(MoneyTrailEntityNotFoundError);
    await expect(
      assembleMoneyTrail({ type: "investment_transaction", id: "does-not-exist" }, fixture.deps),
    ).rejects.toBeInstanceOf(MoneyTrailEntityNotFoundError);
    await expect(
      assembleMoneyTrail({ type: "withdrawal_destination_allocation", id: "does-not-exist" }, fixture.deps),
    ).rejects.toBeInstanceOf(MoneyTrailEntityNotFoundError);
    await expect(
      assembleMoneyTrail({ type: "available_balance_spend", id: "does-not-exist" }, fixture.deps),
    ).rejects.toBeInstanceOf(MoneyTrailEntityNotFoundError);
  });

  it("throws MoneyTrailEntityNotFoundError for the 3 non-startable types (money_movement, both pool-reference types) -- never a valid trail starting point", async () => {
    const fixture = buildWorkedExample();

    await expect(
      assembleMoneyTrail({ type: "money_movement", id: fixture.projectBMovementId }, fixture.deps),
    ).rejects.toBeInstanceOf(MoneyTrailEntityNotFoundError);
    await expect(
      assembleMoneyTrail({ type: "project_investment_pool", id: "project-a" }, fixture.deps),
    ).rejects.toBeInstanceOf(MoneyTrailEntityNotFoundError);
    await expect(
      assembleMoneyTrail({ type: "available_balance_pool", id: "partner:share-1:project-a" }, fixture.deps),
    ).rejects.toBeInstanceOf(MoneyTrailEntityNotFoundError);
  });

  it("viewed from the 'project' destination-allocation leg directly: upstream is the withdrawal, downstream is the linked money movement", async () => {
    const fixture = buildWorkedExample();

    const trail = await assembleMoneyTrail({ type: "withdrawal_destination_allocation", id: fixture.projectLegId }, fixture.deps);

    expect(trail.upstream).toHaveLength(1);
    expect(trail.upstream[0]?.type).toBe("withdrawal_transaction");
    expect(trail.upstream[0]?.id).toBe(fixture.withdrawalTransactionId);
    expect(trail.downstream).toHaveLength(1);
    expect(trail.downstream[0]?.type).toBe("money_movement");
    expect(trail.downstream[0]?.id).toBe(fixture.projectBMovementId);
  });

  it("viewed from the available_balance_spend directly: upstream is the balance pool reference, downstream is the linked money movement", async () => {
    const fixture = buildWorkedExample();

    const trail = await assembleMoneyTrail(
      { type: "available_balance_spend", id: fixture.availableBalanceSpendId },
      fixture.deps,
    );

    expect(trail.upstream).toHaveLength(1);
    expect(trail.upstream[0]?.type).toBe("available_balance_pool");
    expect(trail.downstream).toHaveLength(1);
    expect(trail.downstream[0]?.type).toBe("money_movement");
    expect(trail.downstream[0]?.id).toBe(fixture.spendMovementId);
  });
});

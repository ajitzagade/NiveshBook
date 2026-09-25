import { describe, it, expect } from "vitest";
import type {
  AvailableBalance,
  InvestmentTransaction,
  Money,
  MoneyMovement,
  WithdrawalDestinationAllocation,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { cancelWithdrawalBundle, type CancelWithdrawalBundleDeps } from "./cancel-withdrawal-bundle";
import type { CancelInvestmentTransactionInput, InvestmentTransactionPort } from "./investment-transaction-port";
import { AlreadyCancelledError } from "./investment-transaction";
import type { CreditOrDebitAvailableBalanceInput, AvailableBalancePort } from "./available-balance-port";
import { assertSufficientBalance, InsufficientAvailableBalanceError } from "./available-balance";
import type { MoneyMovementPort } from "./money-movement-port";

function makeWithdrawal(overrides: Partial<WithdrawalTransaction> = {}): WithdrawalTransaction {
  return {
    id: "wtx-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "50" as WithdrawalTransaction["sharePercentSnapshot"],
    canTakeSnapshot: "250000" as Money,
    amount: "250000" as Money,
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLeg(overrides: Partial<WithdrawalDestinationAllocation> = {}): WithdrawalDestinationAllocation {
  return {
    id: "leg-1",
    withdrawalTransactionId: "wtx-1",
    destinationType: "other",
    amount: "1000" as Money,
    destinationProjectId: null,
    personName: null,
    notes: "Kept as cash",
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMovement(overrides: Partial<MoneyMovement> = {}): MoneyMovement {
  return {
    id: "movement-1",
    withdrawalDestinationAllocationId: "leg-1",
    availableBalanceSpendId: null,
    sourceProjectId: "project-1",
    destinationProjectId: "project-2",
    destinationInvestmentTransactionId: "tx-1",
    amount: "150000" as Money,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** `MoneyMovementPort.findByWithdrawalDestinationAllocationId`-only fake -- mirrors `move-withdrawal-to-project.test.ts`'s narrow-fake precedent, but for the READ side this orchestration needs. */
function createFakeMoneyMovements(
  movementsByLegId: Record<string, MoneyMovement | undefined>,
): Pick<MoneyMovementPort, "findByWithdrawalDestinationAllocationId"> {
  return {
    async findByWithdrawalDestinationAllocationId(allocationId) {
      return movementsByLegId[allocationId] ?? null;
    },
  };
}

/**
 * An `InvestmentTransactionPort.cancelTransaction`-only fake -- mirrors
 * `investment-transaction.test.ts`'s `createFakeInvestmentTransactionPort`
 * shape, narrowed to just the one method `cancelWithdrawalBundle` calls
 * (ISP -- proving this orchestration never reaches for anything wider than
 * its own `Pick<>`-narrowed `CancelWithdrawalBundleDeps`).
 */
function createFakeCancellableInvestmentTransactions(
  rows: Record<string, InvestmentTransaction>,
): Pick<InvestmentTransactionPort, "cancelTransaction"> & { calls: CancelInvestmentTransactionInput[] } {
  const calls: CancelInvestmentTransactionInput[] = [];
  return {
    calls,
    async cancelTransaction(input) {
      calls.push(input);
      const existing = rows[input.transactionId];
      if (!existing) {
        throw new Error(`No fake row for transactionId ${input.transactionId}`);
      }
      if (existing.status === "cancelled") {
        throw new AlreadyCancelledError();
      }
      const updatedOriginal: InvestmentTransaction = { ...existing, status: "cancelled" };
      rows[input.transactionId] = updatedOriginal;
      const reversal: InvestmentTransaction = {
        ...existing,
        id: `${existing.id}-reversal`,
        status: "cancelled",
        reversalOfTransactionId: updatedOriginal.id,
      };
      return { originalTransaction: updatedOriginal, reversalTransaction: reversal, cancelled: true };
    },
  };
}

/**
 * An `AvailableBalancePort.debitBalance`-only fake -- backed by a single
 * mutable balance, enforcing the identical `assertSufficientBalance` guard
 * `packages/db`'s real `debitBalance` does (AD-10), so this test file can
 * genuinely exercise `InsufficientAvailableBalanceError` propagation without
 * needing live Postgres -- that atomicity/row-lock mechanics themselves are
 * `packages/db`'s own job, verified there.
 */
function createFakeAvailableBalances(
  initialBalance: Money,
): Pick<AvailableBalancePort, "debitBalance"> & { calls: CreditOrDebitAvailableBalanceInput[]; balance: Money } {
  const calls: CreditOrDebitAvailableBalanceInput[] = [];
  let balance = initialBalance;
  return {
    calls,
    get balance() {
      return balance;
    },
    async debitBalance(input) {
      calls.push(input);
      assertSufficientBalance(balance, input.amount);
      const wholeMinusFraction = (Number(balance) - Number(input.amount)).toFixed(2);
      balance = wholeMinusFraction as Money;
      const row: AvailableBalance = {
        id: "balance-1",
        projectId: input.projectId,
        partyType: input.partyType,
        shareId: input.shareId,
        balance,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      return row;
    },
  };
}

describe("cancelWithdrawalBundle — Story 4.11", () => {
  it("returns an empty result and calls nothing for a withdrawal with no legs at all", async () => {
    const investmentTransactions = createFakeCancellableInvestmentTransactions({});
    const availableBalances = createFakeAvailableBalances("0" as Money);
    const moneyMovements = createFakeMoneyMovements({});
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };

    const result = await cancelWithdrawalBundle(makeWithdrawal(), [], "idem-1", "actor-1", deps);

    expect(result.cancelledInvestmentTransactionIds).toEqual([]);
    expect(investmentTransactions.calls).toHaveLength(0);
    expect(availableBalances.calls).toHaveLength(0);
  });

  it("'person'/'other' legs are no-ops -- neither port is called", async () => {
    const investmentTransactions = createFakeCancellableInvestmentTransactions({});
    const availableBalances = createFakeAvailableBalances("0" as Money);
    const moneyMovements = createFakeMoneyMovements({});
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };
    const legs = [
      makeLeg({ id: "leg-person", destinationType: "person", personName: "Person X" }),
      makeLeg({ id: "leg-other", destinationType: "other", notes: "misc" }),
    ];

    const result = await cancelWithdrawalBundle(makeWithdrawal(), legs, "idem-1", "actor-1", deps);

    expect(result.cancelledInvestmentTransactionIds).toEqual([]);
    expect(investmentTransactions.calls).toHaveLength(0);
    expect(availableBalances.calls).toHaveLength(0);
  });

  it("a 'project' leg cancels its linked destination investment_transactions row via a derived idempotency key", async () => {
    const destinationTx: InvestmentTransaction = {
      id: "dest-tx-1",
      requirementId: "req-1",
      projectId: "project-2",
      partyType: "partner",
      shareId: "partner-2",
      sharePercentSnapshot: "100" as InvestmentTransaction["sharePercentSnapshot"],
      shouldPaySnapshot: "150000" as Money,
      amount: "150000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "other",
      referenceNumber: null,
      notes: null,
      status: "active",
      reversalOfTransactionId: null,
      createdAt: new Date().toISOString(),
    };
    const investmentTransactions = createFakeCancellableInvestmentTransactions({ "dest-tx-1": destinationTx });
    const availableBalances = createFakeAvailableBalances("0" as Money);
    const movement = makeMovement({ id: "movement-1", destinationInvestmentTransactionId: "dest-tx-1" });
    const moneyMovements = createFakeMoneyMovements({ "leg-project": movement });
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };
    const legs = [
      makeLeg({ id: "leg-project", destinationType: "project", destinationProjectId: "project-2", amount: "150000" as Money }),
    ];

    const result = await cancelWithdrawalBundle(makeWithdrawal(), legs, "idem-cancel", "actor-1", deps);

    expect(result.cancelledInvestmentTransactionIds).toEqual(["dest-tx-1"]);
    expect(investmentTransactions.calls).toHaveLength(1);
    expect(investmentTransactions.calls[0]?.transactionId).toBe("dest-tx-1");
    expect(investmentTransactions.calls[0]?.idempotencyKey).toBe("idem-cancel:cancel-cascade:0");
    expect(investmentTransactions.calls[0]?.actorUserId).toBe("actor-1");
  });

  it("a 'project' leg with no linked money_movements row is silently skipped (defense in depth)", async () => {
    const investmentTransactions = createFakeCancellableInvestmentTransactions({});
    const availableBalances = createFakeAvailableBalances("0" as Money);
    const moneyMovements = createFakeMoneyMovements({});
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };
    const legs = [makeLeg({ id: "leg-project", destinationType: "project", destinationProjectId: "project-2" })];

    const result = await cancelWithdrawalBundle(makeWithdrawal(), legs, "idem-1", "actor-1", deps);

    expect(result.cancelledInvestmentTransactionIds).toEqual([]);
    expect(investmentTransactions.calls).toHaveLength(0);
  });

  it("an 'available_balance' leg debits the pool for the withdrawal's own (partyType, shareId) at its own source Project", async () => {
    const investmentTransactions = createFakeCancellableInvestmentTransactions({});
    const availableBalances = createFakeAvailableBalances("100000" as Money);
    const moneyMovements = createFakeMoneyMovements({});
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };
    const withdrawal = makeWithdrawal({ projectId: "project-1", partyType: "partner", shareId: "partner-1" });
    const legs = [makeLeg({ id: "leg-balance", destinationType: "available_balance", amount: "50000" as Money })];

    const result = await cancelWithdrawalBundle(withdrawal, legs, "idem-1", "actor-1", deps);

    expect(result.cancelledInvestmentTransactionIds).toEqual([]);
    expect(availableBalances.calls).toHaveLength(1);
    expect(availableBalances.calls[0]).toEqual({
      projectId: "project-1",
      partyType: "partner",
      shareId: "partner-1",
      amount: "50000",
    });
    expect(availableBalances.balance).toBe("50000.00");
  });

  it("lets InsufficientAvailableBalanceError propagate uncaught when the pool was already partly spent elsewhere (this story's Decisions #2)", async () => {
    const investmentTransactions = createFakeCancellableInvestmentTransactions({});
    // Only ₹20,000 left in the pool -- less than the ₹50,000 this leg
    // originally credited, simulating "already spent onward" (Story 4.9).
    const availableBalances = createFakeAvailableBalances("20000" as Money);
    const moneyMovements = createFakeMoneyMovements({});
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };
    const legs = [makeLeg({ id: "leg-balance", destinationType: "available_balance", amount: "50000" as Money })];

    await expect(
      cancelWithdrawalBundle(makeWithdrawal(), legs, "idem-1", "actor-1", deps),
    ).rejects.toThrow(InsufficientAvailableBalanceError);
    // Never partially applied -- the pool's balance is untouched by the
    // failed attempt (this fake mirrors the real `debitBalance`'s
    // check-before-write ordering).
    expect(availableBalances.balance).toBe("20000");
  });

  it("an earlier 'project' leg's cancel is never retried or undone when a LATER 'available_balance' leg throws (mixed-legs error-propagation order)", async () => {
    const destinationTx: InvestmentTransaction = {
      id: "dest-tx-1",
      requirementId: "req-1",
      projectId: "project-2",
      partyType: "partner",
      shareId: "partner-2",
      sharePercentSnapshot: "100" as InvestmentTransaction["sharePercentSnapshot"],
      shouldPaySnapshot: "150000" as Money,
      amount: "150000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "other",
      referenceNumber: null,
      notes: null,
      status: "active",
      reversalOfTransactionId: null,
      createdAt: new Date().toISOString(),
    };
    const investmentTransactions = createFakeCancellableInvestmentTransactions({ "dest-tx-1": destinationTx });
    // Only ₹20,000 left -- less than the ₹50,000 the available_balance leg
    // (processed second) originally credited.
    const availableBalances = createFakeAvailableBalances("20000" as Money);
    const movement = makeMovement({ id: "movement-1", destinationInvestmentTransactionId: "dest-tx-1" });
    const moneyMovements = createFakeMoneyMovements({ "leg-project": movement });
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };
    const legs = [
      makeLeg({ id: "leg-project", destinationType: "project", destinationProjectId: "project-2", amount: "150000" as Money }),
      makeLeg({ id: "leg-balance", destinationType: "available_balance", amount: "50000" as Money }),
    ];

    await expect(
      cancelWithdrawalBundle(makeWithdrawal(), legs, "idem-1", "actor-1", deps),
    ).rejects.toThrow(InsufficientAvailableBalanceError);

    // The project leg's cancel already succeeded (it's processed first,
    // sequentially) -- this orchestration's `for` loop does nothing to
    // "undo" it or retry it once the later leg throws; the caller
    // (`packages/db`'s `cancelTransaction`, running this inside one open DB
    // transaction) is what rolls the whole thing back at the SQL layer, not
    // this pure function. Exactly one call, never a second attempt.
    expect(investmentTransactions.calls).toHaveLength(1);
    expect(investmentTransactions.calls[0]?.transactionId).toBe("dest-tx-1");
  });

  it("lets the investment-side AlreadyCancelledError propagate uncaught when a 'project' leg's destination row was somehow already independently cancelled", async () => {
    const alreadyCancelledDestinationTx: InvestmentTransaction = {
      id: "dest-tx-1",
      requirementId: "req-1",
      projectId: "project-2",
      partyType: "partner",
      shareId: "partner-2",
      sharePercentSnapshot: "100" as InvestmentTransaction["sharePercentSnapshot"],
      shouldPaySnapshot: "150000" as Money,
      amount: "150000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "other",
      referenceNumber: null,
      notes: null,
      status: "cancelled",
      reversalOfTransactionId: null,
      createdAt: new Date().toISOString(),
    };
    const investmentTransactions = createFakeCancellableInvestmentTransactions({
      "dest-tx-1": alreadyCancelledDestinationTx,
    });
    const availableBalances = createFakeAvailableBalances("0" as Money);
    const movement = makeMovement({ id: "movement-1", destinationInvestmentTransactionId: "dest-tx-1" });
    const moneyMovements = createFakeMoneyMovements({ "leg-project": movement });
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };
    const legs = [
      makeLeg({ id: "leg-project", destinationType: "project", destinationProjectId: "project-2", amount: "150000" as Money }),
    ];

    await expect(
      cancelWithdrawalBundle(makeWithdrawal(), legs, "idem-1", "actor-1", deps),
    ).rejects.toThrow(AlreadyCancelledError);
    expect(investmentTransactions.calls).toHaveLength(1);
  });

  it("processes every leg type together, sequentially, deriving each 'project' leg's cancel idempotency key from its own index", async () => {
    const destTxA: InvestmentTransaction = {
      id: "dest-tx-a",
      requirementId: "req-a",
      projectId: "project-2",
      partyType: "partner",
      shareId: "partner-2",
      sharePercentSnapshot: "100" as InvestmentTransaction["sharePercentSnapshot"],
      shouldPaySnapshot: "100000" as Money,
      amount: "100000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "other",
      referenceNumber: null,
      notes: null,
      status: "active",
      reversalOfTransactionId: null,
      createdAt: new Date().toISOString(),
    };
    const destTxB: InvestmentTransaction = { ...destTxA, id: "dest-tx-b", amount: "50000" as Money };
    const investmentTransactions = createFakeCancellableInvestmentTransactions({
      "dest-tx-a": destTxA,
      "dest-tx-b": destTxB,
    });
    const availableBalances = createFakeAvailableBalances("30000" as Money);
    const moneyMovements = createFakeMoneyMovements({
      "leg-project-a": makeMovement({ id: "movement-a", destinationInvestmentTransactionId: "dest-tx-a" }),
      "leg-project-b": makeMovement({ id: "movement-b", destinationInvestmentTransactionId: "dest-tx-b" }),
    });
    const deps: CancelWithdrawalBundleDeps = { investmentTransactions, availableBalances, moneyMovements };
    const legs = [
      makeLeg({ id: "leg-project-a", destinationType: "project", amount: "100000" as Money }),
      makeLeg({ id: "leg-person", destinationType: "person", personName: "Person X" }),
      makeLeg({ id: "leg-balance", destinationType: "available_balance", amount: "30000" as Money }),
      makeLeg({ id: "leg-project-b", destinationType: "project", amount: "50000" as Money }),
    ];

    const result = await cancelWithdrawalBundle(makeWithdrawal(), legs, "idem-multi", "actor-1", deps);

    expect(result.cancelledInvestmentTransactionIds).toEqual(["dest-tx-a", "dest-tx-b"]);
    expect(investmentTransactions.calls.map((c) => c.idempotencyKey)).toEqual([
      "idem-multi:cancel-cascade:0",
      "idem-multi:cancel-cascade:3",
    ]);
    expect(availableBalances.calls).toHaveLength(1);
    expect(availableBalances.balance).toBe("0.00");
  });
});

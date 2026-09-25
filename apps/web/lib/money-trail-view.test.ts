import { describe, it, expect } from "vitest";
import type {
  InvestmentTransaction,
  Money,
  MoneyMovement,
  MoneyTrailNode,
  Percent,
  WithdrawalDestinationAllocation,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { describeTrailNode, flattenTrail } from "./money-trail-view";

const NOW = new Date().toISOString();

function investmentTransactionRow(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "inv-1",
    requirementId: "req-1",
    projectId: "project-b",
    partyType: "partner",
    shareId: "share-1",
    sharePercentSnapshot: "100" as Percent,
    shouldPaySnapshot: "100000" as Money,
    amount: "100000" as Money,
    transactionDate: "2026-09-10",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: NOW,
    ...overrides,
  };
}

function withdrawalTransactionRow(overrides: Partial<WithdrawalTransaction> = {}): WithdrawalTransaction {
  return {
    id: "wd-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "share-1",
    sharePercentSnapshot: "100" as Percent,
    canTakeSnapshot: "500000" as Money,
    amount: "500000" as Money,
    transactionDate: "2026-09-05",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: NOW,
    ...overrides,
  };
}

function allocationLegRow(
  overrides: Partial<WithdrawalDestinationAllocation> = {},
): WithdrawalDestinationAllocation {
  return {
    id: "leg-1",
    withdrawalTransactionId: "wd-1",
    destinationType: "project",
    amount: "100000" as Money,
    destinationProjectId: "project-b",
    personName: null,
    notes: null,
    destinationRequirementId: "req-1",
    destinationShareId: "share-1",
    destinationPartyType: "partner",
    createdAt: NOW,
    ...overrides,
  };
}

function moneyMovementRow(overrides: Partial<MoneyMovement> = {}): MoneyMovement {
  return {
    id: "mv-1",
    withdrawalDestinationAllocationId: "leg-1",
    availableBalanceSpendId: null,
    sourceProjectId: "project-a",
    destinationProjectId: "project-b",
    destinationInvestmentTransactionId: "inv-1",
    amount: "100000" as Money,
    createdAt: NOW,
    ...overrides,
  };
}

/**
 * Builds the exact shape `assembleMoneyTrail()` produces when tracing from a
 * single `"project"`-destination `withdrawal_destination_allocation` leg
 * whose withdrawal has already been reinvested downstream, one Project over
 * -- i.e. the shape that exposed Review Triage Log row 1's `flattenTrail()`
 * bug. Faithfully includes the cycle-protection STUBS
 * `assembleMoneyTrail()` genuinely produces (same `(type, id)` key as a real
 * node elsewhere in the tree, but `upstream: []`/`downstream: []`) in every
 * place the real algorithm would produce one -- the leg re-appears (stubbed)
 * in its parent withdrawal's `downstream` (every leg is listed, including
 * the one the trail started from) and in the money movement's own `upstream`
 * (the movement's source leg, re-walked).
 */
function buildLegStartedTrail(): MoneyTrailNode {
  const legRow = allocationLegRow();
  const withdrawalRow = withdrawalTransactionRow();
  const movementRow = moneyMovementRow();
  const reinvestmentRow = investmentTransactionRow();

  const legStubViaParentDownstream: MoneyTrailNode = {
    type: "withdrawal_destination_allocation",
    id: legRow.id,
    amount: legRow.amount,
    data: legRow,
    upstream: [],
    downstream: [],
  };

  const pool: MoneyTrailNode = {
    type: "project_investment_pool",
    id: withdrawalRow.projectId,
    amount: "1000000" as Money,
    data: { projectId: withdrawalRow.projectId, totalActiveInvested: "1000000" as Money },
    upstream: [],
    downstream: [],
  };

  const withdrawal: MoneyTrailNode = {
    type: "withdrawal_transaction",
    id: withdrawalRow.id,
    amount: withdrawalRow.amount,
    data: withdrawalRow,
    upstream: [pool],
    downstream: [legStubViaParentDownstream],
  };

  const legStubViaMovementUpstream: MoneyTrailNode = {
    type: "withdrawal_destination_allocation",
    id: legRow.id,
    amount: legRow.amount,
    data: legRow,
    upstream: [],
    downstream: [],
  };

  const reinvestment: MoneyTrailNode = {
    type: "investment_transaction",
    id: reinvestmentRow.id,
    amount: reinvestmentRow.amount,
    data: reinvestmentRow,
    upstream: [], // filled in below once `movement` exists
    downstream: [],
  };

  const movement: MoneyTrailNode = {
    type: "money_movement",
    id: movementRow.id,
    amount: movementRow.amount,
    data: movementRow,
    upstream: [legStubViaMovementUpstream],
    downstream: [reinvestment],
  };
  reinvestment.upstream = [
    { type: "money_movement", id: movementRow.id, amount: movementRow.amount, data: movementRow, upstream: [], downstream: [] },
  ];

  const root: MoneyTrailNode = {
    type: "withdrawal_destination_allocation",
    id: legRow.id,
    amount: legRow.amount,
    data: legRow,
    upstream: [withdrawal],
    downstream: [movement],
  };

  return root;
}

describe("flattenTrail (Review Triage Log row 1 -- root-shadowing regression)", () => {
  it("includes a leg's own downstream reinvestment chain (money_movement -> investment_transaction) when tracing from that leg, even though the leg reappears as a cycle-protection stub in its parent withdrawal's downstream list", () => {
    const root = buildLegStartedTrail();

    const flattened = flattenTrail(root);
    const types = flattened.map((node) => `${node.type}:${node.id}`);

    // Every real node reachable in either direction from the leg is present exactly once.
    expect(types).toEqual([
      "withdrawal_destination_allocation:leg-1",
      "withdrawal_transaction:wd-1",
      "project_investment_pool:project-a",
      "money_movement:mv-1",
      "investment_transaction:inv-1",
    ]);

    // The reinvestment node specifically -- the one the bug silently dropped -- is present.
    const reinvestmentNode = flattened.find(
      (node) => node.type === "investment_transaction" && node.id === "inv-1",
    );
    expect(reinvestmentNode).toBeDefined();
  });

  it("includes ALL sibling legs of a multi-leg withdrawal when tracing from just one of them", () => {
    const withdrawalRow = withdrawalTransactionRow();
    const leg1Row = allocationLegRow({ id: "leg-1", destinationType: "person", personName: "Alice" });
    const leg2Row = allocationLegRow({ id: "leg-2", destinationType: "person", personName: "Bob" });
    const leg3Row = allocationLegRow({ id: "leg-3", destinationType: "person", personName: "Carol" });

    const pool: MoneyTrailNode = {
      type: "project_investment_pool",
      id: withdrawalRow.projectId,
      amount: "1000000" as Money,
      data: { projectId: withdrawalRow.projectId, totalActiveInvested: "1000000" as Money },
      upstream: [],
      downstream: [],
    };

    // Every sibling leg's OWN upstream is a stub of the withdrawal (mirrors
    // `assembleMoneyTrail`'s real behavior -- the withdrawal's key is already
    // on the construction path by the time each leg in its `downstream` list
    // is built).
    const withdrawalStub = (): MoneyTrailNode => ({
      type: "withdrawal_transaction",
      id: withdrawalRow.id,
      amount: withdrawalRow.amount,
      data: withdrawalRow,
      upstream: [],
      downstream: [],
    });

    const leg1Stub: MoneyTrailNode = {
      type: "withdrawal_destination_allocation",
      id: leg1Row.id,
      amount: leg1Row.amount,
      data: leg1Row,
      upstream: [],
      downstream: [],
    };
    const leg2: MoneyTrailNode = {
      type: "withdrawal_destination_allocation",
      id: leg2Row.id,
      amount: leg2Row.amount,
      data: leg2Row,
      upstream: [withdrawalStub()],
      downstream: [],
    };
    const leg3: MoneyTrailNode = {
      type: "withdrawal_destination_allocation",
      id: leg3Row.id,
      amount: leg3Row.amount,
      data: leg3Row,
      upstream: [withdrawalStub()],
      downstream: [],
    };

    const withdrawal: MoneyTrailNode = {
      type: "withdrawal_transaction",
      id: withdrawalRow.id,
      amount: withdrawalRow.amount,
      data: withdrawalRow,
      upstream: [pool],
      downstream: [leg1Stub, leg2, leg3],
    };

    const root: MoneyTrailNode = {
      type: "withdrawal_destination_allocation",
      id: leg1Row.id,
      amount: leg1Row.amount,
      data: leg1Row,
      upstream: [withdrawal],
      downstream: [],
    };

    const flattened = flattenTrail(root);
    const ids = flattened.filter((node) => node.type === "withdrawal_destination_allocation").map((node) => node.id);

    expect(ids.sort()).toEqual(["leg-1", "leg-2", "leg-3"]);
  });
});

describe("describeTrailNode (Review Triage Log row 1 -- reinvestment color regression)", () => {
  it("colors a reinvestment investment_transaction amber, not green, when the trail is traced directly from it (root-first dedup keeps the real, upstream-carrying node instead of its downstream cycle-protection stub)", () => {
    const reinvestmentRow = investmentTransactionRow();
    const movementRow = moneyMovementRow();

    const reinvestmentStubViaMovementDownstream: MoneyTrailNode = {
      type: "investment_transaction",
      id: reinvestmentRow.id,
      amount: reinvestmentRow.amount,
      data: reinvestmentRow,
      upstream: [],
      downstream: [],
    };

    const movement: MoneyTrailNode = {
      type: "money_movement",
      id: movementRow.id,
      amount: movementRow.amount,
      data: movementRow,
      upstream: [],
      downstream: [reinvestmentStubViaMovementDownstream],
    };

    const root: MoneyTrailNode = {
      type: "investment_transaction",
      id: reinvestmentRow.id,
      amount: reinvestmentRow.amount,
      data: reinvestmentRow,
      upstream: [movement],
      downstream: [],
    };

    const flattened = flattenTrail(root);
    const reinvestmentNode = flattened.find(
      (node) => node.type === "investment_transaction" && node.id === reinvestmentRow.id,
    );
    expect(reinvestmentNode).toBeDefined();
    // Must be the REAL node (upstream: [movement]), not the stub (upstream: []).
    expect(reinvestmentNode?.upstream).toHaveLength(1);

    const { dotColor } = describeTrailNode(reinvestmentNode!);
    expect(dotColor).toBe("var(--color-amber)");
  });

  it("colors a true-origin investment_transaction (no upstream) green, not amber", () => {
    const originRow = investmentTransactionRow({ id: "inv-origin" });
    const node: MoneyTrailNode = {
      type: "investment_transaction",
      id: originRow.id,
      amount: originRow.amount,
      data: originRow,
      upstream: [],
      downstream: [],
    };

    const { dotColor } = describeTrailNode(node);
    expect(dotColor).toBe("var(--color-success)");
  });
});

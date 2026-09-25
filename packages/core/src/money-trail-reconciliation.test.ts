import { describe, it, expect } from "vitest";
import type { Money, MoneyTrailNode } from "@niveshbook/types";
import { reconcileMoneyTrail } from "./money-trail-reconciliation";

function investmentTransactionNode(id: string, amount: string): MoneyTrailNode {
  return {
    type: "investment_transaction",
    id,
    amount: amount as Money,
    data: {} as never,
    upstream: [],
    downstream: [],
  };
}

function moneyMovementNode(
  id: string,
  amount: string,
  upstream: MoneyTrailNode[],
  downstream: MoneyTrailNode[],
): MoneyTrailNode {
  return {
    type: "money_movement",
    id,
    amount: amount as Money,
    data: {} as never,
    upstream,
    downstream,
  };
}

function legNode(id: string, amount: string, downstream: MoneyTrailNode[] = []): MoneyTrailNode {
  return {
    type: "withdrawal_destination_allocation",
    id,
    amount: amount as Money,
    data: {} as never,
    upstream: [],
    downstream,
  };
}

function poolNode(type: "project_investment_pool" | "available_balance_pool", id: string, amount: string): MoneyTrailNode {
  return { type, id, amount: amount as Money, data: {} as never, upstream: [], downstream: [] };
}

function withdrawalNode(id: string, amount: string, downstream: MoneyTrailNode[]): MoneyTrailNode {
  return {
    type: "withdrawal_transaction",
    id,
    amount: amount as Money,
    data: {} as never,
    upstream: [poolNode("project_investment_pool", "pool-1", "1000000")],
    downstream,
  };
}

describe("reconcileMoneyTrail (Story 4.10, FR30)", () => {
  it("a healthy chain (the full worked example) reconciles with zero discrepancies", () => {
    const investmentTransaction = investmentTransactionNode("inv-b", "300000");
    const movement = moneyMovementNode("movement-1", "300000", [], [investmentTransaction]);
    const leg = legNode("leg-project", "300000", [movement]);
    const withdrawal = withdrawalNode("withdrawal-1", "300000", [leg]);

    const result = reconcileMoneyTrail(withdrawal);

    expect(result).toEqual({ reconciled: true, discrepancies: [] });
  });

  it("a zero-leg withdrawal (no allocation recorded yet) is reconciled, not flagged (this story's I/O matrix)", () => {
    const withdrawal = withdrawalNode("withdrawal-1", "250000", []);

    const result = reconcileMoneyTrail(withdrawal);

    expect(result).toEqual({ reconciled: true, discrepancies: [] });
  });

  it("flags a withdrawal whose legs don't sum to its own amount", () => {
    const legA = legNode("leg-a", "100000");
    const legB = legNode("leg-b", "100000");
    // Legs sum to 200,000 but the withdrawal itself is 250,000.
    const withdrawal = withdrawalNode("withdrawal-1", "250000", [legA, legB]);

    const result = reconcileMoneyTrail(withdrawal);

    expect(result.reconciled).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]).toMatchObject({ nodeType: "withdrawal_transaction", nodeId: "withdrawal-1" });
  });

  it("flags a money movement whose amount doesn't match its upstream leg's amount", () => {
    const investmentTransaction = investmentTransactionNode("inv-b", "300000");
    // Movement amount (250,000) mismatches both its own leg and downstream investment.
    const movement = moneyMovementNode("movement-1", "250000", [], [investmentTransaction]);
    const leg = legNode("leg-project", "300000", [movement]);
    movement.upstream = [leg];
    const withdrawal = withdrawalNode("withdrawal-1", "300000", [leg]);

    const result = reconcileMoneyTrail(withdrawal);

    expect(result.reconciled).toBe(false);
    // Both the upstream-mismatch and downstream-mismatch invariants fire independently.
    expect(result.discrepancies.filter((d) => d.nodeId === "movement-1")).toHaveLength(2);
  });

  it("flags a money movement whose amount doesn't match its downstream investment_transaction's amount", () => {
    const investmentTransaction = investmentTransactionNode("inv-b", "999999");
    const leg = legNode("leg-project", "300000");
    const movement = moneyMovementNode("movement-1", "300000", [leg], [investmentTransaction]);
    leg.downstream = [movement];
    const withdrawal = withdrawalNode("withdrawal-1", "300000", [leg]);

    const result = reconcileMoneyTrail(withdrawal);

    expect(result.reconciled).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]).toMatchObject({ nodeType: "money_movement", nodeId: "movement-1" });
  });

  it("collects every discrepancy across the whole tree rather than stopping at the first", () => {
    const legA = legNode("leg-a", "100000");
    const legB = legNode("leg-b", "100000");
    // Withdrawal-level mismatch AND a movement-level mismatch, both in one tree.
    const investmentTransaction = investmentTransactionNode("inv-x", "1");
    const movement = moneyMovementNode("movement-1", "100000", [legA], [investmentTransaction]);
    legA.downstream = [movement];
    const withdrawal = withdrawalNode("withdrawal-1", "999999999", [legA, legB]);

    const result = reconcileMoneyTrail(withdrawal);

    expect(result.reconciled).toBe(false);
    expect(result.discrepancies.length).toBeGreaterThanOrEqual(2);
    expect(result.discrepancies.some((d) => d.nodeType === "withdrawal_transaction")).toBe(true);
    expect(result.discrepancies.some((d) => d.nodeType === "money_movement")).toBe(true);
  });
});

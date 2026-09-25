import type { MoneyTrailDiscrepancy, MoneyTrailNode, MoneyTrailReconciliationResult } from "@niveshbook/types";
import { moneyEquals, sumMoney } from "./decimal-math";

/**
 * Walks one `withdrawal_transaction` node's own downstream legs: if it has
 * ≥1, asserts `sumMoney(legs) === node.amount` (AD-2, never raw
 * arithmetic). Zero legs is a valid, non-discrepant state (this story's I/O
 * matrix -- not every withdrawal has been allocated yet) -- skipped
 * entirely, not flagged.
 */
function checkWithdrawalTransaction(node: MoneyTrailNode, discrepancies: MoneyTrailDiscrepancy[]): void {
  if (node.downstream.length === 0) {
    return;
  }
  const legsTotal = sumMoney(node.downstream.map((leg) => leg.amount));
  if (!moneyEquals(legsTotal, node.amount)) {
    discrepancies.push({
      nodeType: node.type,
      nodeId: node.id,
      message: `Withdrawal ${node.id}: its ${node.downstream.length} destination-allocation leg(s) sum to ${legsTotal}, which does not equal its own amount ${node.amount}.`,
    });
  }
}

/**
 * Walks one `money_movement` node: asserts its own `amount` equals both its
 * single upstream node's amount (the leg/spend that created it) and its
 * single downstream node's amount (the auto-created destination
 * `investment_transaction`) -- the same `amount` value is written to both
 * sides in one atomic transaction at create time (Stories 4.7-4.9), so this
 * is a defensive re-check, not new business logic (spec-4-10's Decisions
 * #5). A missing upstream/downstream (shouldn't happen for a genuinely
 * saved movement, but the tree is walked exactly as assembled) is skipped,
 * not flagged -- `assembleMoneyTrail()`'s own edge-walking is what
 * guarantees these are populated for a real row; a genuinely orphaned
 * `money_movements` row is a referential-integrity problem this pass isn't
 * positioned to detect from a `MoneyTrailNode` tree alone.
 */
function checkMoneyMovement(node: MoneyTrailNode, discrepancies: MoneyTrailDiscrepancy[]): void {
  const [upstream] = node.upstream;
  if (upstream && !moneyEquals(upstream.amount, node.amount)) {
    discrepancies.push({
      nodeType: node.type,
      nodeId: node.id,
      message: `Money movement ${node.id}: its own amount ${node.amount} does not equal its upstream ${upstream.type} ${upstream.id}'s amount ${upstream.amount}.`,
    });
  }

  const [downstream] = node.downstream;
  if (downstream && !moneyEquals(downstream.amount, node.amount)) {
    discrepancies.push({
      nodeType: node.type,
      nodeId: node.id,
      message: `Money movement ${node.id}: its own amount ${node.amount} does not equal its downstream ${downstream.type} ${downstream.id}'s amount ${downstream.amount}.`,
    });
  }
}

function walk(node: MoneyTrailNode, discrepancies: MoneyTrailDiscrepancy[], visited: Set<string>): void {
  const key = `${node.type}:${node.id}`;
  // Mirrors `assembleMoneyTrail()`'s own defensive cycle protection -- a
  // pure tree walk over an already-assembled tree should never actually
  // revisit a node, but this guards against re-checking (and
  // double-counting into `discrepancies`) the rare terminal-stub node
  // `assembleMoneyTrail()` itself produces when it stops expanding a
  // would-be cycle.
  if (visited.has(key)) {
    return;
  }
  visited.add(key);

  if (node.type === "withdrawal_transaction") {
    checkWithdrawalTransaction(node, discrepancies);
  } else if (node.type === "money_movement") {
    checkMoneyMovement(node, discrepancies);
  }

  for (const child of node.upstream) {
    walk(child, discrepancies, visited);
  }
  for (const child of node.downstream) {
    walk(child, discrepancies, visited);
  }
}

/**
 * Pure, synchronous defensive verification pass (Story 4.10, FR30,
 * spec-4-10's Decisions #5) -- walks an already-`assembleMoneyTrail()`-
 * assembled tree and re-checks every sum invariant it implies: a
 * withdrawal's legs sum to its own amount, and a money movement's amount
 * matches both the leg/spend that created it and the investment transaction
 * it created. Collects every failure into `discrepancies` rather than
 * throwing on the first (a caller wants to see all of them at once, this
 * story's Boundaries).
 */
export function reconcileMoneyTrail(trail: MoneyTrailNode): MoneyTrailReconciliationResult {
  const discrepancies: MoneyTrailDiscrepancy[] = [];
  walk(trail, discrepancies, new Set());
  return { reconciled: discrepancies.length === 0, discrepancies };
}

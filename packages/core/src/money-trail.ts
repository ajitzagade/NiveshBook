import type {
  AvailableBalanceSpend,
  InvestmentTransaction,
  Money,
  MoneyMovement,
  MoneyTrailNode,
  MoneyTrailNodeType,
  WithdrawalDestinationAllocation,
  WithdrawalTransaction,
} from "@niveshbook/types";
import type { AvailableBalancePort, AvailableBalanceSpendPort } from "./available-balance-port";
import type { InvestmentTransactionPort } from "./investment-transaction-port";
import type { MoneyMovementPort } from "./money-movement-port";
import type { WithdrawalDestinationAllocationPort } from "./withdrawal-destination-allocation-port";
import type { WithdrawalTransactionPort } from "./withdrawal-transaction-port";

/**
 * Thrown when `assembleMoneyTrail()`'s `start` reference doesn't resolve to
 * a real row (Story 4.10, FR30) -- either a well-formed but nonexistent id
 * (this story's I/O matrix: 404 `not_found`), or `start.type` being one of
 * the two pool-reference types (`"project_investment_pool"`/
 * `"available_balance_pool"`) or `"money_movement"`, none of which have a
 * meaningful single-id "starting point" lookup in this system (a pool
 * reference is a derived fact, not a row; a `money_movement` is only ever
 * reached as part of a neighboring node's own edge, never addressed
 * directly by its own id -- see this module's own doc comment on
 * `MoneyTrailDeps`).
 */
export class MoneyTrailEntityNotFoundError extends Error {
  constructor(type: MoneyTrailNodeType, id: string) {
    super(`No ${type} found with id "${id}".`);
    this.name = "MoneyTrailEntityNotFoundError";
  }
}

/**
 * Every port method `assembleMoneyTrail()`'s recursive edge-walking needs
 * (Story 4.10, FR30) -- read-only, mirrors `MoveWithdrawalToProjectDeps`'s
 * DI shape (AD-9: no Drizzle import, this whole module is plain TypeScript).
 * Deliberately has no `MoneyMovementPort.findById`-by-its-own-id equivalent
 * -- this system never looks a `money_movements` row up by its own id
 * directly, only via one of its three FK-shaped finders (to/from a
 * neighboring entity), which is exactly how every edge in this module
 * reaches one.
 */
export interface MoneyTrailDeps {
  investmentTransactions: Pick<InvestmentTransactionPort, "findById" | "sumActiveAmountByProjectId">;
  withdrawalTransactions: Pick<WithdrawalTransactionPort, "findById">;
  withdrawalDestinationAllocations: Pick<
    WithdrawalDestinationAllocationPort,
    "findById" | "listByWithdrawalTransactionId"
  >;
  moneyMovements: Pick<
    MoneyMovementPort,
    | "findByDestinationInvestmentTransactionId"
    | "findByWithdrawalDestinationAllocationId"
    | "findByAvailableBalanceSpendId"
  >;
  availableBalances: Pick<AvailableBalancePort, "findBalance">;
  availableBalanceSpends: Pick<AvailableBalanceSpendPort, "findById">;
}

function nodeKey(type: MoneyTrailNodeType, id: string): string {
  return `${type}:${id}`;
}

/**
 * A pool-reference node is always a terminal leaf (`upstream`/`downstream`
 * both `[]`, spec-4-10's Boundaries) -- it reports an aggregate figure, it
 * never fans out into every other transaction that ever touched the same
 * pool (explicitly out of scope, spec-4-10's Decisions #3).
 */
async function buildProjectInvestmentPoolNode(
  projectId: string,
  deps: MoneyTrailDeps,
): Promise<MoneyTrailNode> {
  const totalActiveInvested = await deps.investmentTransactions.sumActiveAmountByProjectId(projectId);
  return {
    type: "project_investment_pool",
    id: projectId,
    amount: totalActiveInvested,
    data: { projectId, totalActiveInvested },
    upstream: [],
    downstream: [],
  };
}

/** Mirrors `buildProjectInvestmentPoolNode` one pool-type over -- see that function's own doc comment. */
async function buildAvailableBalancePoolNode(
  partyType: "partner" | "sub_partner",
  shareId: string,
  projectId: string,
  deps: MoneyTrailDeps,
): Promise<MoneyTrailNode> {
  const balanceRow = await deps.availableBalances.findBalance(partyType, shareId, projectId);
  const balance = balanceRow?.balance ?? ("0" as Money);
  return {
    type: "available_balance_pool",
    // No real row id for this pool-reference type (a missing balance row is
    // a valid "0" pool, not a missing entity) -- keyed by the
    // (partyType, shareId, projectId) tuple it summarizes instead, joined so
    // it's still a stable, unique string per pool.
    id: `${partyType}:${shareId}:${projectId}`,
    amount: balance,
    data: { partyType, shareId, projectId, balance },
    upstream: [],
    downstream: [],
  };
}

/**
 * An `investment_transaction` node's `downstream` is ALWAYS `[]` --
 * withdrawals draw from a pooled Project total, never a specific investment
 * row (spec-4-10's Decisions #4/Boundaries). Its `upstream` is either the
 * `money_movement` that auto-created it (a cross-Project move/spend
 * destination), or `[]` for a true origin (a manually-recorded Add Money
 * entry).
 */
async function buildInvestmentTransactionNode(
  row: InvestmentTransaction,
  deps: MoneyTrailDeps,
  path: ReadonlySet<string>,
): Promise<MoneyTrailNode> {
  const key = nodeKey("investment_transaction", row.id);
  const node: MoneyTrailNode = {
    type: "investment_transaction",
    id: row.id,
    amount: row.amount,
    data: row,
    upstream: [],
    downstream: [],
  };
  if (path.has(key)) {
    return node;
  }
  const nextPath = new Set(path).add(key);

  const movement = await deps.moneyMovements.findByDestinationInvestmentTransactionId(row.id);
  if (movement) {
    node.upstream = [await buildMoneyMovementNode(movement, deps, nextPath)];
  }
  return node;
}

/**
 * A `money_movement` node's `upstream` is whichever of its two mutually
 * exclusive sources created it (a `"project"` withdrawal-destination-
 * allocation leg, or an Available Balance spend); its `downstream` is
 * always the auto-created destination `investment_transaction`.
 */
async function buildMoneyMovementNode(
  row: MoneyMovement,
  deps: MoneyTrailDeps,
  path: ReadonlySet<string>,
): Promise<MoneyTrailNode> {
  const key = nodeKey("money_movement", row.id);
  const node: MoneyTrailNode = {
    type: "money_movement",
    id: row.id,
    amount: row.amount,
    data: row,
    upstream: [],
    downstream: [],
  };
  if (path.has(key)) {
    return node;
  }
  const nextPath = new Set(path).add(key);

  if (row.withdrawalDestinationAllocationId) {
    const leg = await deps.withdrawalDestinationAllocations.findById(row.withdrawalDestinationAllocationId);
    if (leg) {
      node.upstream = [await buildWithdrawalDestinationAllocationNode(leg, deps, nextPath)];
    }
  } else if (row.availableBalanceSpendId) {
    const spend = await deps.availableBalanceSpends.findById(row.availableBalanceSpendId);
    if (spend) {
      node.upstream = [await buildAvailableBalanceSpendNode(spend, deps, nextPath)];
    }
  }

  const destinationTransaction = await deps.investmentTransactions.findById(
    row.destinationInvestmentTransactionId,
  );
  if (destinationTransaction) {
    node.downstream = [await buildInvestmentTransactionNode(destinationTransaction, deps, nextPath)];
  }

  return node;
}

/**
 * A `withdrawal_destination_allocation` (leg) node's `upstream` is always
 * the withdrawal it belongs to; its `downstream` depends on
 * `destinationType` (spec-4-10's Decisions #4): `"project"` -> the linked
 * `money_movement`; `"available_balance"` -> the `available_balance_pool`
 * reference for the withdrawal's own `(partyType, shareId)` at its own
 * source Project (mirrors `createWithdrawalDestinationAllocationPort`'s own
 * `"available_balance"` credit target, spec-4-9's Decisions #1);
 * `"person"`/`"other"` -> a leaf, `[]`.
 */
async function buildWithdrawalDestinationAllocationNode(
  row: WithdrawalDestinationAllocation,
  deps: MoneyTrailDeps,
  path: ReadonlySet<string>,
): Promise<MoneyTrailNode> {
  const key = nodeKey("withdrawal_destination_allocation", row.id);
  const node: MoneyTrailNode = {
    type: "withdrawal_destination_allocation",
    id: row.id,
    amount: row.amount,
    data: row,
    upstream: [],
    downstream: [],
  };
  if (path.has(key)) {
    return node;
  }
  const nextPath = new Set(path).add(key);

  const withdrawal = await deps.withdrawalTransactions.findById(row.withdrawalTransactionId);
  if (withdrawal) {
    node.upstream = [await buildWithdrawalTransactionNode(withdrawal, deps, nextPath)];
  }

  if (row.destinationType === "project") {
    const movement = await deps.moneyMovements.findByWithdrawalDestinationAllocationId(row.id);
    if (movement) {
      node.downstream = [await buildMoneyMovementNode(movement, deps, nextPath)];
    }
  } else if (row.destinationType === "available_balance" && withdrawal) {
    node.downstream = [
      await buildAvailableBalancePoolNode(withdrawal.partyType, withdrawal.shareId, withdrawal.projectId, deps),
    ];
  }
  // "person"/"other": a leaf, `downstream` stays `[]`.

  return node;
}

/**
 * A `withdrawal_transaction` node's `upstream` is always its source
 * Project's `project_investment_pool` reference (spec-4-10's Decisions #3 --
 * this app has never earmarked a specific investment to a specific
 * withdrawal); its `downstream` is every destination-allocation leg saved
 * for it (`[]` if none have been saved yet -- a valid, non-discrepant state,
 * this story's I/O matrix).
 */
async function buildWithdrawalTransactionNode(
  row: WithdrawalTransaction,
  deps: MoneyTrailDeps,
  path: ReadonlySet<string>,
): Promise<MoneyTrailNode> {
  const key = nodeKey("withdrawal_transaction", row.id);
  const node: MoneyTrailNode = {
    type: "withdrawal_transaction",
    id: row.id,
    amount: row.amount,
    data: row,
    upstream: [],
    downstream: [],
  };
  if (path.has(key)) {
    return node;
  }
  const nextPath = new Set(path).add(key);

  node.upstream = [await buildProjectInvestmentPoolNode(row.projectId, deps)];

  const legs = await deps.withdrawalDestinationAllocations.listByWithdrawalTransactionId(row.id);
  const downstream: MoneyTrailNode[] = [];
  // Sequential, not Promise.all -- keeps sibling legs deterministically
  // ordered (mirrors this codebase's established "one open connection can't
  // serve concurrent queries cleanly" precedent, `ports.ts`'s
  // `recordAllocation`).
  for (const leg of legs) {
    downstream.push(await buildWithdrawalDestinationAllocationNode(leg, deps, nextPath));
  }
  node.downstream = downstream;

  return node;
}

/**
 * An `available_balance_spend` node's `upstream` is always the
 * `available_balance_pool` reference it debited; its `downstream` is the
 * linked `money_movement` for a `"project"` spend, or a leaf (`[]`) for a
 * `"person"` spend.
 */
async function buildAvailableBalanceSpendNode(
  row: AvailableBalanceSpend,
  deps: MoneyTrailDeps,
  path: ReadonlySet<string>,
): Promise<MoneyTrailNode> {
  const key = nodeKey("available_balance_spend", row.id);
  const node: MoneyTrailNode = {
    type: "available_balance_spend",
    id: row.id,
    amount: row.amount,
    data: row,
    upstream: [],
    downstream: [],
  };
  if (path.has(key)) {
    return node;
  }
  const nextPath = new Set(path).add(key);

  node.upstream = [
    await buildAvailableBalancePoolNode(row.partyType, row.shareId, row.sourceProjectId, deps),
  ];

  if (row.destinationType === "project") {
    const movement = await deps.moneyMovements.findByAvailableBalanceSpendId(row.id);
    if (movement) {
      node.downstream = [await buildMoneyMovementNode(movement, deps, nextPath)];
    }
  }

  return node;
}

/**
 * Recursively assembles the full linked-transaction chain reachable from
 * `start`, in both directions (Story 4.10, FR30, AD-9: dependency-injected
 * ports, zero Drizzle imports, mirrors `moveWithdrawalToProject()`'s DI
 * shape). Tracks visited `(type, id)` pairs for the current path only
 * (`path`, a fresh `Set` per top-level call) -- defensive cycle protection
 * (this story's Boundaries): a node already on the current path is returned
 * as a terminal leaf rather than re-expanded, even though the underlying
 * FK structure is append-only and shouldn't produce a real cycle.
 *
 * Throws `MoneyTrailEntityNotFoundError` if `start` doesn't resolve -- either
 * a well-formed but nonexistent id for one of the four types with a genuine
 * single-id lookup (`investment_transaction`/`withdrawal_transaction`/
 * `withdrawal_destination_allocation`/`available_balance_spend`), or
 * `start.type` being `"money_movement"` or one of the two pool-reference
 * types, none of which are ever a valid trail *starting point* in this
 * system (see `MoneyTrailDeps`'s own doc comment) -- the route layer is
 * expected to reject those before ever calling this function, but this
 * function stays correct/total on its own regardless of caller discipline.
 */
export async function assembleMoneyTrail(
  start: { type: MoneyTrailNodeType; id: string },
  deps: MoneyTrailDeps,
): Promise<MoneyTrailNode> {
  switch (start.type) {
    case "investment_transaction": {
      const row = await deps.investmentTransactions.findById(start.id);
      if (!row) throw new MoneyTrailEntityNotFoundError(start.type, start.id);
      return buildInvestmentTransactionNode(row, deps, new Set());
    }
    case "withdrawal_transaction": {
      const row = await deps.withdrawalTransactions.findById(start.id);
      if (!row) throw new MoneyTrailEntityNotFoundError(start.type, start.id);
      return buildWithdrawalTransactionNode(row, deps, new Set());
    }
    case "withdrawal_destination_allocation": {
      const row = await deps.withdrawalDestinationAllocations.findById(start.id);
      if (!row) throw new MoneyTrailEntityNotFoundError(start.type, start.id);
      return buildWithdrawalDestinationAllocationNode(row, deps, new Set());
    }
    case "available_balance_spend": {
      const row = await deps.availableBalanceSpends.findById(start.id);
      if (!row) throw new MoneyTrailEntityNotFoundError(start.type, start.id);
      return buildAvailableBalanceSpendNode(row, deps, new Set());
    }
    case "money_movement":
    case "project_investment_pool":
    case "available_balance_pool":
      throw new MoneyTrailEntityNotFoundError(start.type, start.id);
  }
}

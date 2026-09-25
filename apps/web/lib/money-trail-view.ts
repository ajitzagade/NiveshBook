import type {
  AvailableBalanceSpend,
  InvestmentTransaction,
  MoneyHistoryEntryType,
  MoneyMovement,
  MoneyTrailNode,
  WithdrawalDestinationAllocation,
  WithdrawalTransaction,
} from "@niveshbook/types";

/**
 * "What Happened" plain-language label per `MoneyHistoryEntryType`
 * (`epic-5-context`'s AC list, spec-5-1's I/O matrix) -- the
 * `Record<MoneyHistoryEntryType, string>` forces this to stay exhaustive
 * against `packages/types`'s union at compile time, mirroring the Add Money
 * page's `PAYMENT_MODE_LABELS` precedent. Reused by `describeTrailNode()`
 * below so the flat Money History list and the Trail view never drift onto
 * different wording for the same underlying event.
 */
export const ENTRY_TYPE_LABELS: Record<MoneyHistoryEntryType, string> = {
  money_added: "Money Added",
  money_withdrawn: "Money Withdrawn",
  moved_to_project: "Moved to Project",
  given_to_person: "Given to Person",
  added_to_available_balance: "Added to Available Balance",
  used_from_available_balance: "Used from Available Balance",
};

const PARTY_TYPE_LABELS: Record<"partner" | "sub_partner", string> = {
  partner: "Partner",
  sub_partner: "Sub-partner",
};

export interface TrailNodeDisplay {
  dotColor: string;
  what: string;
  meta: string;
}

/**
 * One node's dot color + "what"/"meta" display strings for the vertical
 * Trail (Story 5.2, FR32) -- DESIGN.md's own semantic color table ("Colors")
 * ties each of the 5 palette colors to a transaction/adjustment *meaning*,
 * not a fixed per-component color, so this mirrors that table onto every one
 * of the 7 `MoneyTrailNodeType` members a trail can contain (not just the 4
 * startable ones -- `upstream`/`downstream` can reach any of the 7). See this
 * story's Implementation Notes for the exact reasoning per node type,
 * including the one deliberate case-by-case split (an `investment_transaction`
 * reached as a reinvestment, not a true origin, uses DESIGN.md's own "amber:
 * a later/secondary reinvestment step in a money trail" language literally).
 *
 * The `isReinvestment` check (`node.upstream.length > 0`) is only correct if
 * `node` is the real, fully-hydrated node -- not a cycle-protection stub with
 * `upstream: []` standing in for a node that actually has an upstream
 * elsewhere in the tree. `flattenTrail()` below is responsible for never
 * handing this function a shadowing stub in place of the real node (Review
 * Triage Log row 1) -- this function trusts whatever `MoneyTrailNode` it's
 * given at face value.
 */
export function describeTrailNode(node: MoneyTrailNode): TrailNodeDisplay {
  switch (node.type) {
    case "investment_transaction": {
      const row = node.data as InvestmentTransaction;
      const isReinvestment = node.upstream.length > 0;
      const statusSuffix = row.status === "cancelled" ? " · Cancelled" : "";
      return {
        dotColor: isReinvestment ? "var(--color-amber)" : "var(--color-success)",
        what: ENTRY_TYPE_LABELS.money_added,
        meta: `${PARTY_TYPE_LABELS[row.partyType]} · ${row.transactionDate}${statusSuffix}`,
      };
    }
    case "withdrawal_transaction": {
      const row = node.data as WithdrawalTransaction;
      const statusSuffix = row.status === "cancelled" ? " · Cancelled" : "";
      return {
        dotColor: "var(--color-danger)",
        what: ENTRY_TYPE_LABELS.money_withdrawn,
        meta: `${PARTY_TYPE_LABELS[row.partyType]} · ${row.transactionDate}${statusSuffix}`,
      };
    }
    case "withdrawal_destination_allocation": {
      const row = node.data as WithdrawalDestinationAllocation;
      if (row.destinationType === "project") {
        return { dotColor: "var(--color-info)", what: ENTRY_TYPE_LABELS.moved_to_project, meta: "Moved between Projects" };
      }
      if (row.destinationType === "available_balance") {
        return {
          dotColor: "var(--color-violet)",
          what: ENTRY_TYPE_LABELS.added_to_available_balance,
          meta: "Kept for later",
        };
      }
      return {
        dotColor: "var(--color-violet)",
        what: ENTRY_TYPE_LABELS.given_to_person,
        meta: row.destinationType === "person" ? (row.personName ?? "Someone") : "Other",
      };
    }
    case "money_movement": {
      const row = node.data as MoneyMovement;
      return { dotColor: "var(--color-info)", what: "Money Movement", meta: `Auto-linked · ${row.createdAt.slice(0, 10)}` };
    }
    case "available_balance_spend": {
      const row = node.data as AvailableBalanceSpend;
      return {
        dotColor: "var(--color-violet)",
        what: ENTRY_TYPE_LABELS.used_from_available_balance,
        meta: row.destinationType === "project" ? "Used to invest in a Project" : (row.personName ?? "Someone"),
      };
    }
    case "project_investment_pool":
      return { dotColor: "var(--color-ink-faint)", what: "Project Investment Pool", meta: "Pooled active investment" };
    case "available_balance_pool": {
      const data = node.data as { partyType: "partner" | "sub_partner"; shareId: string; projectId: string };
      return {
        dotColor: "var(--color-violet)",
        what: "Available Balance",
        meta: `${PARTY_TYPE_LABELS[data.partyType]}'s balance`,
      };
    }
  }
}

/**
 * Flattens the recursive `MoneyTrailNode` tree `GET /api/money-trail` returns
 * into one row per distinct node, for `Trail`'s one-row-per-node shape
 * (Story 5.2's Code Map: "the implementer's call", as long as every
 * reachable node appears exactly once, in a stable order, no infinite loop).
 *
 * A generic "visit both `upstream` and `downstream`, recursively, dedup by
 * `(type, id)`" DFS is required, not just a walk of `root`'s own
 * `upstream`/`downstream` -- an intermediate ancestor's OWN `downstream` can
 * re-expand sibling branches the starting node's own subtree never reaches
 * (e.g. starting from one `withdrawal_destination_allocation` leg: walking up
 * reaches its parent `withdrawal_transaction`, whose `downstream` is EVERY
 * leg of that withdrawal, not just the one we started from -- this is
 * exactly how the worked-example's "one withdrawal, 3 legs" chain becomes
 * fully reachable from any single leg).
 *
 * `visit(root)` MUST run FIRST, before exploring anything else (Review
 * Triage Log row 1 -- a real, verified bug in an earlier version of this
 * function that visited root's ancestors first and `root` itself last).
 * `assembleMoneyTrail()`'s own cycle-protection means `root` gets
 * re-encountered elsewhere in the SAME tree as a TRUNCATED STUB carrying the
 * identical `(type, id)` key but `upstream: []`/`downstream: []` -- even when
 * the real `root` object (the one this function was actually called with)
 * has real children. Concretely: a withdrawal's `downstream` lists EVERY leg
 * via `listByWithdrawalTransactionId`, including whichever leg the trail was
 * started from -- that leg comes back as a stub there, since its own key is
 * already on `assembleMoneyTrail`'s construction path at that point. If
 * `root`'s ancestors (which includes that parent withdrawal) are visited
 * BEFORE `root`, the stub is what the ancestor walk reaches first, claiming
 * `root`'s dedup key -- permanently shadowing the real `root` object's real
 * `upstream`/`downstream` (`visit(root)` becomes a no-op later, since the key
 * is already "visited"). That silently drops an entire reachable subtree
 * (e.g. a `"project"`-destination leg's own downstream reinvestment chain
 * never gets explored) and mis-colors a reinvestment `investment_transaction`
 * traced directly as a true origin (the stub's `upstream: []` reads as "no
 * upstream" to `describeTrailNode`'s `isReinvestment` check).
 *
 * Visiting `root` first claims its key immediately with its REAL
 * `upstream`/`downstream`, so any later-encountered stub of the same node is
 * correctly treated as an already-visited duplicate instead of shadowing it.
 * `visit(root)` alone is then sufficient -- it already recursively explores
 * both `upstream` and `downstream` at every node it touches, so it reaches
 * every node in the same connected component as `root` (including every
 * ancestor and everything reachable from each ancestor's own downstream) in
 * one call; a separate "walk to the true origin first" pass isn't needed on
 * top of it (nor would it still change anything once `visit(root)`'s own
 * traversal already reaches the same nodes, dedup-first).
 */
export function flattenTrail(root: MoneyTrailNode): MoneyTrailNode[] {
  const visited = new Set<string>();
  const ordered: MoneyTrailNode[] = [];

  function nodeKey(node: MoneyTrailNode): string {
    return `${node.type}:${node.id}`;
  }

  function visit(node: MoneyTrailNode): void {
    const key = nodeKey(node);
    if (visited.has(key)) {
      return;
    }
    visited.add(key);
    ordered.push(node);
    for (const up of node.upstream) visit(up);
    for (const down of node.downstream) visit(down);
  }

  visit(root);

  return ordered;
}

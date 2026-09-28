import type { Money, MoneyHistoryEntry } from "@niveshbook/types";
import { sumMoney } from "./decimal-math";

export type MoneyFlowEdgeDirection = "in" | "out";
export type MoneyFlowEdgeCounterpartyKind = "project" | "person" | "available_balance" | "other";

export interface MoneyFlowEdge {
  id: string;
  partyType: "partner" | "sub_partner";
  shareId: string;
  direction: MoneyFlowEdgeDirection;
  counterpartyKind: MoneyFlowEdgeCounterpartyKind;
  counterpartyLabel: string;
  amount: Money;
}

interface PendingEdge {
  edge: Omit<MoneyFlowEdge, "amount">;
  amounts: Money[];
}

/**
 * Derives real money-flow edges (founder feedback 2026-09-28, Structure
 * page's "Money Flow" view mode) from an already-assembled
 * `MoneyHistoryEntry[]` -- deliberately built on TOP of
 * `assembleMoneyHistory()`'s already-tested multi-table join and scoping,
 * never a second parallel implementation of the same joins (Open/Closed).
 * Callers pass entries already scoped/filtered exactly as they want them
 * shown (e.g. `assembleMoneyHistory(raw, scope, { projectId })`'s output for
 * one Project, already redacted to one Partner's own self-access slice when
 * `scope` is non-`unrestricted`) -- this function does no authorization of
 * its own.
 *
 * Only `status: "active"` entries contribute -- mirrors
 * `assembleOwnershipStructure`'s own identical `totalIn`/`totalOut` filter
 * (a cancelled transaction never counts toward either). Multiple entries
 * collapsing to the same `(partyType, shareId, direction, counterpartyKind,
 * counterpartyLabel)` are summed into one edge (`sumMoney`, AD-2) so the
 * diagram stays readable regardless of how many funding rounds/legs
 * contributed -- mirrors those same node totals already being aggregates,
 * not one mark per transaction. `counterpartyKind` is part of the key (not
 * just `counterpartyLabel`) so a Project and a "person"/"other" destination
 * that happen to share the exact same display text never silently merge
 * into one edge of the wrong kind.
 *
 * Residual limitation, inherited from `MoneyHistoryEntry`'s own data model
 * (Story 5.1), not introduced here: `to`/`from` are free-text display
 * strings with no stable id (no Person/contact entity exists -- confirmed
 * out of scope for this feature). Two genuinely different real people (or
 * two same-named Projects) sharing the identical label still aggregate into
 * one edge, since nothing in the underlying data can tell them apart --
 * exactly as already true everywhere else "given to person" is shown in
 * this app (Money History, Money Trail). Not fixable at this layer without
 * inventing an identity concept the founder already declined for this
 * feature; accepted as a known, pre-existing limitation, not a new one.
 *
 * Entry-type -> edge mapping (see this module's own PR description for the
 * full table): `money_added` only becomes an edge when it has a `from` (a
 * movement-created investment, not a plain manual one -- a plain investment
 * is already reflected in the node's own `totalIn`); `moved_to_project`/
 * `used_from_available_balance` -> outbound to a Project (a balance spend
 * whose destination was actually a Person is the one case this collapses
 * into the same "project" icon -- `MoneyHistoryEntry` itself doesn't
 * preserve that distinction either, so nothing already-shown is lost);
 * `added_to_available_balance` -> outbound to the Available Balance pool;
 * `given_to_person` -> outbound to a Person, or "Other" when
 * `to === "Other"` (the one entry type shared by both destination kinds,
 * per `assembleMoneyHistory`'s own "no 7th type invented" convention).
 * `money_withdrawn` and `adjustment` never produce an edge of their own --
 * a withdrawal's own destination legs (the other four types) already carry
 * where it went; an adjustment is a Should-Pay/Can-Take bookkeeping record,
 * never a fund movement.
 */
export function deriveMoneyFlowEdges(entries: readonly MoneyHistoryEntry[]): MoneyFlowEdge[] {
  const byKey = new Map<string, PendingEdge>();

  function add(
    partyType: "partner" | "sub_partner",
    shareId: string,
    direction: MoneyFlowEdgeDirection,
    counterpartyKind: MoneyFlowEdgeCounterpartyKind,
    counterpartyLabel: string,
    amount: Money,
  ): void {
    const key = `${partyType}:${shareId}:${direction}:${counterpartyKind}:${counterpartyLabel}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.amounts.push(amount);
      return;
    }
    byKey.set(key, {
      edge: { id: key, partyType, shareId, direction, counterpartyKind, counterpartyLabel },
      amounts: [amount],
    });
  }

  for (const entry of entries) {
    if (entry.status !== "active") {
      continue;
    }

    switch (entry.type) {
      case "money_added":
        if (entry.from !== null) {
          add(entry.partyType, entry.shareId, "in", "project", entry.from, entry.amount);
        }
        break;
      case "moved_to_project":
      case "used_from_available_balance":
        if (entry.to !== null) {
          add(entry.partyType, entry.shareId, "out", "project", entry.to, entry.amount);
        }
        break;
      case "added_to_available_balance":
        if (entry.to !== null) {
          add(entry.partyType, entry.shareId, "out", "available_balance", entry.to, entry.amount);
        }
        break;
      case "given_to_person":
        if (entry.to !== null) {
          add(
            entry.partyType,
            entry.shareId,
            "out",
            entry.to === "Other" ? "other" : "person",
            entry.to,
            entry.amount,
          );
        }
        break;
      case "money_withdrawn":
      case "adjustment":
        break;
    }
  }

  return [...byKey.values()].map(({ edge, amounts }) => ({ ...edge, amount: sumMoney(amounts) }));
}

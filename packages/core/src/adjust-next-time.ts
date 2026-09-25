import type { InvestmentAdjustment, WithdrawalAdjustment } from "@niveshbook/types";
import { moneyHistoryShareKey, type MoneyHistoryScope } from "./money-history";

/**
 * Every already-fetched `InvestmentAdjustment`/`WithdrawalAdjustment` list
 * `filterAdjustNextTimeByScope()` needs (Story 5.3, FR33/FR34) -- both
 * lists come from the new `listAll()` port methods, unfiltered, across every
 * Project; scoping to the actor's own rows happens here, not at the DB
 * layer (mirrors `MoneyHistoryRawData`'s identical "already fetched, pure
 * assembly" shape, AD-9).
 */
export interface AdjustNextTimeRawData {
  investmentAdjustments: readonly InvestmentAdjustment[];
  withdrawalAdjustments: readonly WithdrawalAdjustment[];
}

export interface AdjustNextTimeResult {
  investmentAdjustments: InvestmentAdjustment[];
  withdrawalAdjustments: WithdrawalAdjustment[];
}

/**
 * The Adjust Next Time page's own scoped Investment/Withdrawal Adjustment
 * lists (Story 5.3, FR33/FR34) -- pure (AD-9), no DB access. Reuses Story
 * 5.1's `MoneyHistoryScope`/`resolveMoneyHistoryScope()` UNCHANGED (spec-5-3's
 * Code Map is explicit: "no new scope-resolution logic") -- the scoping
 * shape (which `(partyType, shareId, projectId)` triples the actor may see)
 * is identical between Money History and this page, so a second, duplicate
 * resolver would only invite drift. `moneyHistoryShareKey` (exported from
 * `money-history.ts` for exactly this reuse) builds the identical
 * `(partyType, shareId, projectId)` key both `InvestmentAdjustment` and
 * `WithdrawalAdjustment` rows already carry.
 *
 * Unlike `assembleMoneyHistory()`, there is no cross-table entry assembly
 * here -- Investment and Withdrawal Adjustment stay two entirely separate,
 * independently-filtered lists, never merged/summed (AC3, this story's
 * Boundaries: "no combined/summed figure anywhere on the page"). A person
 * with multiple active funding requirements naturally keeps multiple
 * separate `InvestmentAdjustment` rows here too -- this function filters by
 * scope only, it never reduces/dedupes by person (this story's I/O matrix:
 * "Two separate Investment section rows for that person ... never merged").
 */
export function filterAdjustNextTimeByScope(
  raw: AdjustNextTimeRawData,
  scope: MoneyHistoryScope,
): AdjustNextTimeResult {
  function inScope(partyType: "partner" | "sub_partner", shareId: string, projectId: string): boolean {
    return scope.unrestricted || scope.shareKeys.has(moneyHistoryShareKey(partyType, shareId, projectId));
  }

  return {
    investmentAdjustments: raw.investmentAdjustments.filter((row) =>
      inScope(row.partyType, row.shareId, row.projectId),
    ),
    withdrawalAdjustments: raw.withdrawalAdjustments.filter((row) =>
      inScope(row.partyType, row.shareId, row.projectId),
    ),
  };
}

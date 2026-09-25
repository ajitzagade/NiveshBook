import type {
  AvailableBalance,
  InvestmentAdjustment,
  InvestmentTransaction,
  Money,
  Percent,
  SubPartnerShare,
  WithdrawalAdjustment,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { sumMoney } from "./decimal-math";

/**
 * Every already-fetched raw row list `assembleSubPartnerDashboard()` needs
 * (Story 5.6, FR37) -- pure, no DB access (AD-9), mirrors
 * `PartnerDashboardRawData`'s exact "pure function, pre-fetched data" shape
 * one role over (Story 5.5). Unlike that module, there's no
 * `currentPartnerShares` input at all -- this dashboard has no reason to
 * touch the Partner Shares table (this story's frozen Decisions #7): "My
 * Sub-partners" has no equivalent for a Sub-partner actor (Decisions #3),
 * and no parent-Partner data is ever surfaced here (Decisions #4).
 *
 * `investmentAdjustments`/`withdrawalAdjustments` are Story 5.3's existing
 * `listAll()` sources (`InvestmentAdjustmentPort`/`WithdrawalAdjustmentPort`),
 * reused unchanged for the Pending/Extra Paid/Keep for Later/Extra Taken
 * totals.
 */
export interface SubPartnerDashboardRawData {
  investmentTransactions: readonly InvestmentTransaction[];
  withdrawalTransactions: readonly WithdrawalTransaction[];
  availableBalances: readonly AvailableBalance[];
  investmentAdjustments: readonly InvestmentAdjustment[];
  withdrawalAdjustments: readonly WithdrawalAdjustment[];
  /** Current Sub-partner Shares, across every Project (`listAllCurrentSubPartnerShares()`, unchanged) -- filtered internally to `userId === actorUserId` to resolve the actor's own set. */
  currentSubPartnerShares: readonly SubPartnerShare[];
  projectNamesById: Readonly<Record<string, string>>;
}

/** One row per Project the actor is linked to as a Sub-partner (frozen Decisions #6: "a per-Project breakdown list", never aggregated into one row) -- `subPartnerId` is minted fresh per Project, so a Sub-partner linked to 3 Projects has 3 separate rows here. */
export interface SubPartnerDashboardProjectRow {
  projectId: string;
  projectName: string;
  /** The stable `SubPartnerShare.subPartnerId` for this Project -- never `User.id` (AD-4). */
  subPartnerId: string;
  sharePercent: Percent;
}

/**
 * The Sub-partner Dashboard's full assembled shape (Story 5.6, FR37) --
 * `myProjects` is a per-Project breakdown; the 6 money totals below are
 * aggregate sums across every one of the actor's own `subPartnerId`s
 * (frozen Decisions #6). No `mySubPartners`-shaped field -- that category
 * doesn't exist for this role (frozen Decisions #3).
 */
export interface SubPartnerDashboardSummary {
  myProjects: SubPartnerDashboardProjectRow[];
  /** Sum of every `status: "active"` `investment_transactions.amount` row across every one of the actor's own `subPartnerId`s. */
  totalMoneyAdded: Money;
  /** Sum of every `status: "active"` `withdrawal_transactions.amount` row across every one of the actor's own `subPartnerId`s. */
  totalMoneyWithdrawn: Money;
  /** Sum of every `available_balances.balance` row across every one of the actor's own `subPartnerId`s (unfiltered -- that table has no `status` column). */
  totalAvailableBalance: Money;
  /** Sum of every current `investment_adjustments` row with `adjustmentType: "pending"`, across every one of the actor's own `subPartnerId`s. Never netted against `totalExtraPaid` (AD-4). */
  totalPending: Money;
  /** Sum of every current `investment_adjustments` row with `adjustmentType: "extra_paid"`. Never netted against `totalPending` (AD-4). */
  totalExtraPaid: Money;
  /** Sum of every current `withdrawal_adjustments` row with `adjustmentType: "keep_for_later"`. Never netted against `totalExtraTaken` (AD-4). */
  totalKeepForLater: Money;
  /** Sum of every current `withdrawal_adjustments` row with `adjustmentType: "extra_taken"` -- computed for AD-4 completeness (mirrors `totalKeepForLater`'s identical three-way `adjustmentType` split one column over), even though it isn't one of this story's frozen AC's 8 named data points; `apps/web`'s own page is not obligated to render it, mirroring `assemblePartnerDashboard()`'s own identical precedent. Never netted against `totalKeepForLater` (AD-4). */
  totalExtraTaken: Money;
}

const UNKNOWN_PROJECT_NAME = "Unknown Project";

/**
 * Assembles a Sub-partner's own scoped dashboard (Story 5.6, FR37) -- pure
 * (AD-9), no DB access: every row this function reads is already fetched,
 * bundled in `raw`. Mirrors `assemblePartnerDashboard()`'s exact "filter
 * current Shares by `userId === actorUserId` (case-insensitive) to build a
 * Set of the actor's own share ids, then filter every transaction/
 * adjustment/balance row by `partyType` + `shareId` membership in that set"
 * pattern one role over (Story 5.5) -- a new, separate function rather than
 * a role parameter added to `assemblePartnerDashboard()` (this story's own
 * frozen Decisions #7).
 *
 * Every money sum uses `sumMoney` (AD-2) -- never raw arithmetic.
 * `totalMoneyAdded`/`totalMoneyWithdrawn` (and the adjustment totals) only
 * count rows belonging to one of the actor's own `subPartnerId`s, with
 * `partyType: "sub_partner"` -- the actor's own parent Partner's activity,
 * and any sibling Sub-partner's activity under the same parent, are
 * NEVER rolled into these totals (this story's frozen Decisions #4 / AC:
 * "no visibility into other Partners or Sub-partners").
 */
export function assembleSubPartnerDashboard(
  actorUserId: string,
  raw: SubPartnerDashboardRawData,
): SubPartnerDashboardSummary {
  const mySubPartnerShares = raw.currentSubPartnerShares.filter(
    (share) => share.userId && share.userId.toLowerCase() === actorUserId.toLowerCase(),
  );
  const mySubPartnerIds = new Set(mySubPartnerShares.map((share) => share.subPartnerId));

  const myProjects: SubPartnerDashboardProjectRow[] = mySubPartnerShares.map((share) => ({
    projectId: share.projectId,
    projectName: raw.projectNamesById[share.projectId] ?? UNKNOWN_PROJECT_NAME,
    subPartnerId: share.subPartnerId,
    sharePercent: share.sharePercent,
  }));

  function isMine(partyType: "partner" | "sub_partner", shareId: string): boolean {
    return partyType === "sub_partner" && mySubPartnerIds.has(shareId);
  }

  const myActiveInvestments = raw.investmentTransactions.filter(
    (tx) => tx.status === "active" && isMine(tx.partyType, tx.shareId),
  );
  const myActiveWithdrawals = raw.withdrawalTransactions.filter(
    (tx) => tx.status === "active" && isMine(tx.partyType, tx.shareId),
  );
  const myAvailableBalances = raw.availableBalances.filter((balance) => isMine(balance.partyType, balance.shareId));
  const myInvestmentAdjustments = raw.investmentAdjustments.filter((adj) => isMine(adj.partyType, adj.shareId));
  const myWithdrawalAdjustments = raw.withdrawalAdjustments.filter((adj) => isMine(adj.partyType, adj.shareId));

  return {
    myProjects,
    totalMoneyAdded: sumMoney(myActiveInvestments.map((tx) => tx.amount)),
    totalMoneyWithdrawn: sumMoney(myActiveWithdrawals.map((tx) => tx.amount)),
    totalAvailableBalance: sumMoney(myAvailableBalances.map((balance) => balance.balance)),
    totalPending: sumMoney(
      myInvestmentAdjustments.filter((adj) => adj.adjustmentType === "pending").map((adj) => adj.adjustmentAmount),
    ),
    totalExtraPaid: sumMoney(
      myInvestmentAdjustments.filter((adj) => adj.adjustmentType === "extra_paid").map((adj) => adj.adjustmentAmount),
    ),
    totalKeepForLater: sumMoney(
      myWithdrawalAdjustments
        .filter((adj) => adj.adjustmentType === "keep_for_later")
        .map((adj) => adj.adjustmentAmount),
    ),
    totalExtraTaken: sumMoney(
      myWithdrawalAdjustments.filter((adj) => adj.adjustmentType === "extra_taken").map((adj) => adj.adjustmentAmount),
    ),
  };
}

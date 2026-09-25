import type {
  AvailableBalance,
  InvestmentAdjustment,
  InvestmentTransaction,
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
  WithdrawalAdjustment,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { sumMoney } from "./decimal-math";

/**
 * Every already-fetched raw row list `assemblePartnerDashboard()` needs
 * (Story 5.5, FR36) -- pure, no DB access (AD-9), mirrors
 * `OwnerAdminDashboardRawData`'s exact "pure function, pre-fetched data"
 * shape one level down (Story 5.4). Unlike that module, there's no
 * `currentSubPartnerShares`-as-rollup-key use here -- a Partner's own
 * Sub-partners are listed structurally (`mySubPartners`), never rolled into
 * the Partner's own financial totals (this story's frozen Decisions #3/#5:
 * "My Sub-partners" is a structural list, not a financial rollup -- a
 * Sub-partner's own money stays theirs, tracked separately, exactly as
 * `resolveMoneyHistoryScope()` already treats every share independently).
 *
 * `investmentAdjustments`/`withdrawalAdjustments` are Story 5.3's existing
 * `listAll()` sources (`InvestmentAdjustmentPort`/`WithdrawalAdjustmentPort`),
 * reused unchanged for the Pending/Extra Paid/Keep for Later/Extra Taken
 * totals.
 */
export interface PartnerDashboardRawData {
  investmentTransactions: readonly InvestmentTransaction[];
  withdrawalTransactions: readonly WithdrawalTransaction[];
  availableBalances: readonly AvailableBalance[];
  investmentAdjustments: readonly InvestmentAdjustment[];
  withdrawalAdjustments: readonly WithdrawalAdjustment[];
  /** Current Partner Shares, across every Project (`listAllCurrentPartnerShares()`, Story 2.7) -- filtered internally to `userId === actorUserId` to resolve the actor's own set. */
  currentPartnerShares: readonly PartnerShare[];
  /** Current Sub-partner Shares, across every Project (`listAllCurrentSubPartnerShares()`) -- filtered internally to `partnerId` in the actor's own resolved set for `mySubPartners`. */
  currentSubPartnerShares: readonly SubPartnerShare[];
  projectNamesById: Readonly<Record<string, string>>;
}

/** One row per Project the actor is linked to as a Partner (frozen Decisions #5: "a per-Project breakdown list", never aggregated into one row) -- `partnerId` is minted fresh per Project, so a Partner linked to 3 Projects has 3 separate rows here. */
export interface PartnerDashboardProjectRow {
  projectId: string;
  projectName: string;
  /** The stable `PartnerShare.partnerId` for this Project -- never `User.id` (AD-4). */
  partnerId: string;
  sharePercent: Percent;
}

/** One row per current Sub-partner under one of the actor's own current Partner Shares -- structural only, no financial figures (this story's frozen Decisions #5). */
export interface PartnerDashboardSubPartnerRow {
  /** The stable `SubPartnerShare.subPartnerId` -- exported for a stable list key; not part of the frozen Code Map's own shape but a harmless, documented widening (mirrors `OwnerAdminDashboardRawData`'s own precedent of a documented Code Map widening, Story 5.4's Implementation Notes). */
  subPartnerId: string;
  name: string;
  sharePercent: Percent;
  projectName: string;
}

/**
 * The Partner Dashboard's full assembled shape (Story 5.5, FR36) --
 * `myProjects` is a per-Project breakdown; the 6 money totals below are
 * aggregate sums across every one of the actor's own `partnerId`s (frozen
 * Decisions #5); `mySubPartners` is a flat structural list.
 */
export interface PartnerDashboardSummary {
  myProjects: PartnerDashboardProjectRow[];
  /** Sum of every `status: "active"` `investment_transactions.amount` row across every one of the actor's own `partnerId`s. */
  totalMoneyAdded: Money;
  /** Sum of every `status: "active"` `withdrawal_transactions.amount` row across every one of the actor's own `partnerId`s. */
  totalMoneyWithdrawn: Money;
  /** Sum of every `available_balances.balance` row across every one of the actor's own `partnerId`s (unfiltered -- that table has no `status` column). */
  totalAvailableBalance: Money;
  /** Sum of every current `investment_adjustments` row with `adjustmentType: "pending"`, across every one of the actor's own `partnerId`s. Never netted against `totalExtraPaid` (AD-4). */
  totalPending: Money;
  /** Sum of every current `investment_adjustments` row with `adjustmentType: "extra_paid"`. Never netted against `totalPending` (AD-4). */
  totalExtraPaid: Money;
  /** Sum of every current `withdrawal_adjustments` row with `adjustmentType: "keep_for_later"`. Never netted against `totalExtraTaken` (AD-4). */
  totalKeepForLater: Money;
  /** Sum of every current `withdrawal_adjustments` row with `adjustmentType: "extra_taken"` -- computed for AD-4 completeness (mirrors `totalKeepForLater`'s identical three-way `adjustmentType` split one column over) even though it isn't one of this story's frozen AC's 9 named data points; `apps/web`'s own page is not obligated to render it (see this story's Implementation Notes). Never netted against `totalKeepForLater` (AD-4). */
  totalExtraTaken: Money;
  mySubPartners: PartnerDashboardSubPartnerRow[];
}

const UNKNOWN_PROJECT_NAME = "Unknown Project";

/**
 * Assembles a Partner's own scoped dashboard (Story 5.5, FR36) -- pure
 * (AD-9), no DB access: every row this function reads is already fetched,
 * bundled in `raw`. Mirrors `assembleOwnerAdminDashboard()`'s "pure
 * function, already-fetched `listAll()` data in, derived summary out"
 * shape one level down, and `resolveMoneyHistoryScope()`'s "filter shares
 * by `userId === actorUserId`, case-insensitively" approach for resolving
 * "my own current Partner Shares" (Story 5.1) -- reimplemented here rather
 * than reused, since this function's output shape (a `PartnerDashboardSummary`)
 * is entirely different from `MoneyHistoryScope`'s.
 *
 * Every money sum uses `sumMoney` (AD-2) -- never raw arithmetic.
 * `totalMoneyAdded`/`totalMoneyWithdrawn` (and the adjustment totals) only
 * count rows belonging to one of the actor's own `partnerId`s, with
 * `partyType: "partner"` -- a Sub-partner's own activity is deliberately
 * NEVER rolled into these totals (unlike `assembleOwnerAdminDashboard()`'s
 * own Story 5.4 Sub-partner-rolls-into-parent-Partner rollup, which is that
 * story's own separately-frozen decision, not a system-wide default): this
 * story's frozen Decisions #3/#5 treat "My Sub-partners" as a structural
 * list only, and a Sub-partner's money is tracked under its own `shareId`,
 * belonging to whoever that Sub-partner actually is.
 */
export function assemblePartnerDashboard(actorUserId: string, raw: PartnerDashboardRawData): PartnerDashboardSummary {
  const myPartnerShares = raw.currentPartnerShares.filter(
    (share) => share.userId && share.userId.toLowerCase() === actorUserId.toLowerCase(),
  );
  const myPartnerIds = new Set(myPartnerShares.map((share) => share.partnerId));

  const myProjects: PartnerDashboardProjectRow[] = myPartnerShares.map((share) => ({
    projectId: share.projectId,
    projectName: raw.projectNamesById[share.projectId] ?? UNKNOWN_PROJECT_NAME,
    partnerId: share.partnerId,
    sharePercent: share.sharePercent,
  }));

  function isMine(partyType: "partner" | "sub_partner", shareId: string): boolean {
    return partyType === "partner" && myPartnerIds.has(shareId);
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

  const mySubPartners: PartnerDashboardSubPartnerRow[] = raw.currentSubPartnerShares
    .filter((sub) => myPartnerIds.has(sub.partnerId))
    .map((sub) => ({
      subPartnerId: sub.subPartnerId,
      name: sub.name,
      sharePercent: sub.sharePercent,
      projectName: raw.projectNamesById[sub.projectId] ?? UNKNOWN_PROJECT_NAME,
    }));

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
    mySubPartners,
  };
}

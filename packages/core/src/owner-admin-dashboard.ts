import type {
  AvailableBalance,
  InvestmentTransaction,
  Money,
  PartnerShare,
  SubPartnerShare,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { compareMoney, subtractMoney, sumMoney } from "./decimal-math";

/**
 * Every already-fetched raw row list `assembleOwnerAdminDashboard()` needs
 * (Story 5.4, FR35) -- pure, no DB access (AD-9), mirrors `MoneyHistoryRawData`'s
 * exact "pure function, pre-fetched data" shape (Story 5.1).
 *
 * `currentSubPartnerShares`/`projectNamesById` are a documented widening of
 * this story's original spec Code Map (which only listed
 * `investmentTransactions`/`withdrawalTransactions`/`availableBalances`/
 * `currentPartnerShares`) -- see this story's Implementation Notes, mirroring
 * `money-history.ts`'s own identical, already-precedented widening of its
 * spec's Code Map. `currentSubPartnerShares` is required to resolve a
 * Sub-partner's own `subPartnerId` back to their parent Partner's
 * `partnerId` for the rollup (this story's Decisions #2/frozen I/O matrix
 * row 6) -- `SubPartnerShare.partnerId` is the only place that mapping
 * exists. `projectNamesById` resolves each `PartnerOverviewRow.projectName`,
 * mirroring `MoneyHistoryRawData.projectNamesById`'s identical role and key
 * shape (`project.id -> project.name`, current Projects only -- there is no
 * "old" Project name to resolve, unlike a Partner/Sub-partner Share's own
 * versioned name).
 */
export interface OwnerAdminDashboardRawData {
  investmentTransactions: readonly InvestmentTransaction[];
  withdrawalTransactions: readonly WithdrawalTransaction[];
  availableBalances: readonly AvailableBalance[];
  /** Current Partner Shares only (`listAllCurrentPartnerShares()`, Story 2.7) -- never a stale prior version (this story's Boundaries). One `PartnerOverviewRow` per entry. */
  currentPartnerShares: readonly PartnerShare[];
  /** Current Sub-partner Shares only (`listAllCurrentSubPartnerShares()`, Story 5.1) -- used ONLY to resolve the Sub-partner-rolls-into-parent-Partner rollup (this story's Decisions #2); no Sub-partner ever gets its own `PartnerOverviewRow`. */
  currentSubPartnerShares: readonly SubPartnerShare[];
  projectNamesById: Readonly<Record<string, string>>;
}

/**
 * One partner-wise overview row (Story 5.4, FR35) -- one per CURRENT
 * top-level Partner Share (never per real person, never a Sub-partner row --
 * this story's Decisions #2/frozen I/O matrix row 5/6). `invested`/
 * `withdrawn`/`availableBalance` roll up this Partner's own activity PLUS
 * every one of their current Sub-partners' own activity (frozen I/O matrix
 * row 6) -- money still "theirs" at the Partner level for this rollup, even
 * though the Sub-partner recorded it directly.
 */
export interface PartnerOverviewRow {
  /** The stable `PartnerShare.partnerId` -- never `User.id` (AD-4). */
  partnerId: string;
  name: string;
  projectId: string;
  projectName: string;
  /** Sum of every `status: "active"` `investment_transactions` row for this Partner, plus every current Sub-partner rolled up into them. */
  invested: Money;
  /** Sum of every `status: "active"` `withdrawal_transactions` row for this Partner, plus every current Sub-partner rolled up into them. */
  withdrawn: Money;
  /** Sum of every `available_balances` row for this Partner, plus every current Sub-partner rolled up into them (that table has no `status` column -- it's a live ledger, not a transaction list). */
  availableBalance: Money;
  /**
   * `invested - withdrawn` for this row, clamped to `"0"` via the identical
   * `compareMoney`-then-`subtractMoney` defensive pattern as the headline
   * `OwnerAdminDashboardSummary.totalProjectMoney` (this story's Decisions
   * #1) -- the per-Partner analog of that same number, one row down. Review
   * finding (2026-09-25): originally computed in `apps/web/home/page.tsx`
   * itself, duplicating this exact clamp pattern with zero test coverage --
   * moved here so it's covered by this module's own pure-function tests
   * alongside every other money-math clamp, and the page just reads this
   * field instead of recomputing it.
   */
  netPosition: Money;
}

/** The Owner/Admin Dashboard's full assembled shape (Story 5.4, FR35) -- 4 system-wide stat-card numbers plus the partner-wise overview. */
export interface OwnerAdminDashboardSummary {
  /** `Total Added - Total Withdrawn`, system-wide, clamped to `"0"` rather than thrown if withdrawn ever exceeds added (a data-integrity edge case -- mirrors Story 4.9's Can Take fix's exact `compareMoney`-then-`subtractMoney` pattern, this story's Decisions #1). */
  totalProjectMoney: Money;
  /** Sum of every `status: "active"` `investment_transactions.amount` row, system-wide. */
  totalAdded: Money;
  /** Sum of every `status: "active"` `withdrawal_transactions.amount` row, system-wide. */
  totalWithdrawn: Money;
  /** Sum of every `available_balances.balance` row, system-wide (unfiltered -- that table has no `status` column). */
  totalAvailableBalance: Money;
  /** One row per current top-level Partner Share -- `[]` when there are none (the zero-Partner-Shares case; `apps/web`'s page renders `EmptyState` for this, not this module's own concern). */
  partnerOverview: PartnerOverviewRow[];
}

const UNKNOWN_PROJECT_NAME = "Unknown Project";

/** Appends `value` to the array keyed by `key` in `map`, creating a fresh one-element array on first use -- a small, self-contained grouping helper (this module's own, not shared -- mirrors this codebase's established per-module local-helper convention, e.g. `can-take/route.ts`'s `groupByPartnerId`). */
function pushToGroup<K>(map: Map<K, Money[]>, key: K, value: Money): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Resolves the top-level Partner `partnerId` a `(partyType, shareId)` pair's
 * activity should roll up into for the partner-wise overview (frozen I/O
 * matrix row 6): a `"partner"` row rolls up into itself (`shareId` already
 * IS a `partnerId`); a `"sub_partner"` row rolls up into its parent Partner,
 * resolved via `parentPartnerIdBySubPartnerId` (built from
 * `currentSubPartnerShares`). Returns `null` for a Sub-partner row whose
 * parent can't be resolved (a data-integrity edge case outside this story's
 * scope, e.g. a stale/orphaned row) -- callers skip it rather than throwing,
 * mirroring `money-history.ts`'s `buildWithdrawalDestinationAllocationEntries`'s
 * identical "skip, stay total" convention for an unresolvable parent link.
 */
function resolveOverviewPartnerId(
  partyType: "partner" | "sub_partner",
  shareId: string,
  parentPartnerIdBySubPartnerId: ReadonlyMap<string, string>,
): string | null {
  if (partyType === "partner") {
    return shareId;
  }
  return parentPartnerIdBySubPartnerId.get(shareId) ?? null;
}

/**
 * Assembles the Owner/Admin Dashboard (Story 5.4, FR35) -- pure (AD-9), no DB
 * access: every row this function reads is already fetched, bundled in
 * `raw`. Mirrors `assembleMoneyHistory()`'s "pure function takes
 * already-fetched `listAll()` data, produces a derived summary" shape (Story
 * 5.1).
 *
 * Every money sum uses `sumMoney`/`subtractMoney`/`compareMoney` (AD-2) --
 * never raw arithmetic. `totalAdded`/`totalWithdrawn` (and each
 * `PartnerOverviewRow.invested`/`.withdrawn`) only count `status: "active"`
 * rows (this story's Boundaries) -- `availableBalances` is summed
 * unconditionally, since that table has no `status` column (it's a live
 * ledger, not a transaction list).
 */
export function assembleOwnerAdminDashboard(raw: OwnerAdminDashboardRawData): OwnerAdminDashboardSummary {
  const activeInvestments = raw.investmentTransactions.filter((tx) => tx.status === "active");
  const activeWithdrawals = raw.withdrawalTransactions.filter((tx) => tx.status === "active");

  const totalAdded = sumMoney(activeInvestments.map((tx) => tx.amount));
  const totalWithdrawn = sumMoney(activeWithdrawals.map((tx) => tx.amount));
  const totalProjectMoney =
    compareMoney(totalAdded, totalWithdrawn) >= 0
      ? subtractMoney(totalAdded, totalWithdrawn)
      : ("0" as Money);
  const totalAvailableBalance = sumMoney(raw.availableBalances.map((balance) => balance.balance));

  const parentPartnerIdBySubPartnerId = new Map<string, string>();
  for (const subPartnerShare of raw.currentSubPartnerShares) {
    parentPartnerIdBySubPartnerId.set(subPartnerShare.subPartnerId, subPartnerShare.partnerId);
  }

  const investedByPartnerId = new Map<string, Money[]>();
  const withdrawnByPartnerId = new Map<string, Money[]>();
  const availableBalanceByPartnerId = new Map<string, Money[]>();

  for (const tx of activeInvestments) {
    const partnerId = resolveOverviewPartnerId(tx.partyType, tx.shareId, parentPartnerIdBySubPartnerId);
    if (partnerId) {
      pushToGroup(investedByPartnerId, partnerId, tx.amount);
    }
  }
  for (const tx of activeWithdrawals) {
    const partnerId = resolveOverviewPartnerId(tx.partyType, tx.shareId, parentPartnerIdBySubPartnerId);
    if (partnerId) {
      pushToGroup(withdrawnByPartnerId, partnerId, tx.amount);
    }
  }
  for (const balance of raw.availableBalances) {
    const partnerId = resolveOverviewPartnerId(balance.partyType, balance.shareId, parentPartnerIdBySubPartnerId);
    if (partnerId) {
      pushToGroup(availableBalanceByPartnerId, partnerId, balance.balance);
    }
  }

  const partnerOverview: PartnerOverviewRow[] = raw.currentPartnerShares.map((share) => {
    const invested = sumMoney(investedByPartnerId.get(share.partnerId) ?? []);
    const withdrawn = sumMoney(withdrawnByPartnerId.get(share.partnerId) ?? []);
    return {
      partnerId: share.partnerId,
      name: share.name,
      projectId: share.projectId,
      projectName: raw.projectNamesById[share.projectId] ?? UNKNOWN_PROJECT_NAME,
      invested,
      withdrawn,
      availableBalance: sumMoney(availableBalanceByPartnerId.get(share.partnerId) ?? []),
      netPosition: compareMoney(invested, withdrawn) >= 0 ? subtractMoney(invested, withdrawn) : ("0" as Money),
    };
  });

  return {
    totalProjectMoney,
    totalAdded,
    totalWithdrawn,
    totalAvailableBalance,
    partnerOverview,
  };
}

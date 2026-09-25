import type {
  AvailableBalance,
  InvestmentTransaction,
  Money,
  MoneyHistoryEntry,
  PartnerShare,
  PaymentMode,
  Percent,
  Project,
  SubPartnerShare,
  UserRole,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { sumMoney } from "./decimal-math";
import { moneyHistoryPersonNameKey } from "./money-history";

const UNKNOWN_PROJECT_NAME = "Unknown Project";

/**
 * Story 5.7 (FR38/FR39, Epic 5): the 4 genuinely-new report aggregations
 * (Project Money, Partner, Sub-partner, Available Balance) -- the other 6
 * report types (Money History, Money Added, Withdrawal, Money Movement,
 * Adjustment, Payment Mode) are thin filters/groupings over the EXISTING
 * `assembleMoneyHistory()`/`resolveMoneyHistoryScope()` (Story 5.1), applied
 * by the route directly, and need no new module (spec-5-7's Decisions #3).
 *
 * Every function here is pure (AD-9), no DB access -- every row it reads is
 * already fetched, bundled in its own `raw` parameter, mirroring every prior
 * Epic 5 assemble-function's identical shape. Every money sum uses
 * `sumMoney` (AD-2).
 *
 * All 4 aggregate functions take `actorRole` explicitly (a documented,
 * narrow widening of this story's own Code Map, which only listed
 * `actorRole` on `assembleProjectMoneyReport`'s own signature) -- an
 * `owner_admin` actor's "every row system-wide" behavior is a distinct
 * branch from "my own current Share(s) only", and only the role (not just
 * `actorUserId`) can tell those two apart; `assembleProjectMoneyReport`'s own
 * Code Map signature already needed this, so it's added uniformly to the
 * other three for the same reason, and so all 4 read identically. See this
 * story's Implementation Notes.
 */

// ---------------------------------------------------------------------------
// Payment Mode report (Decision #3's one new second-order pure function)
// ---------------------------------------------------------------------------

/** One row per `PaymentMode` that appears among the entries the actor is permitted to see -- a mode with zero matching entries never appears (no zero-rows). */
export interface PaymentModeReportRow {
  paymentMode: PaymentMode;
  /** Sum of every matching entry's `amount` (`sumMoney`, AD-2). */
  totalAmount: Money;
  entryCount: number;
}

/**
 * Groups an already-assembled, already-scoped `MoneyHistoryEntry[]`
 * (`assembleMoneyHistory()`'s own output -- never raw port data, Decision
 * #3) by `paymentMode`, summing `amount` per mode. Entries with
 * `paymentMode: null` (every type except `"money_added"`/`"money_withdrawn"`)
 * are silently skipped -- they carry no payment mode to group by, not an
 * error case. Does not modify `assembleMoneyHistory()` itself (Open/Closed).
 */
export function assemblePaymentModeReport(entries: readonly MoneyHistoryEntry[]): PaymentModeReportRow[] {
  const amountsByMode = new Map<PaymentMode, Money[]>();

  for (const entry of entries) {
    if (!entry.paymentMode) {
      continue;
    }
    const bucket = amountsByMode.get(entry.paymentMode);
    if (bucket) {
      bucket.push(entry.amount);
    } else {
      amountsByMode.set(entry.paymentMode, [entry.amount]);
    }
  }

  return Array.from(amountsByMode.entries()).map(([paymentMode, amounts]) => ({
    paymentMode,
    totalAmount: sumMoney(amounts),
    entryCount: amounts.length,
  }));
}

// ---------------------------------------------------------------------------
// Shared self-access helper (Decision #4's "fourth application" of the
// established `partner-dashboard.ts`/`sub-partner-dashboard.ts` pattern)
// ---------------------------------------------------------------------------

/** Case-insensitive `userId` match -- mirrors `resolveMoneyHistoryScope()`/`assemblePartnerDashboard()`'s identical convention verbatim. */
function isOwnShare(userId: string | null, actorUserId: string): boolean {
  return Boolean(userId) && userId!.toLowerCase() === actorUserId.toLowerCase();
}

// ---------------------------------------------------------------------------
// Project Money report
// ---------------------------------------------------------------------------

export interface ProjectMoneyReportRawData {
  investmentTransactions: readonly InvestmentTransaction[];
  withdrawalTransactions: readonly WithdrawalTransaction[];
  availableBalances: readonly AvailableBalance[];
  /** Current Partner Shares, across every Project (`listAllCurrentPartnerShares()`). */
  currentPartnerShares: readonly PartnerShare[];
  /** Current Sub-partner Shares, across every Project (`listAllCurrentSubPartnerShares()`). */
  currentSubPartnerShares: readonly SubPartnerShare[];
  /** Every Project (`projectPort.listProjects()`) -- `owner_admin`'s row set is every Project here, regardless of whether it has any current Shares yet. */
  projects: readonly Project[];
}

/** One row per Project (frozen Decisions #4: never aggregated system-wide into one number here -- that's the Home dashboards' own job). */
export interface ProjectMoneyReportRow {
  projectId: string;
  projectName: string;
  /** Sum of every `status: "active"` `investment_transactions.amount` row in scope for this Project. */
  totalAdded: Money;
  /** Sum of every `status: "active"` `withdrawal_transactions.amount` row in scope for this Project. */
  totalWithdrawn: Money;
  /** Sum of every `available_balances.balance` row in scope for this Project (unfiltered -- no `status` column). */
  totalAvailableBalance: Money;
}

/**
 * Assembles the Project Money report (Story 5.7, FR38/FR39) -- one row per
 * Project. `owner_admin`: every Project system-wide, each row summing EVERY
 * party's activity on that Project (not just one Partner's). `partner`/
 * `sub_partner`: one row per Project the actor has a current Share on
 * (partner or sub-partner, mirroring `resolveMoneyHistoryScope()`'s own
 * "check both share tables" convention), each row summing ONLY the actor's
 * own money on that Project -- never another party's, even when they share
 * the Project (this story's single most security-sensitive property).
 */
export function assembleProjectMoneyReport(
  actorRole: UserRole,
  actorUserId: string,
  raw: ProjectMoneyReportRawData,
): ProjectMoneyReportRow[] {
  const myPartnerIds = new Set(
    raw.currentPartnerShares.filter((s) => isOwnShare(s.userId, actorUserId)).map((s) => s.partnerId),
  );
  const mySubPartnerIds = new Set(
    raw.currentSubPartnerShares.filter((s) => isOwnShare(s.userId, actorUserId)).map((s) => s.subPartnerId),
  );

  function isInScope(partyType: "partner" | "sub_partner", shareId: string): boolean {
    if (actorRole === "owner_admin") {
      return true;
    }
    return partyType === "partner" ? myPartnerIds.has(shareId) : mySubPartnerIds.has(shareId);
  }

  const projectIds =
    actorRole === "owner_admin"
      ? raw.projects.map((project) => project.id)
      : Array.from(
          new Set([
            ...raw.currentPartnerShares
              .filter((s) => myPartnerIds.has(s.partnerId))
              .map((s) => s.projectId),
            ...raw.currentSubPartnerShares
              .filter((s) => mySubPartnerIds.has(s.subPartnerId))
              .map((s) => s.projectId),
          ]),
        );

  const projectNamesById = Object.fromEntries(raw.projects.map((project) => [project.id, project.name]));

  return projectIds.map((projectId) => {
    const added = raw.investmentTransactions.filter(
      (tx) => tx.status === "active" && tx.projectId === projectId && isInScope(tx.partyType, tx.shareId),
    );
    const withdrawn = raw.withdrawalTransactions.filter(
      (tx) => tx.status === "active" && tx.projectId === projectId && isInScope(tx.partyType, tx.shareId),
    );
    const balances = raw.availableBalances.filter(
      (balance) => balance.projectId === projectId && isInScope(balance.partyType, balance.shareId),
    );
    return {
      projectId,
      projectName: projectNamesById[projectId] ?? UNKNOWN_PROJECT_NAME,
      totalAdded: sumMoney(added.map((tx) => tx.amount)),
      totalWithdrawn: sumMoney(withdrawn.map((tx) => tx.amount)),
      totalAvailableBalance: sumMoney(balances.map((balance) => balance.balance)),
    };
  });
}

// ---------------------------------------------------------------------------
// Partner report
// ---------------------------------------------------------------------------

export interface PartnerReportRawData {
  investmentTransactions: readonly InvestmentTransaction[];
  withdrawalTransactions: readonly WithdrawalTransaction[];
  availableBalances: readonly AvailableBalance[];
  currentPartnerShares: readonly PartnerShare[];
  projectNamesById: Readonly<Record<string, string>>;
}

/** One row per current Partner Share (frozen Decisions #4: never rolled up with a Partner's own Sub-partners -- a Sub-partner's money is tracked under its own row, in the Sub-partner report, mirroring `assemblePartnerDashboard()`'s identical "My Sub-partners is structural only" precedent). */
export interface PartnerReportRow {
  partnerId: string;
  name: string;
  projectId: string;
  projectName: string;
  sharePercent: Percent;
  totalAdded: Money;
  totalWithdrawn: Money;
  totalAvailableBalance: Money;
}

/**
 * Assembles the Partner report (Story 5.7, FR38/FR39). `owner_admin`: every
 * current Partner Share system-wide. `partner`: only their own current
 * Partner Share(s). `sub_partner`: naturally `[]` -- a Sub-partner's own
 * `userId` never appears on a `currentPartnerShares` row (Decision #5), so
 * this needs no special-casing to fall out empty.
 */
export function assemblePartnerReport(
  actorRole: UserRole,
  actorUserId: string,
  raw: PartnerReportRawData,
): PartnerReportRow[] {
  const visibleShares =
    actorRole === "owner_admin"
      ? raw.currentPartnerShares
      : raw.currentPartnerShares.filter((s) => isOwnShare(s.userId, actorUserId));

  const addedByShareId = new Map<string, Money[]>();
  const withdrawnByShareId = new Map<string, Money[]>();
  const balanceByShareId = new Map<string, Money[]>();

  for (const tx of raw.investmentTransactions) {
    if (tx.status === "active" && tx.partyType === "partner") {
      pushTo(addedByShareId, tx.shareId, tx.amount);
    }
  }
  for (const tx of raw.withdrawalTransactions) {
    if (tx.status === "active" && tx.partyType === "partner") {
      pushTo(withdrawnByShareId, tx.shareId, tx.amount);
    }
  }
  for (const balance of raw.availableBalances) {
    if (balance.partyType === "partner") {
      pushTo(balanceByShareId, balance.shareId, balance.balance);
    }
  }

  return visibleShares.map((share) => ({
    partnerId: share.partnerId,
    name: share.name,
    projectId: share.projectId,
    projectName: raw.projectNamesById[share.projectId] ?? UNKNOWN_PROJECT_NAME,
    sharePercent: share.sharePercent,
    totalAdded: sumMoney(addedByShareId.get(share.partnerId) ?? []),
    totalWithdrawn: sumMoney(withdrawnByShareId.get(share.partnerId) ?? []),
    totalAvailableBalance: sumMoney(balanceByShareId.get(share.partnerId) ?? []),
  }));
}

// ---------------------------------------------------------------------------
// Sub-partner report
// ---------------------------------------------------------------------------

export interface SubPartnerReportRawData {
  investmentTransactions: readonly InvestmentTransaction[];
  withdrawalTransactions: readonly WithdrawalTransaction[];
  availableBalances: readonly AvailableBalance[];
  /** Needed only to resolve a `partner` actor's own linked Sub-partners (their own current `partnerId`s). */
  currentPartnerShares: readonly PartnerShare[];
  currentSubPartnerShares: readonly SubPartnerShare[];
  projectNamesById: Readonly<Record<string, string>>;
}

/** One row per current Sub-partner Share. */
export interface SubPartnerReportRow {
  subPartnerId: string;
  name: string;
  /** The parent Partner's stable `partnerId` -- lets a viewer see which Partner this Sub-partner rolls up under. */
  partnerId: string;
  projectId: string;
  projectName: string;
  sharePercent: Percent;
  totalAdded: Money;
  totalWithdrawn: Money;
  totalAvailableBalance: Money;
}

/**
 * Assembles the Sub-partner report (Story 5.7, FR38/FR39). `owner_admin`:
 * every current Sub-partner Share system-wide. `partner`: only the current
 * Sub-partner Shares under one of the actor's OWN current Partner Share(s)
 * (mirrors `assemblePartnerDashboard()`'s `mySubPartners` filter, now
 * carrying each Sub-partner's own money too, per Decision #5) -- never a
 * sibling Partner's Sub-partners. `sub_partner`: only their own current
 * Sub-partner Share(s) -- never a parent Partner's row or a sibling
 * Sub-partner's row (Story 5.6's rule, reused).
 */
export function assembleSubPartnerReport(
  actorRole: UserRole,
  actorUserId: string,
  raw: SubPartnerReportRawData,
): SubPartnerReportRow[] {
  let visibleShares: readonly SubPartnerShare[];
  if (actorRole === "owner_admin") {
    visibleShares = raw.currentSubPartnerShares;
  } else if (actorRole === "partner") {
    const myPartnerIds = new Set(
      raw.currentPartnerShares.filter((s) => isOwnShare(s.userId, actorUserId)).map((s) => s.partnerId),
    );
    visibleShares = raw.currentSubPartnerShares.filter((s) => myPartnerIds.has(s.partnerId));
  } else {
    visibleShares = raw.currentSubPartnerShares.filter((s) => isOwnShare(s.userId, actorUserId));
  }

  const addedByShareId = new Map<string, Money[]>();
  const withdrawnByShareId = new Map<string, Money[]>();
  const balanceByShareId = new Map<string, Money[]>();

  for (const tx of raw.investmentTransactions) {
    if (tx.status === "active" && tx.partyType === "sub_partner") {
      pushTo(addedByShareId, tx.shareId, tx.amount);
    }
  }
  for (const tx of raw.withdrawalTransactions) {
    if (tx.status === "active" && tx.partyType === "sub_partner") {
      pushTo(withdrawnByShareId, tx.shareId, tx.amount);
    }
  }
  for (const balance of raw.availableBalances) {
    if (balance.partyType === "sub_partner") {
      pushTo(balanceByShareId, balance.shareId, balance.balance);
    }
  }

  return visibleShares.map((share) => ({
    subPartnerId: share.subPartnerId,
    name: share.name,
    partnerId: share.partnerId,
    projectId: share.projectId,
    projectName: raw.projectNamesById[share.projectId] ?? UNKNOWN_PROJECT_NAME,
    sharePercent: share.sharePercent,
    totalAdded: sumMoney(addedByShareId.get(share.subPartnerId) ?? []),
    totalWithdrawn: sumMoney(withdrawnByShareId.get(share.subPartnerId) ?? []),
    totalAvailableBalance: sumMoney(balanceByShareId.get(share.subPartnerId) ?? []),
  }));
}

// ---------------------------------------------------------------------------
// Available Balance report
// ---------------------------------------------------------------------------

export interface AvailableBalanceReportRawData {
  /** `availableBalancePort.listAll()`, reused directly (Decision #4) -- this report is a scoped re-presentation of that same table, one row per row, never re-derived from transactions. */
  availableBalances: readonly AvailableBalance[];
  currentPartnerShares: readonly PartnerShare[];
  currentSubPartnerShares: readonly SubPartnerShare[];
  projectNamesById: Readonly<Record<string, string>>;
  /** Keyed by `moneyHistoryPersonNameKey(shareId, projectId)` -- reused verbatim from `money-history.ts` (Decision #3's "reuse" ethos, one level over) so this module never re-derives its own name-lookup convention. */
  partnerNamesById: Readonly<Record<string, string>>;
  subPartnerNamesById: Readonly<Record<string, string>>;
}

/** One row per current `AvailableBalance` row visible to the actor. */
export interface AvailableBalanceReportRow {
  partyType: "partner" | "sub_partner";
  shareId: string;
  name: string;
  projectId: string;
  projectName: string;
  balance: Money;
}

/**
 * Assembles the Available Balance report (Story 5.7, FR38/FR39) --
 * `owner_admin`: every `AvailableBalance` row system-wide. `partner`/
 * `sub_partner`: only rows for their own current Share(s) -- checking BOTH
 * share tables (mirrors `resolveMoneyHistoryScope()`'s identical
 * "the same userId could be linked to a Partner Share on one Project and a
 * Sub-partner Share on another" convention), never another party's balance
 * even when it's on a Project they share.
 */
export function assembleAvailableBalanceReport(
  actorRole: UserRole,
  actorUserId: string,
  raw: AvailableBalanceReportRawData,
): AvailableBalanceReportRow[] {
  const myPartnerIds = new Set(
    raw.currentPartnerShares.filter((s) => isOwnShare(s.userId, actorUserId)).map((s) => s.partnerId),
  );
  const mySubPartnerIds = new Set(
    raw.currentSubPartnerShares.filter((s) => isOwnShare(s.userId, actorUserId)).map((s) => s.subPartnerId),
  );

  function isInScope(partyType: "partner" | "sub_partner", shareId: string): boolean {
    if (actorRole === "owner_admin") {
      return true;
    }
    return partyType === "partner" ? myPartnerIds.has(shareId) : mySubPartnerIds.has(shareId);
  }

  function resolveName(partyType: "partner" | "sub_partner", shareId: string, projectId: string): string | null {
    const table = partyType === "partner" ? raw.partnerNamesById : raw.subPartnerNamesById;
    return table[moneyHistoryPersonNameKey(shareId, projectId)] ?? null;
  }

  return raw.availableBalances
    .filter((balance) => isInScope(balance.partyType, balance.shareId))
    .map((balance) => ({
      partyType: balance.partyType,
      shareId: balance.shareId,
      name: resolveName(balance.partyType, balance.shareId, balance.projectId) ?? "Unknown",
      projectId: balance.projectId,
      projectName: raw.projectNamesById[balance.projectId] ?? UNKNOWN_PROJECT_NAME,
      balance: balance.balance,
    }));
}

/** Appends `value` to the array keyed by `key` in `map`, creating a fresh one-element array on first use -- mirrors `owner-admin-dashboard.ts`'s identical `pushToGroup` helper, duplicated locally per this codebase's established per-module local-helper convention. */
function pushTo(map: Map<string, Money[]>, key: string, value: Money): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}

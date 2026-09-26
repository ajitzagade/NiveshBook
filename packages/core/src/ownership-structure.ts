import type { InvestmentTransaction, Money, PartnerShare, Percent, SubPartnerShare, WithdrawalTransaction } from "@niveshbook/types";
import { sumMoney } from "./decimal-math";

/**
 * Story 5.10: the Ownership & Money-Flow Structure Diagram's own pure
 * assembly function -- mirrors `reports.ts`'s "every already-fetched raw row
 * list bundled in `raw`, pure, no DB access (AD-9)" shape exactly. This
 * module deliberately does NOT compute the Percentage view's "retained %"
 * figure (`sharePercent - sum(current Sub-partner sharePercent)`) -- that
 * formula is display-only arithmetic (plain `Number()` math, intentionally
 * allowed to go negative when over-allocated, per `shares/page.tsx`'s own
 * `retainedMessage`/`formatDifference`), which `packages/core`'s
 * `noRawMoneyArithmetic` lint rule forbids outside `decimal-math.ts`. Every
 * existing duplicate of that exact formula lives in `apps/web` (`shares/page.tsx`,
 * `home/page.tsx`, `add-money/page.tsx`, `withdraw-money/page.tsx`,
 * `reports/[type]/page.tsx`, `lib/report-export.ts`) -- this story adds one
 * more copy there (`structure/[projectId]/page.tsx`), never here. This
 * module hands the page every raw `sharePercent` (a partner's own, and each
 * of their current Sub-partners' own) it needs to compute that locally.
 */

export type OwnershipStructureScope =
  | { type: "project" }
  | { type: "partner"; partnerId: string }
  | { type: "sub_partner"; subPartnerId: string };

/** One Sub-partner's own node -- leaf-only, never carries further children (Sub-partners have no Sub-partners of their own). */
export interface OwnershipStructureSubPartnerNode {
  type: "sub_partner";
  subPartnerId: string;
  name: string;
  /** Always a percentage of the whole Project (AD-3) -- never re-derived against the parent Partner's own share. */
  sharePercent: Percent;
  /** Sum of every `status: "active"` `investment_transactions.amount` row for this `subPartnerId` on this Project, across every funding requirement to date (Decision #2's "Actual Amount" mode) -- the same technique `investment-adjustment.ts`'s `resolveAndUpsertAdjustment` uses internally (`sumMoney(transactionsByShareKey[...])`), reused here rather than reading any stored `investment_adjustments.actualPaid` row (which is scoped to one funding requirement, not cumulative). */
  actualAmount: Money;
  /** Money Flow mode's "Total In" -- numerically identical to `actualAmount` (both are "sum of active `investment_transactions.amount` for this share, all-time") -- carried as its own field because Money Flow mode always shows it paired with `totalOut`, never alone. */
  totalIn: Money;
  /** Money Flow mode's "Total Out" -- sum of every `status: "active"` `withdrawal_transactions.amount` row for this `subPartnerId` on this Project, all-time, no date filter (Decision #2). A withdrawal later moved to another Project (a `"project"` destination-allocation leg) is still counted here -- it already left this share's own stake the moment the withdrawal itself was recorded; `withdrawal_destination_allocations`/`money_movements` describe where it went afterward, not whether it counts as "out" here. */
  totalOut: Money;
}

/** One Partner's own node -- carries their current Sub-partners (if any) as `subPartners`, mirroring `PartnerInvestmentAdjustment`'s nested shape one story over. */
export interface OwnershipStructurePartnerNode {
  type: "partner";
  partnerId: string;
  name: string;
  sharePercent: Percent;
  actualAmount: Money;
  totalIn: Money;
  totalOut: Money;
  /** This Partner's own *current* Sub-partners -- `[]` for a Partner with none (Decision #8's zero-Sub-partner edge case; the page renders this as a leaf, not a placeholder). */
  subPartners: OwnershipStructureSubPartnerNode[];
}

/**
 * The assembled tree for one requested `scope` (Decision #6). Shape varies by
 * scope, all three still returned via this one type (never a union) so
 * `apps/web`'s page has one shape to render regardless of scope:
 * - `"project"`: `partners` holds every current Partner Share on the Project (each with their own `subPartners`); `soloSubPartner` is always `null`.
 * - `"partner"`: `partners` holds exactly the one requested Partner (with their own `subPartners`), or `[]` if that `partnerId` doesn't match any current Partner Share; `soloSubPartner` is always `null`.
 * - `"sub_partner"`: `partners` is always `[]` (Story 5.6's "no parent-Partner data is ever surfaced" precedent, reused here -- a Sub-partner's own scoped view never shows their parent Partner's node, let alone sibling Sub-partners); `soloSubPartner` holds the one requested Sub-partner's own node, or `null` if that `subPartnerId` doesn't match any current Sub-partner Share.
 */
export interface OwnershipStructureTree {
  scope: OwnershipStructureScope;
  partners: OwnershipStructurePartnerNode[];
  soloSubPartner: OwnershipStructureSubPartnerNode | null;
}

/** Every already-fetched raw row list `assembleOwnershipStructure()` needs -- pure, no DB access (AD-9), mirroring `reports.ts`'s raw-data-bundle shape. Every list here is expected to already be *this Project's* rows only (`listCurrentPartnerShares`/`listCurrentSubPartnerSharesForProject`, and `investmentTransactions`/`withdrawalTransactions` filtered to `projectId` by the caller, mirroring `reports.ts`'s own per-report filtering convention) -- this function performs no further Project-scoping of its own. */
export interface OwnershipStructureRawData {
  /** This Project's *current* Partner Shares only. */
  currentPartnerShares: readonly PartnerShare[];
  /** This Project's *current* Sub-partner Shares only, across every Partner. */
  currentSubPartnerShares: readonly SubPartnerShare[];
  /** Every investment transaction (any `status`, any funding requirement) recorded on this Project -- filtered to `status: "active"` internally. */
  investmentTransactions: readonly InvestmentTransaction[];
  /** Every withdrawal transaction (any `status`) recorded on this Project -- filtered to `status: "active"` internally. */
  withdrawalTransactions: readonly WithdrawalTransaction[];
}

/** Appends `value` to the array keyed by `key` in `map`, creating a fresh one-element array on first use -- mirrors `reports.ts`'s identical local `pushTo` helper, duplicated locally per this codebase's established per-module local-helper convention. */
function pushTo(map: Map<string, Money[]>, key: string, value: Money): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Buckets `investmentTransactions`/`withdrawalTransactions` by `(partyType,
 * shareId)` into two `Map<string, Money[]>`s (invested / withdrawn), summed
 * on read via `sumMoney` -- the one genuinely new aggregation this story adds
 * (Decision #2's Money Flow in/out), mirroring `reports.ts`'s
 * `assemblePaymentModeReport()` `Map`-bucket-then-`sumMoney()`-reduce shape
 * exactly. Only `status: "active"` rows are ever bucketed (mirrors every
 * existing active-only sum in this codebase) -- a cancelled transaction (and
 * its own linked reversal row, also `status: "cancelled"`) never contributes.
 */
function bucketActiveAmounts(
  investmentTransactions: readonly InvestmentTransaction[],
  withdrawalTransactions: readonly WithdrawalTransaction[],
): { investedByShareKey: Map<string, Money[]>; withdrawnByShareKey: Map<string, Money[]> } {
  const investedByShareKey = new Map<string, Money[]>();
  const withdrawnByShareKey = new Map<string, Money[]>();

  for (const tx of investmentTransactions) {
    if (tx.status === "active") {
      pushTo(investedByShareKey, shareKey(tx.partyType, tx.shareId), tx.amount);
    }
  }
  for (const tx of withdrawalTransactions) {
    if (tx.status === "active") {
      pushTo(withdrawnByShareKey, shareKey(tx.partyType, tx.shareId), tx.amount);
    }
  }

  return { investedByShareKey, withdrawnByShareKey };
}

/** The composite grouping key -- one `Money[]` bucket per `(partyType, shareId)`, mirroring `investment-adjustment.ts`'s own exported `shareKey` (not reused directly -- that module's version is scoped to its own file's established per-module local-helper convention, same as `reports.ts`'s `pushTo` above). */
function shareKey(partyType: "partner" | "sub_partner", shareId: string): string {
  return `${partyType}:${shareId}`;
}

/**
 * Assembles the Ownership & Money-Flow Structure Diagram's data (Story 5.10)
 * for one requested `scope` -- pure (AD-9), no DB access, no permission
 * check of its own (the route layer's `authorize()`/`authorizeScope()` call
 * happens first, per AD-1, before this is ever called). Every money sum uses
 * `sumMoney` (AD-2).
 *
 * Filters `raw.currentPartnerShares`/`raw.currentSubPartnerShares` to the
 * requested `scope` (Decision #3's privacy boundary: a `"partner"`/`"sub_partner"`
 * scope only ever includes that one target's own branch, never a sibling's or
 * a co-partner's) and computes each node's `actualAmount`/`totalIn`/`totalOut`
 * from the pre-bucketed active transaction sums. `sharePercent` is returned
 * unmodified from the share row -- the "retained %" display figure is NOT
 * computed here (see this module's own top-of-file doc comment).
 */
export function assembleOwnershipStructure(
  scope: OwnershipStructureScope,
  raw: OwnershipStructureRawData,
): OwnershipStructureTree {
  const { investedByShareKey, withdrawnByShareKey } = bucketActiveAmounts(
    raw.investmentTransactions,
    raw.withdrawalTransactions,
  );

  function amountsFor(partyType: "partner" | "sub_partner", shareId: string): { actualAmount: Money; totalIn: Money; totalOut: Money } {
    const invested = sumMoney(investedByShareKey.get(shareKey(partyType, shareId)) ?? []);
    const withdrawn = sumMoney(withdrawnByShareKey.get(shareKey(partyType, shareId)) ?? []);
    return { actualAmount: invested, totalIn: invested, totalOut: withdrawn };
  }

  function buildSubPartnerNode(share: SubPartnerShare): OwnershipStructureSubPartnerNode {
    const { actualAmount, totalIn, totalOut } = amountsFor("sub_partner", share.subPartnerId);
    return {
      type: "sub_partner",
      subPartnerId: share.subPartnerId,
      name: share.name,
      sharePercent: share.sharePercent,
      actualAmount,
      totalIn,
      totalOut,
    };
  }

  function buildPartnerNode(share: PartnerShare): OwnershipStructurePartnerNode {
    const { actualAmount, totalIn, totalOut } = amountsFor("partner", share.partnerId);
    const subPartners = raw.currentSubPartnerShares
      .filter((sub) => sub.partnerId === share.partnerId)
      .map(buildSubPartnerNode);
    return {
      type: "partner",
      partnerId: share.partnerId,
      name: share.name,
      sharePercent: share.sharePercent,
      actualAmount,
      totalIn,
      totalOut,
      subPartners,
    };
  }

  if (scope.type === "project") {
    return { scope, partners: raw.currentPartnerShares.map(buildPartnerNode), soloSubPartner: null };
  }

  if (scope.type === "partner") {
    const target = raw.currentPartnerShares.find((share) => share.partnerId === scope.partnerId);
    return { scope, partners: target ? [buildPartnerNode(target)] : [], soloSubPartner: null };
  }

  // scope.type === "sub_partner"
  const target = raw.currentSubPartnerShares.find((share) => share.subPartnerId === scope.subPartnerId);
  return { scope, partners: [], soloSubPartner: target ? buildSubPartnerNode(target) : null };
}

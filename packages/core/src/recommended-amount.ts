import type {
  InvestmentAdjustment,
  InvestmentRequirement,
  Money,
  PartnerShare,
  RecommendedAmount,
  SubPartnerShare,
} from "@niveshbook/types";
import { compareMoney, moneyEquals, subtractMoney, sumMoney, toMoney } from "./decimal-math";
import { computeShouldPay, type PartnerShouldPay, type SubPartnerShouldPay } from "./should-pay";
import { shareKey } from "./investment-adjustment";
import type { RecommendedAmountPort, SnapshotRecommendedAmountInput } from "./recommended-amount-port";

export interface RecommendedAmountDeps {
  recommendedAmounts: RecommendedAmountPort;
}

/**
 * `PartnerShouldPay`/`SubPartnerShouldPay` (Story 3.2), one field richer --
 * `recommendedAmount`/`previousPending`/`previousExtraPaid` are `undefined`
 * whenever no `RecommendedAmount` snapshot exists for this share on this
 * requirement (a pre-existing requirement created before this story shipped,
 * this story's Boundaries), never `"0"` masquerading as "nothing to carry
 * forward" -- the UI tells the two states apart (`should-pay.ts` itself
 * stays pure/unchanged -- these live here instead, per this story's
 * Decisions).
 */
export interface SubPartnerShouldPayWithRecommended extends SubPartnerShouldPay {
  recommendedAmount?: Money;
  previousPending?: Money;
  previousExtraPaid?: Money;
}

/** Mirrors `SubPartnerShouldPayWithRecommended` one level up. */
export interface PartnerShouldPayWithRecommended extends PartnerShouldPay {
  recommendedAmount?: Money;
  previousPending?: Money;
  previousExtraPaid?: Money;
  subPartners: SubPartnerShouldPayWithRecommended[];
}

const ZERO_MONEY: Money = toMoney("0");

/**
 * Reads `previousPending`/`previousExtraPaid` off one share's prior
 * `InvestmentAdjustment` row (if any) -- only one is ever non-zero, per
 * `investment_adjustments`' `adjustmentType` discriminator (mirrors
 * `investment-adjustment.ts`'s own sign-lives-in-a-separate-field
 * precedent). Both are `"0"` when there's no prior row at all (first-ever
 * requirement for the Project, or a share with no prior adjustment) or the
 * prior row's `adjustmentType` is `"none"`.
 */
function previousAmountsFor(
  partyType: "partner" | "sub_partner",
  targetShareId: string,
  previousAdjustmentsByShareKey: Readonly<Record<string, InvestmentAdjustment>>,
): { previousPending: Money; previousExtraPaid: Money } {
  const previous = previousAdjustmentsByShareKey[shareKey(partyType, targetShareId)];
  if (!previous || previous.adjustmentType === "none") {
    return { previousPending: ZERO_MONEY, previousExtraPaid: ZERO_MONEY };
  }
  if (previous.adjustmentType === "pending") {
    return { previousPending: previous.adjustmentAmount, previousExtraPaid: ZERO_MONEY };
  }
  return { previousPending: ZERO_MONEY, previousExtraPaid: previous.adjustmentAmount };
}

/**
 * `baseAmount + previousPending - previousExtraPaid`, clamped to a minimum
 * of `"0"` (this story's Decisions -- `Money` forbids negative values,
 * AD-2). `compareMoney` decides the clamp *before* subtracting, rather than
 * catching `subtractMoney`'s `NegativeMoneyResultError` -- mirrors
 * `investment-adjustment.ts`'s own "decide the sign via `compareMoney`
 * first" precedent.
 */
function computeRecommendedAmount(
  baseAmount: Money,
  previousPending: Money,
  previousExtraPaid: Money,
): Money {
  const intermediate = sumMoney([baseAmount, previousPending]);
  if (compareMoney(intermediate, previousExtraPaid) >= 0) {
    return subtractMoney(intermediate, previousExtraPaid);
  }
  return ZERO_MONEY;
}

/**
 * Builds one share's `SnapshotRecommendedAmountInput` -- pure, no port call
 * (unlike the old per-share `snapshotOne`, which called
 * `deps.recommendedAmounts.snapshot` immediately). `snapshotRecommendedAmounts`
 * below collects every share's input into one array *first*, then makes a
 * single `snapshotAll` call -- so the actual DB write is genuinely
 * all-or-nothing, never a sequential per-share loop that could leave a
 * silent partial snapshot committed if a write partway through failed
 * (Review Triage Log row 1).
 */
function buildSnapshotInput(
  requirement: InvestmentRequirement,
  partyType: "partner" | "sub_partner",
  targetShareId: string,
  baseAmount: Money,
  previousAdjustmentsByShareKey: Readonly<Record<string, InvestmentAdjustment>>,
): SnapshotRecommendedAmountInput {
  const { previousPending, previousExtraPaid } = previousAmountsFor(
    partyType,
    targetShareId,
    previousAdjustmentsByShareKey,
  );
  const recommendedAmount = computeRecommendedAmount(baseAmount, previousPending, previousExtraPaid);

  return {
    requirementId: requirement.id,
    projectId: requirement.projectId,
    partyType,
    shareId: targetShareId,
    baseAmount,
    previousPending,
    previousExtraPaid,
    recommendedAmount,
  };
}

/**
 * Snapshots Recommended Amount for every current Partner and, one level
 * down, every current Sub-partner, against the just-created `requirement`
 * (Story 3.5) -- called exactly once, from `POST .../investment-requirements`,
 * immediately after `createInvestmentRequirement` succeeds (this story's
 * core flow -- see this module's own doc block above).
 *
 * Reuses Story 3.2's `computeShouldPay` for each share's `baseAmount` --
 * mirrors `investment-adjustment.ts`'s `computeInvestmentAdjustment` calling
 * `computeShouldPay` internally rather than taking a pre-computed tree, so
 * its two precondition errors (`SharesNotFullyAllocatedError`/
 * `SubPartnerSharesOverAllocatedError`) propagate unchanged here too -- the
 * route layer decides what to do with them (this story's Decisions: a
 * Project with no fully-allocated Shares yet still gets its requirement
 * created, just with the snapshot step skipped for that call).
 *
 * `previousAdjustmentsByShareKey` must already be keyed via `shareKey`
 * (mirrors `computeInvestmentAdjustment`'s own `transactionsByShareKey`
 * convention) -- the route layer fetches
 * `investmentAdjustmentPort.listByProjectId(projectId)` once, at the one
 * moment nothing could have overwritten it yet (the new requirement doesn't
 * exist until this exact call creates it), and groups it before calling
 * this. Every Partner's and Sub-partner's `SnapshotRecommendedAmountInput`
 * is computed (pure, in-memory) *before* any port call -- `deps.recommendedAmounts.snapshotAll`
 * is then called exactly **once**, with the full batch, so the write is
 * genuinely all-or-nothing (Review Triage Log row 1) rather than a
 * sequential per-share loop that could leave a silent partial snapshot
 * committed if a write partway through failed.
 */
export async function snapshotRecommendedAmounts(
  requirement: InvestmentRequirement,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
  previousAdjustmentsByShareKey: Readonly<Record<string, InvestmentAdjustment>>,
  deps: RecommendedAmountDeps,
): Promise<RecommendedAmount[]> {
  const partners = computeShouldPay(requirement, partnerShares, subPartnerSharesByPartnerId);

  const inputs: SnapshotRecommendedAmountInput[] = [];
  for (const partner of partners) {
    inputs.push(
      buildSnapshotInput(requirement, "partner", partner.partnerId, partner.shouldPay, previousAdjustmentsByShareKey),
    );

    for (const sub of partner.subPartners) {
      inputs.push(
        buildSnapshotInput(requirement, "sub_partner", sub.subPartnerId, sub.shouldPay, previousAdjustmentsByShareKey),
      );
    }
  }

  return deps.recommendedAmounts.snapshotAll(inputs);
}

/**
 * `true` when `recommendedAmount` is numerically different from `shouldPay`
 * -- decimal-safe via `moneyEquals` (`RecommendedAmount.recommendedAmount`
 * round-trips through Postgres's `numeric(14,2)` column at its full
 * declared scale, e.g. a stored `"300000"` reads back as `"300000.00"`,
 * while `PartnerShouldPay.shouldPay` is freshly computed in-memory and
 * never reformatted -- a raw `===`/string comparison would treat these as
 * different even when they're the same amount). `mergeRecommendedAmounts`
 * uses this to decide whether `recommendedAmount` is worth surfacing at
 * all -- never `false` positives on a mere formatting difference.
 */
function differsFromShouldPay(recommendedAmount: Money, shouldPay: Money): boolean {
  return !moneyEquals(recommendedAmount, shouldPay);
}

/**
 * Pure function merging an already-fetched `RecommendedAmount[]` (one
 * requirement's `findByRequirementId` result) into `computeShouldPay`'s
 * output shape (Story 3.5) -- called from `GET .../should-pay`, never from
 * inside `should-pay.ts` itself (this story's Decisions: `computeShouldPay`
 * stays pure/unchanged). A share with no matching `RecommendedAmount` (a
 * pre-existing requirement created before this story shipped) simply keeps
 * `recommendedAmount`/`previousPending`/`previousExtraPaid` `undefined` --
 * no error, no crash, matching this story's I/O matrix.
 *
 * `recommendedAmount` itself is also left `undefined` when it's numerically
 * equal to `shouldPay` (`differsFromShouldPay`, above) -- e.g. the
 * first-ever-requirement case, or a share with no prior adjustment --
 * mirroring this story's UX note that Normal Share and Recommended Amount
 * "are only visually distinct once a carry-forward exists" (epic-3-context.md).
 * Deciding this here, with `packages/core`'s own decimal-safe `moneyEquals`,
 * rather than in `apps/web`'s "use client" Add Money page, is deliberate:
 * that page is a Client Component, and a *value* (non-type) import from
 * `@niveshbook/core`'s barrel pulls in the whole module graph -- including
 * `auth.ts`'s `argon2` dependency, a native Node addon that cannot bundle
 * for the browser. `previousPending`/`previousExtraPaid` are still always
 * merged whenever a snapshot exists, regardless of this check -- only
 * `recommendedAmount`'s presence (the client's sole "show the Recommended
 * line?" signal) is conditional on it.
 */
export function mergeRecommendedAmounts(
  partners: readonly PartnerShouldPay[],
  recommendedAmounts: readonly RecommendedAmount[],
): PartnerShouldPayWithRecommended[] {
  const byShareKey = new Map<string, RecommendedAmount>();
  for (const recommended of recommendedAmounts) {
    byShareKey.set(shareKey(recommended.partyType, recommended.shareId), recommended);
  }

  function mergeOne<T extends { shouldPay: Money }>(entry: T, recommended: RecommendedAmount | undefined): T {
    if (!recommended) {
      return entry;
    }
    return {
      ...entry,
      ...(differsFromShouldPay(recommended.recommendedAmount, entry.shouldPay)
        ? { recommendedAmount: recommended.recommendedAmount }
        : {}),
      previousPending: recommended.previousPending,
      previousExtraPaid: recommended.previousExtraPaid,
    };
  }

  return partners.map((partner) => {
    const subPartners: SubPartnerShouldPayWithRecommended[] = partner.subPartners.map((sub) =>
      mergeOne(sub, byShareKey.get(shareKey("sub_partner", sub.subPartnerId))),
    );
    return { ...mergeOne(partner, byShareKey.get(shareKey("partner", partner.partnerId))), subPartners };
  });
}

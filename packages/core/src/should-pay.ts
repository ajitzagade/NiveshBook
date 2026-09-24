import type { InvestmentRequirement, Money, Percent, PartnerShare, SubPartnerShare } from "@niveshbook/types";
import { sumPercents, subtractPercents, splitMoneyByPercents, sumMoney, NegativePercentResultError } from "./decimal-math";

/**
 * Thrown when the Project's current Partner Shares don't sum to exactly
 * 100% -- FR16's Should Pay formula only has a coherent, exact-sum-to-amount
 * meaning when the underlying shares are fully and validly allocated (this
 * story's Decisions). The route layer catches this and maps it to 409
 * `shares_not_fully_allocated`. The message is the exact plain-language
 * copy this story's Decisions quote verbatim -- shown to the user as-is,
 * never a raw percentage/number.
 */
export class SharesNotFullyAllocatedError extends Error {
  constructor() {
    super("Should Pay isn't available until Partner Shares total 100%.");
    this.name = "SharesNotFullyAllocatedError";
  }
}

/**
 * Thrown when a Partner's current Sub-partner Shares sum to more than that
 * Partner's own `sharePercent` -- there's no sensible non-negative "retained"
 * amount to compute in that state (this story's Decisions). The route layer
 * catches this and maps it to 409 `sub_partner_shares_over_allocated`.
 */
export class SubPartnerSharesOverAllocatedError extends Error {
  constructor(partnerName: string) {
    super(
      `Should Pay isn't available -- ${partnerName}'s Sub-partner Shares add up to more than ${partnerName}'s own Share %.`,
    );
    this.name = "SubPartnerSharesOverAllocatedError";
  }
}

export interface SubPartnerShouldPay {
  subPartnerId: string;
  name: string;
  sharePercent: Percent;
  shouldPay: Money;
}

export interface PartnerShouldPay {
  partnerId: string;
  name: string;
  sharePercent: Percent;
  /** `ownShouldPay + sum(subPartners[*].shouldPay)` -- always a plain, non-negative addition (`sumMoney`), never a subtraction (this story's Decisions -- see `should-pay.ts`'s module doc). */
  shouldPay: Money;
  /** This Partner's own share of `requirement.amount` -- computed from their *retained* percent (`sharePercent` minus their current Sub-partners' shares), one leaf among many in the single flat `splitMoneyByPercents` call. */
  ownShouldPay: Money;
  subPartners: SubPartnerShouldPay[];
}

/**
 * Computes Should Pay for every current Partner and, one level down, every
 * current Sub-partner, against one funding `requirement`'s amount (Story
 * 3.2). Pure -- no port calls, no I/O; the route layer fetches
 * `partnerShares`/`subPartnerSharesByPartnerId` (current versions only, via
 * `listCurrentPartnerShares`/`listCurrentSubPartnerSharesForProject`) before
 * calling this.
 *
 * Validates both preconditions *before* building any flat-list entry:
 * (1) `partnerShares` must sum to exactly 100% (`SharesNotFullyAllocatedError`
 * otherwise -- also covers the "no Partner Shares yet" case, since an empty
 * list sums to "0"); (2) each Partner's own current Sub-partner Shares must
 * not exceed that Partner's `sharePercent` (`SubPartnerSharesOverAllocatedError`
 * otherwise, detected via `subtractPercents` throwing `NegativePercentResultError`
 * -- reusing `decimal-math.ts`'s own arithmetic for the comparison, never a
 * raw `<`/`>` on a percent string).
 *
 * The split itself is done as **one single largest-remainder allocation**
 * (`splitMoneyByPercents`, called exactly once) across a flattened list of
 * every leaf percentage in the Project -- each Partner's *retained* percent
 * (their own share minus their current Sub-partners' shares) plus every
 * Sub-partner's own percent -- never as two independently-rounded splits
 * composed by subtraction. Composing two independent roundings can make a
 * Partner's computed "retained" amount go negative by a paisa even when
 * their Sub-partner allocation is legitimately within their own share
 * (flooring isn't additive); a single flat split avoids that class of bug
 * entirely by construction, since every entry (Own + every Sub) comes from
 * the same allocation and a Partner's own row total is simply the exact sum
 * `ownShouldPay + sum(subShouldPay)` (`sumMoney`), never a subtraction that
 * could go negative.
 */
export function computeShouldPay(
  requirement: InvestmentRequirement,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
): PartnerShouldPay[] {
  const partnerTotal = sumPercents(partnerShares.map((partner) => partner.sharePercent));
  if (partnerTotal !== "100") {
    throw new SharesNotFullyAllocatedError();
  }

  // Precondition 2, validated for every Partner *before* any flat-list entry
  // is built -- also yields each Partner's retained percent (reused below),
  // so this pass and the "build the flat list" pass below stay separate.
  const retainedByPartnerId = new Map<string, Percent>();
  for (const partner of partnerShares) {
    const subs = subPartnerSharesByPartnerId[partner.partnerId] ?? [];
    const subsTotal = sumPercents(subs.map((sub) => sub.sharePercent));
    try {
      retainedByPartnerId.set(partner.partnerId, subtractPercents(partner.sharePercent, subsTotal));
    } catch (error) {
      if (error instanceof NegativePercentResultError) {
        throw new SubPartnerSharesOverAllocatedError(partner.name);
      }
      throw error;
    }
  }

  // The single flattened leaf-percent list: each Partner's retained percent
  // immediately followed by that Partner's own current Sub-partners' percents.
  // Indices are tracked so the flat `Money[]` result can be reassembled back
  // into the nested `PartnerShouldPay[]` shape below.
  const leafPercents: Percent[] = [];
  const ownLeafIndexByPartnerId = new Map<string, number>();
  const subLeafIndicesByPartnerId = new Map<string, number[]>();

  for (const partner of partnerShares) {
    ownLeafIndexByPartnerId.set(partner.partnerId, leafPercents.length);
    // Precondition 1 already guarantees every partnerId has an entry here.
    leafPercents.push(retainedByPartnerId.get(partner.partnerId) as Percent);

    const subs = subPartnerSharesByPartnerId[partner.partnerId] ?? [];
    const subIndices: number[] = [];
    for (const sub of subs) {
      subIndices.push(leafPercents.length);
      leafPercents.push(sub.sharePercent);
    }
    subLeafIndicesByPartnerId.set(partner.partnerId, subIndices);
  }

  const leafShouldPay = splitMoneyByPercents(requirement.amount, leafPercents);

  return partnerShares.map((partner) => {
    const subs = subPartnerSharesByPartnerId[partner.partnerId] ?? [];
    const subIndices = subLeafIndicesByPartnerId.get(partner.partnerId) ?? [];
    const ownShouldPay = leafShouldPay[ownLeafIndexByPartnerId.get(partner.partnerId) as number] as Money;

    const subPartners: SubPartnerShouldPay[] = subs.map((sub, i) => ({
      subPartnerId: sub.subPartnerId,
      name: sub.name,
      sharePercent: sub.sharePercent,
      shouldPay: leafShouldPay[subIndices[i] as number] as Money,
    }));

    return {
      partnerId: partner.partnerId,
      name: partner.name,
      sharePercent: partner.sharePercent,
      ownShouldPay,
      shouldPay: sumMoney([ownShouldPay, ...subPartners.map((sub) => sub.shouldPay)]),
      subPartners,
    };
  });
}

import type { Money, Percent, PartnerShare, SubPartnerShare } from "@niveshbook/types";
import { sumPercents, subtractPercents, splitMoneyByPercents, sumMoney, NegativePercentResultError } from "./decimal-math";

/**
 * Thrown when the Project's current Partner Shares don't sum to exactly
 * 100% -- mirrors `should-pay.ts`'s `SharesNotFullyAllocatedError` exactly,
 * but is a deliberately separate class (this story's Decisions: "can-take.ts
 * defines its own local precondition errors ... duplicating rather than
 * importing should-pay.ts's", Story 3.2 is already `done`, Open/Closed).
 * Named `PartnerSharesNotFullyAllocatedError` (not `SharesNotFullyAllocatedError`)
 * so `packages/core/src/index.ts`'s `export * from "./should-pay"` and
 * `export * from "./can-take"` never produce an ambiguous/dropped barrel
 * export -- both files are still allowed to independently throw their own
 * class under a distinct name. The route layer catches this and maps it to
 * 409 `shares_not_fully_allocated`, matching Should Pay's identical JSON
 * error shape (this story's Boundaries), even though the TS class differs.
 */
export class PartnerSharesNotFullyAllocatedError extends Error {
  constructor() {
    super("Can Take isn't available until Partner Shares total 100%.");
    this.name = "PartnerSharesNotFullyAllocatedError";
  }
}

/**
 * Thrown when a Partner's current Sub-partner Shares sum to more than that
 * Partner's own `sharePercent` -- mirrors `should-pay.ts`'s
 * `SubPartnerSharesOverAllocatedError` exactly, but named
 * `CanTakeSubPartnerSharesOverAllocatedError` for the identical barrel-export
 * collision reason documented on `PartnerSharesNotFullyAllocatedError` above
 * (`should-pay.ts` already exports a class named `SubPartnerSharesOverAllocatedError`;
 * re-using that exact name here would make `packages/core/src/index.ts`'s two
 * `export *` statements ambiguous for that one symbol, silently dropping it
 * from the barrel per ES module semantics). The route layer catches this and
 * maps it to 409 `sub_partner_shares_over_allocated`, matching Should Pay's
 * identical JSON error shape.
 */
export class CanTakeSubPartnerSharesOverAllocatedError extends Error {
  constructor(partnerName: string) {
    super(
      `Can Take isn't available -- ${partnerName}'s Sub-partner Shares add up to more than ${partnerName}'s own Share %.`,
    );
    this.name = "CanTakeSubPartnerSharesOverAllocatedError";
  }
}

export interface SubPartnerCanTake {
  subPartnerId: string;
  name: string;
  sharePercent: Percent;
  canTake: Money;
}

export interface PartnerCanTake {
  partnerId: string;
  name: string;
  sharePercent: Percent;
  /** `ownCanTake + sum(subPartners[*].canTake)` -- always a plain, non-negative addition (`sumMoney`), never a subtraction (mirrors `should-pay.ts`'s `PartnerShouldPay.shouldPay` exactly). */
  canTake: Money;
  /** This Partner's own share of `availableToWithdraw` -- computed from their *retained* percent (`sharePercent` minus their current Sub-partners' shares), one leaf among many in the single flat `splitMoneyByPercents` call. */
  ownCanTake: Money;
  subPartners: SubPartnerCanTake[];
}

/**
 * Computes Can Take for every current Partner and, one level down, every
 * current Sub-partner, against the Project's single `availableToWithdraw`
 * amount (Story 4.1, FR21) -- Project-scoped, unlike `computeShouldPay`
 * (scoped to one funding requirement). Pure -- no port calls, no I/O; the
 * route layer resolves `availableToWithdraw` (the sum of every active
 * `investment_transactions.amount` row for the Project, this story's
 * Decisions) and `partnerShares`/`subPartnerSharesByPartnerId` (current
 * versions only, via `listCurrentPartnerShares`/
 * `listCurrentSubPartnerSharesForProject`) before calling this.
 *
 * Mirrors `computeShouldPay`'s flat-split design exactly (this story's
 * Decisions, AD-2): validates both preconditions *before* building any flat-
 * list entry -- (1) `partnerShares` must sum to exactly 100%
 * (`PartnerSharesNotFullyAllocatedError` otherwise -- also covers the "no
 * Partner Shares yet" case, since an empty list sums to "0"); (2) each
 * Partner's own current Sub-partner Shares must not exceed that Partner's
 * `sharePercent` (`CanTakeSubPartnerSharesOverAllocatedError` otherwise,
 * detected via `subtractPercents` throwing `NegativePercentResultError`).
 *
 * The split itself is done as **one single largest-remainder allocation**
 * (`splitMoneyByPercents`, called exactly once) across a flattened list of
 * every leaf percentage in the Project -- each Partner's *retained* percent
 * plus every Sub-partner's own percent -- never as two independently-rounded
 * splits composed by subtraction, for the identical rounding-safety reason
 * `computeShouldPay`'s own doc comment explains.
 */
export function computeCanTake(
  availableToWithdraw: Money,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
): PartnerCanTake[] {
  const partnerTotal = sumPercents(partnerShares.map((partner) => partner.sharePercent));
  if (partnerTotal !== "100") {
    throw new PartnerSharesNotFullyAllocatedError();
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
        throw new CanTakeSubPartnerSharesOverAllocatedError(partner.name);
      }
      throw error;
    }
  }

  // The single flattened leaf-percent list: each Partner's retained percent
  // immediately followed by that Partner's own current Sub-partners' percents.
  // Indices are tracked so the flat `Money[]` result can be reassembled back
  // into the nested `PartnerCanTake[]` shape below.
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

  const leafCanTake = splitMoneyByPercents(availableToWithdraw, leafPercents);

  return partnerShares.map((partner) => {
    const subs = subPartnerSharesByPartnerId[partner.partnerId] ?? [];
    const subIndices = subLeafIndicesByPartnerId.get(partner.partnerId) ?? [];
    const ownCanTake = leafCanTake[ownLeafIndexByPartnerId.get(partner.partnerId) as number] as Money;

    const subPartners: SubPartnerCanTake[] = subs.map((sub, i) => ({
      subPartnerId: sub.subPartnerId,
      name: sub.name,
      sharePercent: sub.sharePercent,
      canTake: leafCanTake[subIndices[i] as number] as Money,
    }));

    return {
      partnerId: partner.partnerId,
      name: partner.name,
      sharePercent: partner.sharePercent,
      ownCanTake,
      canTake: sumMoney([ownCanTake, ...subPartners.map((sub) => sub.canTake)]),
      subPartners,
    };
  });
}

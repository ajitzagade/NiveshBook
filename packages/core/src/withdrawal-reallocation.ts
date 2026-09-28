import type {
  Money,
  Percent,
  PartnerShare,
  SubPartnerShare,
  WithdrawalReallocation,
  WithdrawalReallocationAllocation,
} from "@niveshbook/types";
import {
  sumPercents,
  subtractPercents,
  splitMoneyByWeights,
  sumMoney,
  compareMoney,
  subtractMoney,
  isZeroMoney,
  NegativePercentResultError,
} from "./decimal-math";
import { PartnerSharesNotFullyAllocatedError, CanTakeSubPartnerSharesOverAllocatedError } from "./can-take";

export type WithdrawalPartyType = "partner" | "sub_partner";

/**
 * Thrown when the declining `(partyType, shareId)` passed to
 * `computeWithdrawalReallocationSplit` doesn't match any current Partner or
 * Sub-partner in the Project -- e.g. a stale `shareId` from a Share that has
 * since been superseded (`effectiveFrom` versioning, mirrors every other
 * "current version only" share lookup in this codebase).
 */
export class WithdrawalReallocationDecliningShareNotFoundError extends Error {
  constructor() {
    super("Cannot decline Can Take for a Partner/Sub-partner that isn't currently part of this Project.");
    this.name = "WithdrawalReallocationDecliningShareNotFoundError";
  }
}

/**
 * Thrown when there is nobody left to reallocate a decline to -- the
 * declining leaf was the only current Partner/Sub-partner leaf in the
 * Project (e.g. a single Partner with no Sub-partners declining their own
 * share). Mirrors `splitMoneyByWeights`'s own `SplitWeightTotalError` in
 * spirit, but is raised earlier, before ever reaching that call, so the
 * route layer can give a reallocation-specific error message instead of a
 * generic "weights sum to zero" one.
 */
export class WithdrawalReallocationNoRecipientsError extends Error {
  constructor() {
    super("There is no other current Partner or Sub-partner to reallocate this decline to.");
    this.name = "WithdrawalReallocationNoRecipientsError";
  }
}

export interface WithdrawalReallocationAllocationSplit {
  partyType: WithdrawalPartyType;
  shareId: string;
  allocatedAmount: Money;
}

/**
 * Computes the pro-rata legs one Partner's/Sub-partner's decline is split
 * into, across every *other* current Partner/Sub-partner leaf in the
 * Project, weighted by their relative Share % at this exact moment (never
 * recomputed later, even if shares subsequently change -- this codebase's
 * withdrawal-reallocation feature doc, "Data model" section).
 *
 * Flattens leaves exactly like `computeCanTake` does -- each Partner's
 * *retained* percent (their own `sharePercent` minus their current
 * Sub-partners' shares) plus every Sub-partner's own percent -- so the same
 * two preconditions apply and throw the identical error classes
 * `computeCanTake` does (`PartnerSharesNotFullyAllocatedError`,
 * `CanTakeSubPartnerSharesOverAllocatedError`): reused directly from
 * `can-take.ts` rather than duplicated, since a failure here is the exact
 * same domain condition and should map to the exact same route-layer 409.
 *
 * The declining leaf is excluded from the flat list *before* the split
 * (`WithdrawalReallocationDecliningShareNotFoundError` if it isn't found at
 * all -- e.g. a stale `shareId`; `WithdrawalReallocationNoRecipientsError`
 * if excluding it leaves nobody else), then `splitMoneyByWeights` -- not
 * `splitMoneyByPercents` -- runs once across the remaining leaves' own
 * percents, since those don't need to (and generally won't) sum to 100 once
 * one leaf is removed.
 */
export function computeWithdrawalReallocationSplit(
  decliningPartyType: WithdrawalPartyType,
  decliningShareId: string,
  declinedAmount: Money,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
): WithdrawalReallocationAllocationSplit[] {
  const partnerTotal = sumPercents(partnerShares.map((partner) => partner.sharePercent));
  if (partnerTotal !== "100") {
    throw new PartnerSharesNotFullyAllocatedError();
  }

  interface Leaf {
    partyType: WithdrawalPartyType;
    shareId: string;
    weight: Percent;
  }

  const leaves: Leaf[] = [];
  for (const partner of partnerShares) {
    const subs = subPartnerSharesByPartnerId[partner.partnerId] ?? [];
    const subsTotal = sumPercents(subs.map((sub) => sub.sharePercent));
    let retained: Percent;
    try {
      retained = subtractPercents(partner.sharePercent, subsTotal);
    } catch (error) {
      if (error instanceof NegativePercentResultError) {
        throw new CanTakeSubPartnerSharesOverAllocatedError(partner.name);
      }
      throw error;
    }

    leaves.push({ partyType: "partner", shareId: partner.partnerId, weight: retained });
    for (const sub of subs) {
      leaves.push({ partyType: "sub_partner", shareId: sub.subPartnerId, weight: sub.sharePercent });
    }
  }

  const decliningLeafExists = leaves.some(
    (leaf) => leaf.partyType === decliningPartyType && leaf.shareId === decliningShareId,
  );
  if (!decliningLeafExists) {
    throw new WithdrawalReallocationDecliningShareNotFoundError();
  }

  const recipients = leaves.filter(
    (leaf) => !(leaf.partyType === decliningPartyType && leaf.shareId === decliningShareId),
  );
  // Also covers the case where `recipients` is non-empty but every leaf in
  // it has a retained weight of exactly "0" (a Partner fully sub-allocated
  // to a single Sub-partner, who is the one declining) -- `formatScaled(0)`
  // always produces the exact literal `"0"`, the same canonical zero-percent
  // string `subtractPercents` produces for a fully-suballocated Partner
  // (`decimal-math.test.ts`'s own "handles a zero-percent leaf entry" case).
  // Without this, `splitMoneyByWeights` below would throw its own
  // `SplitWeightTotalError` uncaught by any route's error mapping.
  if (recipients.length === 0 || recipients.every((leaf) => leaf.weight === "0")) {
    throw new WithdrawalReallocationNoRecipientsError();
  }

  const allocatedAmounts = splitMoneyByWeights(
    declinedAmount,
    recipients.map((leaf) => leaf.weight),
  );

  return recipients.map((leaf, index) => ({
    partyType: leaf.partyType,
    shareId: leaf.shareId,
    allocatedAmount: allocatedAmounts[index] as Money,
  }));
}

/**
 * The Can Take ceiling actually enforced everywhere for one
 * `(partyType, shareId)` -- `baseCanTake` (Story 4.1's `computeCanTake`
 * figure) minus whatever this share has itself declined (active
 * reallocations only, so a cancelled decline stops counting immediately),
 * plus whatever unconsumed bonus this share has been allocated as a
 * recipient of someone else's active decline.
 *
 * Subtracting the decliner's own declined amount *immediately* -- the
 * moment a `WithdrawalReallocation` is recorded, before anyone has consumed
 * anything -- is what prevents double-spend: the decliner can never
 * simultaneously keep the option to withdraw what they just declined and
 * have it credited to someone else (this codebase's withdrawal-reallocation
 * feature doc, "Scope note").
 *
 * `activeReallocations`/`activeAllocations` must already be filtered to
 * `status === "active"` and to this Project -- this function does not do
 * either filter itself, mirroring `computeCanTake`'s own "pure, no I/O"
 * design (route/port layer resolves which rows are relevant before calling
 * this).
 */
/**
 * Sum of every `status: "active"` reallocation's `declinedAmount` where this
 * `(partyType, shareId)` is the DECLINER -- the amount this share has itself
 * renounced, immediately deducted from their own ceiling the moment a
 * decline is recorded (see `computeEffectiveCanTake`'s doc comment on
 * double-spend prevention). `activeReallocations` must already be filtered
 * to `status === "active"` and to this Project -- this function does not do
 * either filter itself, mirroring `computeCanTake`'s own "pure, no I/O"
 * design.
 */
export function sumDeclinedByShare(
  activeReallocations: readonly WithdrawalReallocation[],
  partyType: WithdrawalPartyType,
  shareId: string,
): Money {
  return sumMoney(
    activeReallocations
      .filter((reallocation) => reallocation.partyType === partyType && reallocation.shareId === shareId)
      .map((reallocation) => reallocation.declinedAmount),
  );
}

/**
 * Sum of every `status: "active"` reallocation's allocation leg's unconsumed
 * remainder (`allocatedAmount - consumedAmount`) where this
 * `(partyType, shareId)` is the RECIPIENT -- this share's total currently-
 * available bonus, across every leg from every decliner. `activeAllocations`
 * must already be filtered to legs of `status === "active"` reallocations
 * and to this Project -- this function does not do either filter itself.
 */
export function sumUnconsumedBonusForShare(
  activeAllocations: readonly WithdrawalReallocationAllocation[],
  partyType: WithdrawalPartyType,
  shareId: string,
): Money {
  return sumMoney(
    activeAllocations
      .filter((allocation) => allocation.partyType === partyType && allocation.shareId === shareId)
      .map((allocation) => subtractMoney(allocation.allocatedAmount, allocation.consumedAmount)),
  );
}

/**
 * How much of a recorded withdrawal's `requestedAmount` draws on this
 * share's reallocation bonus specifically, given their own (decline-
 * reduced) base ceiling `reducedCanTake` (`sumDeclinedByShare` already
 * subtracted from `computeCanTake`'s live figure, floored at `"0"`) and
 * their total unconsumed bonus `availableReallocationBonus`
 * (`sumUnconsumedBonusForShare`) -- the amount actually consumed from
 * reallocation-allocation legs (`packages/db`'s FIFO
 * `planReallocationBonusConsumption`), atomically alongside recording the
 * withdrawal transaction itself.
 *
 * `"0"` whenever `requestedAmount` doesn't exceed `reducedCanTake` -- the
 * bonus is never touched for a normal, within-entitlement withdrawal.
 * Capped at `availableReallocationBonus` regardless of how far
 * `requestedAmount` exceeds `reducedCanTake + availableReallocationBonus` --
 * a genuinely-authorized Extra Withdrawal beyond the combined ceiling still
 * draws down the real bonus money first, up to its own full amount; the
 * portion beyond that is simply not linked to any reallocation leg at all.
 */
export function resolveBonusToConsume(
  requestedAmount: Money,
  reducedCanTake: Money,
  availableReallocationBonus: Money,
): Money {
  const excessOverOwnCanTake =
    compareMoney(requestedAmount, reducedCanTake) > 0
      ? subtractMoney(requestedAmount, reducedCanTake)
      : ("0" as Money);

  return compareMoney(excessOverOwnCanTake, availableReallocationBonus) <= 0
    ? excessOverOwnCanTake
    : availableReallocationBonus;
}

export function computeEffectiveCanTake(
  baseCanTake: Money,
  partyType: WithdrawalPartyType,
  shareId: string,
  activeReallocations: readonly WithdrawalReallocation[],
  activeAllocations: readonly WithdrawalReallocationAllocation[],
): Money {
  const totalDeclined = sumDeclinedByShare(activeReallocations, partyType, shareId);
  const totalUnconsumedBonus = sumUnconsumedBonusForShare(activeAllocations, partyType, shareId);

  const afterDecline =
    compareMoney(baseCanTake, totalDeclined) >= 0
      ? subtractMoney(baseCanTake, totalDeclined)
      : ("0" as Money);

  return sumMoney([afterDecline, totalUnconsumedBonus]);
}

export interface ReallocationLegConsumptionInput {
  id: string;
  allocatedAmount: Money;
  consumedAmount: Money;
}

export interface ReallocationLegConsumptionPlanEntry {
  id: string;
  newConsumedAmount: Money;
}

/**
 * Thrown when `amountToConsume` exceeds the total unconsumed remainder
 * across every leg passed in -- a defensive check, not the primary guard
 * (the route layer only ever calls this having already confirmed the
 * withdrawal amount fits within `computeEffectiveCanTake`'s boosted
 * ceiling, which is itself bounded by these same legs' unconsumed
 * remainders). Signals a caller/precondition bug rather than a normal
 * domain rejection, mirroring how `splitMoneyByWeights`' `SplitWeightTotalError`
 * is a similar "this should never happen if the caller upheld its contract"
 * guard.
 */
export class ReallocationBonusInsufficientError extends Error {
  constructor() {
    super("Cannot consume more reallocation bonus than these legs have unconsumed.");
    this.name = "ReallocationBonusInsufficientError";
  }
}

/**
 * Pure FIFO consumption plan: given one recipient's active, not-fully-
 * consumed allocation legs (`legsOldestFirst`, already ordered by
 * `createdAt` ascending by the caller -- this function trusts that
 * ordering, it doesn't re-sort), walks them oldest-first and draws
 * `amountToConsume` from each leg's remaining (`allocatedAmount -
 * consumedAmount`) until exhausted. Returns only the legs that actually
 * need updating (their new, larger `consumedAmount`) -- a leg untouched by
 * this consumption is omitted, not returned with its unchanged value.
 *
 * A recipient topping up an already-partially-consumed leg via a later
 * decline is naturally handled: each leg's own `consumedAmount` is read
 * fresh, so this plan only ever draws down a leg's *current* remainder, not
 * a stale snapshot.
 */
export function planReallocationBonusConsumption(
  legsOldestFirst: readonly ReallocationLegConsumptionInput[],
  amountToConsume: Money,
): ReallocationLegConsumptionPlanEntry[] {
  const plan: ReallocationLegConsumptionPlanEntry[] = [];
  let remainingToConsume = amountToConsume;

  for (const leg of legsOldestFirst) {
    if (isZeroMoney(remainingToConsume)) break;

    const legRemaining = subtractMoney(leg.allocatedAmount, leg.consumedAmount);
    if (isZeroMoney(legRemaining)) continue;

    const drawnFromThisLeg = compareMoney(legRemaining, remainingToConsume) <= 0 ? legRemaining : remainingToConsume;

    plan.push({ id: leg.id, newConsumedAmount: sumMoney([leg.consumedAmount, drawnFromThisLeg]) });
    remainingToConsume = subtractMoney(remainingToConsume, drawnFromThisLeg);
  }

  if (!isZeroMoney(remainingToConsume)) {
    throw new ReallocationBonusInsufficientError();
  }

  return plan;
}

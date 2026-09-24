import type {
  Money,
  Percent,
  PartnerShare,
  SubPartnerShare,
  WithdrawalAdjustment,
} from "@niveshbook/types";
import { compareMoney, subtractMoney, sumMoney } from "./decimal-math";
import { computeCanTake } from "./can-take";
import type {
  UpsertWithdrawalAdjustmentInput,
  WithdrawalAdjustmentPort,
} from "./withdrawal-adjustment-port";

export interface WithdrawalAdjustmentDeps {
  withdrawalAdjustments: WithdrawalAdjustmentPort;
}

/**
 * The composite grouping key `takenByShareKey` (this module's own input, and
 * the route layer's grouping output) is keyed by -- one `Money[]` bucket per
 * `(partyType, shareId)`, mirroring `withdrawal_transactions`'s own
 * `(partyType, shareId)` identity (AD-4). Exported so the route layer groups
 * its one `listByProjectId` fetch into exactly this shape before calling
 * `computeWithdrawalAdjustment`.
 *
 * Named `withdrawalShareKey`, not `shareKey` -- `investment-adjustment.ts`
 * already exports a function named `shareKey` under an identical signature;
 * re-using that exact name here would make `packages/core/src/index.ts`'s
 * two `export *` statements ambiguous for that one symbol, silently dropping
 * it from the barrel per ES module semantics (the same barrel-export
 * collision `can-take.ts`'s/`withdrawal-transaction.ts`'s own local-error
 * renaming already documents).
 */
export function withdrawalShareKey(partyType: "partner" | "sub_partner", shareId: string): string {
  return `${partyType}:${shareId}`;
}

export interface SubPartnerWithdrawalAdjustment {
  subPartnerId: string;
  name: string;
  sharePercent: Percent;
  canTake: Money;
  /** Sum of every withdrawal transaction recorded against this Sub-partner across the whole Project to date -- `"0"` whether nothing was recorded yet or an explicit `"0"` transaction was. */
  taken: Money;
  adjustmentType: WithdrawalAdjustment["adjustmentType"];
  /** Non-negative magnitude -- `"0"` when `adjustmentType` is `"none"`. */
  adjustmentAmount: Money;
}

export interface PartnerWithdrawalAdjustment {
  partnerId: string;
  name: string;
  sharePercent: Percent;
  /** `ownCanTake + sum(subPartners[*].canTake)` -- mirrors `PartnerCanTake.canTake` exactly; this Partner's own adjustment row is computed against this total, not `ownCanTake` (matching `buildWithdrawalSnapshot`'s identical Story 4.2 precedent, which snapshots the same total as a Partner-row transaction's `canTakeSnapshot`). */
  canTake: Money;
  /** Sum of every withdrawal transaction recorded against this Partner's own row across the whole Project to date -- `"0"` whether nothing was recorded yet or an explicit `"0"` transaction was. */
  taken: Money;
  adjustmentType: WithdrawalAdjustment["adjustmentType"];
  /** Non-negative magnitude -- `"0"` when `adjustmentType` is `"none"`. */
  adjustmentAmount: Money;
  subPartners: SubPartnerWithdrawalAdjustment[];
}

/**
 * Computes `canTake - taken` for one Partner/Sub-partner's own
 * `(partyType, shareId)` row and upserts it via the port -- the one shared
 * building block `computeWithdrawalAdjustment` calls once per Partner and
 * once per Sub-partner below. The sign is determined via `compareMoney`
 * (never a raw `<`/`>`/exception on `Money`), and the non-negative magnitude
 * via `subtractMoney` in the direction `compareMoney` has already proven
 * won't go negative:
 * - `canTake > taken` -> `"keep_for_later"`, `subtractMoney(canTake, taken)`
 * - `canTake < taken` -> `"extra_taken"`, `subtractMoney(taken, canTake)`
 * - equal -> `"none"`, `"0"`
 */
async function resolveAndUpsertAdjustment(
  projectId: string,
  partyType: "partner" | "sub_partner",
  targetShareId: string,
  canTake: Money,
  takenByShareKey: Readonly<Record<string, readonly Money[]>>,
  deps: WithdrawalAdjustmentDeps,
): Promise<WithdrawalAdjustment> {
  const taken = sumMoney(takenByShareKey[withdrawalShareKey(partyType, targetShareId)] ?? []);

  const comparison = compareMoney(canTake, taken);
  let adjustmentType: WithdrawalAdjustment["adjustmentType"];
  let adjustmentAmount: Money;
  if (comparison > 0) {
    adjustmentType = "keep_for_later";
    adjustmentAmount = subtractMoney(canTake, taken);
  } else if (comparison < 0) {
    adjustmentType = "extra_taken";
    adjustmentAmount = subtractMoney(taken, canTake);
  } else {
    adjustmentType = "none";
    adjustmentAmount = subtractMoney(canTake, taken); // canTake === taken -- always "0".
  }

  const input: UpsertWithdrawalAdjustmentInput = {
    projectId,
    partyType,
    shareId: targetShareId,
    canTake,
    taken,
    adjustmentType,
    adjustmentAmount,
  };

  return deps.withdrawalAdjustments.upsert(input);
}

/**
 * Computes the Withdrawal Adjustment (Story 4.3) -- `Can Take - Taken`,
 * Project-scoped with no funding-round equivalent (this story's Decisions,
 * unlike Investment Adjustment's per-requirement scoping) -- for every
 * current Partner and, one level down, every current Sub-partner, and
 * **upserts** each into the single-row-per-share ledger via
 * `deps.withdrawalAdjustments.upsert` (viewing is what keeps the ledger
 * current, mirroring Story 3.4's identical precedent -- there is no separate
 * "recompute" action).
 *
 * Reuses Story 4.1's `computeCanTake` first, letting its two precondition
 * errors (`PartnerSharesNotFullyAllocatedError`/
 * `CanTakeSubPartnerSharesOverAllocatedError`) propagate unchanged -- the
 * route layer maps both to 409, mirroring Story 4.1's own route.
 * `takenByShareKey` must already be narrowed to every active withdrawal
 * transaction across the *whole Project* (this story's Decisions: "Taken"
 * sums every `withdrawal_transactions` row for the Project, no
 * `requirementId`/cycle scoping, no `status` column yet to filter on) -- the
 * route layer fetches `listByProjectId(projectId)` once and groups it via
 * `withdrawalShareKey` before calling this, never a per-share re-fetch.
 *
 * Returns the nested Partner/Sub-partner tree, mirroring `can-take.ts`'s
 * `PartnerCanTake`/`SubPartnerCanTake` shape one field richer
 * (`taken`/`adjustmentType`/`adjustmentAmount` added to each level) -- the
 * *persisted* row's values are returned for each entry (not merely the
 * freshly-computed ones), so the response always reflects exactly what was
 * saved.
 */
export async function computeWithdrawalAdjustment(
  projectId: string,
  availableToWithdraw: Money,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
  takenByShareKey: Readonly<Record<string, readonly Money[]>>,
  deps: WithdrawalAdjustmentDeps,
): Promise<PartnerWithdrawalAdjustment[]> {
  const partners = computeCanTake(availableToWithdraw, partnerShares, subPartnerSharesByPartnerId);

  const results: PartnerWithdrawalAdjustment[] = [];
  for (const partner of partners) {
    const partnerAdjustment = await resolveAndUpsertAdjustment(
      projectId,
      "partner",
      partner.partnerId,
      partner.canTake,
      takenByShareKey,
      deps,
    );

    const subPartners: SubPartnerWithdrawalAdjustment[] = [];
    for (const sub of partner.subPartners) {
      const subAdjustment = await resolveAndUpsertAdjustment(
        projectId,
        "sub_partner",
        sub.subPartnerId,
        sub.canTake,
        takenByShareKey,
        deps,
      );
      subPartners.push({
        subPartnerId: sub.subPartnerId,
        name: sub.name,
        sharePercent: sub.sharePercent,
        canTake: sub.canTake,
        taken: subAdjustment.taken,
        adjustmentType: subAdjustment.adjustmentType,
        adjustmentAmount: subAdjustment.adjustmentAmount,
      });
    }

    results.push({
      partnerId: partner.partnerId,
      name: partner.name,
      sharePercent: partner.sharePercent,
      canTake: partner.canTake,
      taken: partnerAdjustment.taken,
      adjustmentType: partnerAdjustment.adjustmentType,
      adjustmentAmount: partnerAdjustment.adjustmentAmount,
      subPartners,
    });
  }

  return results;
}

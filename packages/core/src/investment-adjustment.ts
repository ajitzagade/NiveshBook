import type {
  InvestmentAdjustment,
  InvestmentRequirement,
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
} from "@niveshbook/types";
import { compareMoney, subtractMoney, sumMoney } from "./decimal-math";
import { computeShouldPay } from "./should-pay";
import type { InvestmentAdjustmentPort, UpsertInvestmentAdjustmentInput } from "./investment-adjustment-port";

export interface InvestmentAdjustmentDeps {
  investmentAdjustments: InvestmentAdjustmentPort;
}

/**
 * The composite grouping key `transactionsByShareKey` (this module's own
 * input, and the route layer's grouping output) is keyed by -- one
 * `Money[]` bucket per `(partyType, shareId)`, mirroring
 * `investment_transactions`'s own `(partyType, shareId)` identity (AD-4).
 * Exported so the route layer groups its one `listByRequirementId` fetch
 * into exactly this shape before calling `computeInvestmentAdjustment`.
 */
export function shareKey(partyType: "partner" | "sub_partner", shareId: string): string {
  return `${partyType}:${shareId}`;
}

export interface SubPartnerInvestmentAdjustment {
  subPartnerId: string;
  name: string;
  sharePercent: Percent;
  shouldPay: Money;
  /** Sum of every transaction recorded against *this specific funding requirement* for this Sub-partner -- `"0"` whether nothing was recorded yet or an explicit `"0"` transaction was (this story's Decisions). */
  actualPaid: Money;
  adjustmentType: InvestmentAdjustment["adjustmentType"];
  /** Non-negative magnitude -- `"0"` when `adjustmentType` is `"none"`. */
  adjustmentAmount: Money;
}

export interface PartnerInvestmentAdjustment {
  partnerId: string;
  name: string;
  sharePercent: Percent;
  /** `ownShouldPay + sum(subPartners[*].shouldPay)` -- mirrors `PartnerShouldPay.shouldPay` exactly, returned here for display only (e.g. the Should Pay headline amount). This Partner's own *adjustment* row (`adjustmentType`/`adjustmentAmount` below) is computed against `ownShouldPay`, not this pooled total -- see that field's own doc comment. */
  shouldPay: Money;
  /** `adjustmentType`/`adjustmentAmount` below are computed against *this* (own-retained) amount, not the pooled `shouldPay` above -- per-person, matching `epic-3-context.md`'s "Adjustments are per-person, not pooled" rule and this record's own Sub-partner rows (each of which is already own-vs-own by construction). A Sub-partner's payment never masks -- or falsely flags -- their parent Partner's own shortfall or surplus. */
  ownShouldPay: Money;
  /** Sum of every transaction recorded against *this specific funding requirement* for this Partner's own row -- `"0"` whether nothing was recorded yet or an explicit `"0"` transaction was. */
  actualPaid: Money;
  adjustmentType: InvestmentAdjustment["adjustmentType"];
  /** Non-negative magnitude -- `"0"` when `adjustmentType` is `"none"`. */
  adjustmentAmount: Money;
  subPartners: SubPartnerInvestmentAdjustment[];
}

/**
 * Computes `shouldPay - actualPaid` for one Partner/Sub-partner's own
 * `(partyType, shareId)` row and upserts it via the port -- the one shared
 * building block `computeInvestmentAdjustment` calls once per Partner and
 * once per Sub-partner below. The sign is determined via `compareMoney`
 * (never a raw `<`/`>`/exception on `Money`), and the non-negative magnitude
 * via `subtractMoney` in the direction `compareMoney` has already proven
 * won't go negative:
 * - `shouldPay > actualPaid` -> `"pending"`, `subtractMoney(shouldPay, actualPaid)`
 * - `shouldPay < actualPaid` -> `"extra_paid"`, `subtractMoney(actualPaid, shouldPay)`
 * - equal -> `"none"`, `"0"`
 */
async function resolveAndUpsertAdjustment(
  requirement: InvestmentRequirement,
  partyType: "partner" | "sub_partner",
  targetShareId: string,
  shouldPay: Money,
  transactionsByShareKey: Readonly<Record<string, readonly Money[]>>,
  deps: InvestmentAdjustmentDeps,
): Promise<InvestmentAdjustment> {
  const actualPaid = sumMoney(transactionsByShareKey[shareKey(partyType, targetShareId)] ?? []);

  const comparison = compareMoney(shouldPay, actualPaid);
  let adjustmentType: InvestmentAdjustment["adjustmentType"];
  let adjustmentAmount: Money;
  if (comparison > 0) {
    adjustmentType = "pending";
    adjustmentAmount = subtractMoney(shouldPay, actualPaid);
  } else if (comparison < 0) {
    adjustmentType = "extra_paid";
    adjustmentAmount = subtractMoney(actualPaid, shouldPay);
  } else {
    adjustmentType = "none";
    adjustmentAmount = subtractMoney(shouldPay, actualPaid); // shouldPay === actualPaid -- always "0".
  }

  const input: UpsertInvestmentAdjustmentInput = {
    projectId: requirement.projectId,
    partyType,
    shareId: targetShareId,
    requirementId: requirement.id,
    shouldPay,
    actualPaid,
    adjustmentType,
    adjustmentAmount,
  };

  return deps.investmentAdjustments.upsert(input);
}

/**
 * Computes the Investment Adjustment (Story 3.4) -- `Should Pay - Actual
 * Paid` for the given funding `requirement` -- for every current Partner
 * and, one level down, every current Sub-partner, and **upserts** each into
 * the single-row-per-share ledger via `deps.investmentAdjustments.upsert`
 * (this story's Decisions: viewing is what keeps the ledger current, there
 * is no separate "recompute" action).
 *
 * Reuses Story 3.2's `computeShouldPay` first, letting its two precondition
 * errors (`SharesNotFullyAllocatedError`/`SubPartnerSharesOverAllocatedError`)
 * propagate unchanged -- the route layer maps both to 409, mirroring Story
 * 3.3's `buildTransactionSnapshot` precedent exactly. `transactionsByShareKey`
 * must already be narrowed to *this* `requirement`'s own transactions only
 * (this story's Decisions: "Actual Paid" sums transactions against the
 * *specific* requirement being evaluated, not all-time) -- the route layer
 * fetches `listByRequirementId(requirement.id)` once and groups it via
 * `shareKey` before calling this, never a per-share re-fetch.
 *
 * Returns the nested Partner/Sub-partner tree, mirroring `should-pay.ts`'s
 * `PartnerShouldPay`/`SubPartnerShouldPay` shape one field richer
 * (`actualPaid`/`adjustmentType`/`adjustmentAmount` added to each level) --
 * the *persisted* row's values are returned for each entry (not merely the
 * freshly-computed ones), so the response always reflects exactly what was
 * saved.
 */
export async function computeInvestmentAdjustment(
  requirement: InvestmentRequirement,
  partnerShares: readonly PartnerShare[],
  subPartnerSharesByPartnerId: Readonly<Record<string, readonly SubPartnerShare[]>>,
  transactionsByShareKey: Readonly<Record<string, readonly Money[]>>,
  deps: InvestmentAdjustmentDeps,
): Promise<PartnerInvestmentAdjustment[]> {
  const partners = computeShouldPay(requirement, partnerShares, subPartnerSharesByPartnerId);

  const results: PartnerInvestmentAdjustment[] = [];
  for (const partner of partners) {
    const partnerAdjustment = await resolveAndUpsertAdjustment(
      requirement,
      "partner",
      partner.partnerId,
      partner.ownShouldPay,
      transactionsByShareKey,
      deps,
    );

    const subPartners: SubPartnerInvestmentAdjustment[] = [];
    for (const sub of partner.subPartners) {
      const subAdjustment = await resolveAndUpsertAdjustment(
        requirement,
        "sub_partner",
        sub.subPartnerId,
        sub.shouldPay,
        transactionsByShareKey,
        deps,
      );
      subPartners.push({
        subPartnerId: sub.subPartnerId,
        name: sub.name,
        sharePercent: sub.sharePercent,
        shouldPay: sub.shouldPay,
        actualPaid: subAdjustment.actualPaid,
        adjustmentType: subAdjustment.adjustmentType,
        adjustmentAmount: subAdjustment.adjustmentAmount,
      });
    }

    results.push({
      partnerId: partner.partnerId,
      name: partner.name,
      sharePercent: partner.sharePercent,
      shouldPay: partner.shouldPay,
      ownShouldPay: partner.ownShouldPay,
      actualPaid: partnerAdjustment.actualPaid,
      adjustmentType: partnerAdjustment.adjustmentType,
      adjustmentAmount: partnerAdjustment.adjustmentAmount,
      subPartners,
    });
  }

  return results;
}

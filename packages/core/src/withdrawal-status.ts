import type {
  PartnerWithdrawalAdjustment,
  SubPartnerWithdrawalAdjustment,
} from "./withdrawal-adjustment";
import { WithdrawalShareNotFoundError } from "./withdrawal-transaction";

/**
 * Story 4.6: pulls exactly one requested party's entry out of
 * `computeWithdrawalAdjustment`'s already-computed Partner+Sub-partner tree
 * -- purely a read/extraction step, no calculation of its own (this story's
 * Decisions/Intent: zero changes to Stories 4.1-4.4's core logic). Mirrors
 * `investment-status.ts`'s `extractInvestmentStatus` exactly, one ledger
 * over.
 *
 * `partyType: "partner"` returns the full `PartnerWithdrawalAdjustment`
 * entry, which already includes its nested `subPartners` array -- a
 * Partner's own view naturally includes their own current Sub-partners
 * (this story's Code Map).
 *
 * `partyType: "sub_partner"` searches every partner's `subPartners` array
 * for the matching `subPartnerId` and returns just that single
 * `SubPartnerWithdrawalAdjustment` entry -- never the parent Partner's data,
 * never a sibling Sub-partner's (this story's Boundaries: "Never... expose a
 * Sub-partner's sibling data, or another Partner's data").
 *
 * Overloaded on the literal `partyType` so call sites branching on it get
 * the narrower return type without a cast -- mirrors
 * `extractInvestmentStatus`'s identical overload shape.
 *
 * Throws `WithdrawalShareNotFoundError` (reused unchanged from
 * `withdrawal-transaction.ts` -- not a redefinition; that module already
 * named its own copy `WithdrawalShareNotFoundError` rather than
 * `ShareNotFoundError` to avoid a barrel-export collision with
 * `investment-transaction.ts`'s class of the same name, so this module
 * reuses that same withdrawal-domain class rather than
 * `investment-transaction.ts`'s `ShareNotFoundError`) when `shareId` doesn't
 * match any entry in the given tree -- defense in depth only: the route
 * layer has already independently confirmed the target share exists against
 * the same *current* Partner/Sub-partner Shares before ever calling
 * `computeWithdrawalAdjustment`, so in normal operation this path is never
 * reached.
 */
export function extractWithdrawalStatus(
  partyType: "partner",
  shareId: string,
  adjustments: readonly PartnerWithdrawalAdjustment[],
): PartnerWithdrawalAdjustment;
export function extractWithdrawalStatus(
  partyType: "sub_partner",
  shareId: string,
  adjustments: readonly PartnerWithdrawalAdjustment[],
): SubPartnerWithdrawalAdjustment;
export function extractWithdrawalStatus(
  partyType: "partner" | "sub_partner",
  shareId: string,
  adjustments: readonly PartnerWithdrawalAdjustment[],
): PartnerWithdrawalAdjustment | SubPartnerWithdrawalAdjustment {
  if (partyType === "partner") {
    const partner = adjustments.find((candidate) => candidate.partnerId === shareId);
    if (!partner) {
      throw new WithdrawalShareNotFoundError();
    }
    return partner;
  }

  for (const partner of adjustments) {
    const sub = partner.subPartners.find((candidate) => candidate.subPartnerId === shareId);
    if (sub) {
      return sub;
    }
  }
  throw new WithdrawalShareNotFoundError();
}

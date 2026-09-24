import type {
  PartnerInvestmentAdjustment,
  SubPartnerInvestmentAdjustment,
} from "./investment-adjustment";
import { ShareNotFoundError } from "./investment-transaction";

/**
 * Story 3.6: pulls exactly one requested party's entry out of
 * `computeInvestmentAdjustment`'s already-computed Partner+Sub-partner tree
 * -- purely a read/extraction step, no calculation of its own (this story's
 * Decisions: zero changes to any of Stories 3.2-3.5's core logic).
 *
 * `partyType: "partner"` returns the full `PartnerInvestmentAdjustment`
 * entry, which already includes its nested `subPartners` array -- a
 * Partner's own view naturally includes their own current Sub-partners (this
 * story's Decisions: "their own sub-partners" in the AC).
 *
 * `partyType: "sub_partner"` searches every partner's `subPartners` array
 * for the matching `subPartnerId` and returns just that single
 * `SubPartnerInvestmentAdjustment` entry -- never the parent Partner's data,
 * never a sibling Sub-partner's (this story's Boundaries: "Never... expose a
 * Sub-partner's sibling data").
 *
 * Overloaded on the literal `partyType` so call sites branching on it get
 * the narrower return type without a cast -- mirrors the route layer's own
 * `partyType === "partner" ? ... : ...` branching needed to merge Recommended
 * Amount data back in afterwards.
 *
 * Throws `ShareNotFoundError` (reused unchanged from Story 3.3's
 * `investment-transaction.ts` -- not a redefinition) when `shareId` doesn't
 * match any entry in the given tree -- defense in depth only: the route layer
 * has already independently confirmed the target share exists against the
 * same *current* Partner/Sub-partner Shares before ever calling
 * `computeInvestmentAdjustment`, so in normal operation this path is never
 * reached.
 */
export function extractInvestmentStatus(
  partyType: "partner",
  shareId: string,
  adjustments: readonly PartnerInvestmentAdjustment[],
): PartnerInvestmentAdjustment;
export function extractInvestmentStatus(
  partyType: "sub_partner",
  shareId: string,
  adjustments: readonly PartnerInvestmentAdjustment[],
): SubPartnerInvestmentAdjustment;
export function extractInvestmentStatus(
  partyType: "partner" | "sub_partner",
  shareId: string,
  adjustments: readonly PartnerInvestmentAdjustment[],
): PartnerInvestmentAdjustment | SubPartnerInvestmentAdjustment {
  if (partyType === "partner") {
    const partner = adjustments.find((candidate) => candidate.partnerId === shareId);
    if (!partner) {
      throw new ShareNotFoundError();
    }
    return partner;
  }

  for (const partner of adjustments) {
    const sub = partner.subPartners.find((candidate) => candidate.subPartnerId === shareId);
    if (sub) {
      return sub;
    }
  }
  throw new ShareNotFoundError();
}

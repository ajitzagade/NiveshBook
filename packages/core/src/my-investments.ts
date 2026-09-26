import type {
  InvestmentRequirement,
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
  UserRole,
} from "@niveshbook/types";
import { moneyEquals } from "./decimal-math";
import {
  computeInvestmentAdjustment,
  shareKey,
  type InvestmentAdjustmentDeps,
  type PartnerInvestmentAdjustment,
} from "./investment-adjustment";
import { filterActiveTransactions } from "./investment-transaction";
import type { InvestmentRequirementPort } from "./investment-requirement-port";
import type { InvestmentTransactionPort } from "./investment-transaction-port";
import type { RecommendedAmountPort } from "./recommended-amount-port";
import { SharesNotFullyAllocatedError, SubPartnerSharesOverAllocatedError } from "./should-pay";

/**
 * Founder feedback 2026-09-26 (All Investments): the cross-project,
 * self-scoped "my investments" assembly behind `GET /api/my-investments` --
 * per Project where the actor holds a *current* Partner or Sub-partner
 * Share: project name, role, share %, and per-requirement own status
 * (should-pay, paid, pending/extra, recommended). `owner_admin` sees every
 * project/party; a `partner`/`sub_partner` response contains only that
 * user's own slice -- zero other-party names or amounts (FR10).
 *
 * Scope resolution mirrors `resolveMoneyHistoryScope`'s exact convention
 * (`money-history.ts`, Story 5.1): BOTH share lists are filtered by a
 * case-insensitive `userId` match, not just the list matching the actor's
 * own role, since nothing prevents the same `userId` from being linked to a
 * Partner Share on one Project and a Sub-partner Share on another -- the
 * multi-role-pool case the founder's scenario catalog exercises explicitly.
 *
 * Per-requirement status reuses `computeInvestmentAdjustment` (Story 3.4)
 * unchanged -- the exact computation `my-investment-status/route.ts` already
 * serves at single-requirement granularity. Like that route (and the
 * Adjust Next Time page), viewing is what keeps the adjustments ledger
 * current: the reused computation upserts through
 * `deps.investmentAdjustments`, by design, never a bespoke read-only fork.
 */

/** One funding requirement's own computed status for one of the actor's shares. */
export interface MyInvestmentRequirementStatus {
  /**
   * The person's OWN Should Pay for this requirement -- for a Partner this
   * is `ownShouldPay` (own-retained, the amount `adjustmentType`/
   * `adjustmentAmount` are actually computed against, per
   * `PartnerInvestmentAdjustment.ownShouldPay`'s doc), never the pooled
   * Partner+Sub-partners total; for a Sub-partner the two coincide.
   */
  shouldPay: Money;
  actualPaid: Money;
  adjustmentType: "pending" | "extra_paid" | "none";
  /** Non-negative magnitude -- `"0"` when `adjustmentType` is `"none"`. */
  adjustmentAmount: Money;
  /**
   * The Story 3.5 Recommended Amount snapshot for this share, when one
   * exists AND differs from the value the snapshot was built from -- for a
   * Partner that's their POOLED `shouldPay` (never the `ownShouldPay`
   * returned above), mirroring `my-investment-status/route.ts`'s
   * `withRecommendedAmount`/`recommended-amount.ts`'s pooled-basis
   * convention; for a Sub-partner the two coincide. An equal value is
   * noise, so it's omitted.
   */
  recommendedAmount?: Money;
}

export interface MyInvestmentRequirementEntry {
  requirementId: string;
  /** Plain date, `YYYY-MM-DD` -- `InvestmentRequirement.requirementDate`. */
  requirementDate: string;
  /** The requirement's own total funding amount (not the person's slice). */
  requirementAmount: Money;
  /**
   * `null` when the Project's shares fail `computeShouldPay`'s
   * preconditions (`SharesNotFullyAllocatedError`/
   * `SubPartnerSharesOverAllocatedError` -- the same conditions the
   * per-Project screens surface as a 409). One misconfigured Project must
   * never 500 the whole cross-project list, so the requirement still
   * appears, just without computable numbers.
   */
  status: MyInvestmentRequirementStatus | null;
}

/** One (Project, role) entry -- a user holding both a Partner Share and a Sub-partner Share (different Projects) gets one entry per share. */
export interface MyInvestmentEntry {
  projectId: string;
  projectName: string;
  role: "partner" | "sub_partner";
  /** The stable `partnerId`/`subPartnerId` -- never `User.id` (AD-4). */
  shareId: string;
  /** The share row's own display name (per-Project, like every other screen). */
  name: string;
  sharePercent: Percent;
  /** Most-recent `requirementDate` first (the port's own ordering, kept). `[]` for a Project with no funding requirements yet. */
  requirements: MyInvestmentRequirementEntry[];
}

/** Every already-fetched raw row list `assembleMyInvestments()` starts from -- mirrors `MoneyHistoryRawData`'s "route fetches, core assembles" split. */
export interface MyInvestmentsRawData {
  /** Every *current* Partner Share across every Project (`listAllCurrentPartnerShares`). */
  allCurrentPartnerShares: readonly PartnerShare[];
  /** Every *current* Sub-partner Share across every Project (`listAllCurrentSubPartnerShares`). */
  allCurrentSubPartnerShares: readonly SubPartnerShare[];
  projectNamesById: Readonly<Record<string, string>>;
}

/**
 * The narrow, role-specific port slices this assembler actually reads
 * (Interface Segregation) -- plus the full `InvestmentAdjustmentPort` that
 * `computeInvestmentAdjustment` (reused unchanged) requires for its upserts.
 */
export interface MyInvestmentsDeps extends InvestmentAdjustmentDeps {
  investmentRequirements: Pick<InvestmentRequirementPort, "listByProjectId">;
  investmentTransactions: Pick<InvestmentTransactionPort, "listByRequirementId">;
  recommendedAmounts: Pick<RecommendedAmountPort, "findByRequirementId">;
}

/** The actor's own selection out of the two global current-share lists -- pure (AD-9). `owner_admin` selects everything. */
export function resolveMyInvestmentShares(
  actorRole: UserRole,
  actorUserId: string,
  allCurrentPartnerShares: readonly PartnerShare[],
  allCurrentSubPartnerShares: readonly SubPartnerShare[],
): { partnerShares: PartnerShare[]; subPartnerShares: SubPartnerShare[] } {
  if (actorRole === "owner_admin") {
    return {
      partnerShares: [...allCurrentPartnerShares],
      subPartnerShares: [...allCurrentSubPartnerShares],
    };
  }
  const matches = (userId: string | null) =>
    userId !== null && userId.toLowerCase() === actorUserId.toLowerCase();
  return {
    partnerShares: allCurrentPartnerShares.filter((share) => matches(share.userId)),
    subPartnerShares: allCurrentSubPartnerShares.filter((share) => matches(share.userId)),
  };
}

/** Groups a Project's current Sub-partner Shares by parent `partnerId` -- the shape `computeInvestmentAdjustment` expects (mirrors the route layers' identical local helper). */
function groupByPartnerId(shares: readonly SubPartnerShare[]): Record<string, SubPartnerShare[]> {
  const byPartnerId: Record<string, SubPartnerShare[]> = {};
  for (const share of shares) {
    const bucket = byPartnerId[share.partnerId];
    if (bucket) {
      bucket.push(share);
    } else {
      byPartnerId[share.partnerId] = [share];
    }
  }
  return byPartnerId;
}

/** Groups one requirement's *active* transactions by `(partyType, shareId)` -- `computeInvestmentAdjustment`'s expected input shape (mirrors `my-investment-status/route.ts`'s identical helper). */
function groupTransactionsByShareKey(
  amounts: readonly { partyType: "partner" | "sub_partner"; shareId: string; amount: Money }[],
): Record<string, Money[]> {
  const byShareKey: Record<string, Money[]> = {};
  for (const transaction of amounts) {
    const key = shareKey(transaction.partyType, transaction.shareId);
    const bucket = byShareKey[key];
    if (bucket) {
      bucket.push(transaction.amount);
    } else {
      byShareKey[key] = [transaction.amount];
    }
  }
  return byShareKey;
}

interface ComputedRequirement {
  requirement: InvestmentRequirement;
  /** `null` when `computeShouldPay`'s preconditions failed for this Project. */
  adjustments: PartnerInvestmentAdjustment[] | null;
  recommendedByShareKey: ReadonlyMap<string, Money>;
}

/** Pulls one share's own status out of an already-computed requirement tree -- own slice only, never a sibling's or parent's. */
function extractOwnStatus(
  computed: ComputedRequirement,
  role: "partner" | "sub_partner",
  shareId: string,
): MyInvestmentRequirementStatus | null {
  if (!computed.adjustments) {
    return null;
  }

  let shouldPay: Money | undefined;
  let actualPaid: Money | undefined;
  let adjustmentType: MyInvestmentRequirementStatus["adjustmentType"] | undefined;
  let adjustmentAmount: Money | undefined;
  /**
   * The value the Recommended-snapshot noise check compares against. Story
   * 3.5 snapshots a Partner's Recommended Amount from their POOLED
   * `shouldPay` (`recommended-amount.ts`'s `buildSnapshotInput` call sites),
   * and `my-investment-status/route.ts`'s `withRecommendedAmount` filters
   * against that same pooled value -- so this check uses the pooled figure
   * too, even though the RETURNED `shouldPay` field stays `ownShouldPay`
   * (see `MyInvestmentRequirementStatus.shouldPay`'s doc comment). For a
   * Sub-partner the two coincide.
   */
  let recommendedNoiseBasis: Money | undefined;

  if (role === "partner") {
    const partner = computed.adjustments.find((candidate) => candidate.partnerId === shareId);
    if (partner) {
      // `ownShouldPay`, not the pooled `shouldPay` -- see
      // `MyInvestmentRequirementStatus.shouldPay`'s doc comment.
      shouldPay = partner.ownShouldPay;
      actualPaid = partner.actualPaid;
      adjustmentType = partner.adjustmentType;
      adjustmentAmount = partner.adjustmentAmount;
      recommendedNoiseBasis = partner.shouldPay;
    }
  } else {
    for (const partner of computed.adjustments) {
      const sub = partner.subPartners.find((candidate) => candidate.subPartnerId === shareId);
      if (sub) {
        shouldPay = sub.shouldPay;
        actualPaid = sub.actualPaid;
        adjustmentType = sub.adjustmentType;
        adjustmentAmount = sub.adjustmentAmount;
        recommendedNoiseBasis = sub.shouldPay;
        break;
      }
    }
  }

  if (
    shouldPay === undefined ||
    actualPaid === undefined ||
    adjustmentType === undefined ||
    adjustmentAmount === undefined ||
    recommendedNoiseBasis === undefined
  ) {
    // The share existed when the current-share lists were fetched but not in
    // this requirement's computed tree -- defensively "not computable"
    // rather than a throw (mirrors `extractInvestmentStatus`'s
    // defense-in-depth framing, minus the exception: one odd row must not
    // break the whole cross-project list).
    return null;
  }

  const recommended = computed.recommendedByShareKey.get(shareKey(role, shareId));
  return {
    shouldPay,
    actualPaid,
    adjustmentType,
    adjustmentAmount,
    ...(recommended !== undefined && !moneyEquals(recommended, recommendedNoiseBasis)
      ? { recommendedAmount: recommended }
      : {}),
  };
}

/**
 * Assembles the All Investments list for one actor. Fetches each relevant
 * Project's requirements/transactions/recommended-amounts through the
 * narrow deps (once per Project/requirement -- never per share), computes
 * each requirement's tree once via `computeInvestmentAdjustment`, then
 * extracts only the actor's own entries. Output is sorted by `projectName`,
 * then role (`partner` before `sub_partner`), then `name` -- deterministic
 * regardless of the ports' own row order.
 */
export async function assembleMyInvestments(
  actorRole: UserRole,
  actorUserId: string,
  raw: MyInvestmentsRawData,
  deps: MyInvestmentsDeps,
): Promise<MyInvestmentEntry[]> {
  const selection = resolveMyInvestmentShares(
    actorRole,
    actorUserId,
    raw.allCurrentPartnerShares,
    raw.allCurrentSubPartnerShares,
  );

  const projectIds = [
    ...new Set([
      ...selection.partnerShares.map((share) => share.projectId),
      ...selection.subPartnerShares.map((share) => share.projectId),
    ]),
  ];

  // Projects are assembled concurrently (NFR10: an owner_admin's list spans
  // every Project, and a serial per-project await would multiply round
  // trips); the per-requirement work INSIDE a project stays sequential --
  // `computeInvestmentAdjustment`'s upserts per requirement are ordered
  // within a project, mirroring the single-requirement routes' behavior.
  const computedProjects = await Promise.all(
    projectIds.map(async (projectId): Promise<[string, ComputedRequirement[]]> => {
      // The FULL Project tree (every current Partner/Sub-partner Share on the
      // Project, not just the actor's own) -- `computeShouldPay` needs the
      // complete allocation to compute anyone's slice. Only the actor's own
      // extracted entries ever leave this function (FR10).
      const projectPartnerShares = raw.allCurrentPartnerShares.filter(
        (share) => share.projectId === projectId,
      );
      const projectSubSharesByPartnerId = groupByPartnerId(
        raw.allCurrentSubPartnerShares.filter((share) => share.projectId === projectId),
      );

      const requirements = await deps.investmentRequirements.listByProjectId(projectId);
      const computed: ComputedRequirement[] = [];
      for (const requirement of requirements) {
        const transactions = await deps.investmentTransactions.listByRequirementId(requirement.id);

        let adjustments: PartnerInvestmentAdjustment[] | null;
        try {
          adjustments = await computeInvestmentAdjustment(
            requirement,
            projectPartnerShares,
            projectSubSharesByPartnerId,
            // Cancelled transactions (and their reversal rows) excluded before
            // the computation ever sees them -- mirrors
            // `my-investment-status/route.ts`'s identical Story 3.8 filter step.
            groupTransactionsByShareKey(filterActiveTransactions(transactions)),
            { investmentAdjustments: deps.investmentAdjustments },
          );
        } catch (error) {
          if (
            error instanceof SharesNotFullyAllocatedError ||
            error instanceof SubPartnerSharesOverAllocatedError
          ) {
            adjustments = null;
          } else {
            throw error;
          }
        }

        const recommendedRows = await deps.recommendedAmounts.findByRequirementId(requirement.id);
        computed.push({
          requirement,
          adjustments,
          recommendedByShareKey: new Map(
            recommendedRows.map((row) => [
              shareKey(row.partyType, row.shareId),
              row.recommendedAmount,
            ]),
          ),
        });
      }
      return [projectId, computed];
    }),
  );
  const computedByProjectId = new Map<string, ComputedRequirement[]>(computedProjects);

  function buildEntry(
    role: "partner" | "sub_partner",
    shareId: string,
    projectId: string,
    name: string,
    sharePercent: Percent,
  ): MyInvestmentEntry {
    const computed = computedByProjectId.get(projectId) ?? [];
    return {
      projectId,
      projectName: raw.projectNamesById[projectId] ?? projectId,
      role,
      shareId,
      name,
      sharePercent,
      requirements: computed.map((item) => ({
        requirementId: item.requirement.id,
        requirementDate: item.requirement.requirementDate,
        requirementAmount: item.requirement.amount,
        status: extractOwnStatus(item, role, shareId),
      })),
    };
  }

  const entries: MyInvestmentEntry[] = [
    ...selection.partnerShares.map((share) =>
      buildEntry("partner", share.partnerId, share.projectId, share.name, share.sharePercent),
    ),
    ...selection.subPartnerShares.map((share) =>
      buildEntry("sub_partner", share.subPartnerId, share.projectId, share.name, share.sharePercent),
    ),
  ];

  entries.sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.role.localeCompare(b.role) ||
      a.name.localeCompare(b.name),
  );

  return entries;
}

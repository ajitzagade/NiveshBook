import { NextResponse, type NextRequest } from "next/server";
import type {
  InvestmentTransaction,
  Money,
  RecommendedAmount,
  SubPartnerShare,
} from "@niveshbook/types";
import {
  getSession,
  authorize,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  listInvestmentTransactions,
  computeInvestmentAdjustment,
  extractInvestmentStatus,
  shareKey,
  moneyEquals,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
  ShareNotFoundError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentRequirementPort,
  createInvestmentTransactionPort,
  createInvestmentAdjustmentPort,
  createRecommendedAmountPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import { isValidRequirementId, requirementNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, parseQueryParams, shareNotFoundResponse } from "./shared";

interface RouteContext {
  params: Promise<{ id: string; requirementId: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `computeShouldPay` (via `computeInvestmentAdjustment`)
 * expects. Mirrors `should-pay/route.ts`'s/`transactions/route.ts`'s/
 * `adjustments/route.ts`'s local helper of the same name -- kept local to
 * each route rather than shared, matching that established precedent.
 */
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

/**
 * Groups one funding requirement's transactions (fetched exactly once) by
 * `(partyType, shareId)` -- the shape `computeInvestmentAdjustment` expects,
 * via `shareKey`. Mirrors `adjustments/route.ts`'s identical local helper.
 */
function groupTransactionsByShareKey(
  transactions: readonly InvestmentTransaction[],
): Record<string, Money[]> {
  const byShareKey: Record<string, Money[]> = {};
  for (const transaction of transactions) {
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

/**
 * Merges one already-fetched `RecommendedAmount` row (if any exists for
 * `(partyType, id)`) onto `entry` -- a single-entry-granularity equivalent of
 * `packages/core`'s `mergeRecommendedAmounts` (Story 3.5), which this route
 * cannot reuse directly: `mergeRecommendedAmounts`'s fixed `PartnerShouldPay[]`
 * signature would type-erase `extractInvestmentStatus`'s `actualPaid`/
 * `adjustmentType`/`adjustmentAmount` fields on the way through (its return
 * type is hardcoded to `PartnerShouldPayWithRecommended[]`, one field poorer
 * than what this endpoint needs to return). `recommendedAmount` is left
 * undefined both when no snapshot exists for this share, and when it's
 * numerically equal to `shouldPay` (`moneyEquals`) -- mirrors
 * `recommended-amount.ts`'s `differsFromShouldPay` precedent exactly, just
 * inlined at one-entry granularity instead of a whole-tree pass.
 */
function withRecommendedAmount<T extends { shouldPay: Money }>(
  entry: T,
  partyType: "partner" | "sub_partner",
  id: string,
  recommendedByShareKey: ReadonlyMap<string, RecommendedAmount>,
): T & { recommendedAmount?: Money; previousPending?: Money; previousExtraPaid?: Money } {
  const recommended = recommendedByShareKey.get(shareKey(partyType, id));
  if (!recommended) {
    return entry;
  }
  return {
    ...entry,
    ...(!moneyEquals(recommended.recommendedAmount, entry.shouldPay)
      ? { recommendedAmount: recommended.recommendedAmount }
      : {}),
    previousPending: recommended.previousPending,
    previousExtraPaid: recommended.previousExtraPaid,
  };
}

/**
 * Story 3.6: a Partner or Sub-partner's own, private view of their
 * Investment Adjustment status for one funding requirement --
 * `?partyType=partner|sub_partner&shareId=...` query params (a query against
 * one specific share within this requirement, not a distinct resource path).
 * Self-access allowed (the target share's own linked user), alongside
 * unconditional Owner/Admin access, gated by `authorize()` for
 * `"investment_status:view"` -- never redesigning `should-pay/route.ts`'s or
 * `adjustments/route.ts`'s existing Owner/Admin-only broad endpoints (this
 * story's Decisions).
 *
 * Exact ordering per this story's Boundaries: session (401) -> project
 * existence (404) -> requirement existence, incl. cross-project mismatch
 * (404) -> query params parsed and shape-checked (400 `invalid_request` --
 * needed this early since `partyType`/`shareId` drive the very next step,
 * mirroring `transactions/route.ts`'s POST body-shape-check timing) ->
 * current Partner/Sub-partner Shares fetched -> target-share resolved by
 * `partyType`+`shareId` against those *current* shares (404 `not_found` if no
 * match) -> `authorize()` with `resourceRef.ownerId` set to the target
 * share's `userId` (403 `forbidden`) -> `computeInvestmentAdjustment`, reused
 * unchanged from Story 3.4 (409 on its two precondition errors) ->
 * `extractInvestmentStatus` pulls out just the one requested party's entry ->
 * this requirement's `recommended_amounts` rows are fetched and merged into
 * that entry (and, for a Partner's own view, into each of their nested
 * Sub-partners too) -> 200.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const { id: projectId, requirementId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  if (!isValidRequirementId(requirementId)) {
    return requirementNotFoundResponse();
  }

  const investmentRequirementPort = createInvestmentRequirementPort();
  const requirement = await investmentRequirementPort.findById(requirementId);
  if (!requirement || requirement.projectId !== projectId) {
    return requirementNotFoundResponse();
  }

  const query = parseQueryParams(request.nextUrl.searchParams);
  if (!query) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const [partnerShares, subPartnerShares] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
  ]);

  const target =
    query.partyType === "partner"
      ? partnerShares.find((share) => share.partnerId === query.shareId)
      : subPartnerShares.find((share) => share.subPartnerId === query.shareId);

  if (!target) {
    return shareNotFoundResponse();
  }

  const userPort = createUserPort();
  const { allowed } = await authorize(
    session.userId,
    "investment_status:view",
    { ownerId: target.userId ?? "" },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const investmentTransactionPort = createInvestmentTransactionPort();
  const investmentAdjustmentPort = createInvestmentAdjustmentPort();
  const recommendedAmountPort = createRecommendedAmountPort();

  try {
    const transactions = await listInvestmentTransactions(requirementId, {
      investmentTransactions: investmentTransactionPort,
    });

    const partners = await computeInvestmentAdjustment(
      requirement,
      partnerShares,
      groupByPartnerId(subPartnerShares),
      groupTransactionsByShareKey(transactions),
      { investmentAdjustments: investmentAdjustmentPort },
    );

    const recommendedAmounts = await recommendedAmountPort.findByRequirementId(requirementId);
    const recommendedByShareKey = new Map(
      recommendedAmounts.map((recommended) => [
        shareKey(recommended.partyType, recommended.shareId),
        recommended,
      ]),
    );

    const status =
      query.partyType === "partner"
        ? (() => {
            const partner = extractInvestmentStatus("partner", query.shareId, partners);
            return {
              ...withRecommendedAmount(partner, "partner", partner.partnerId, recommendedByShareKey),
              subPartners: partner.subPartners.map((sub) =>
                withRecommendedAmount(sub, "sub_partner", sub.subPartnerId, recommendedByShareKey),
              ),
            };
          })()
        : (() => {
            const sub = extractInvestmentStatus("sub_partner", query.shareId, partners);
            return withRecommendedAmount(sub, "sub_partner", sub.subPartnerId, recommendedByShareKey);
          })();

    return NextResponse.json({ partyType: query.partyType, status });
  } catch (error) {
    if (error instanceof SharesNotFullyAllocatedError) {
      return NextResponse.json(
        { code: "shares_not_fully_allocated", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof SubPartnerSharesOverAllocatedError) {
      return NextResponse.json(
        { code: "sub_partner_shares_over_allocated", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof ShareNotFoundError) {
      // Defense in depth only -- the target share's existence was already
      // confirmed above, against the same fetched Partner/Sub-partner
      // Shares, before `authorize()` ever ran.
      return shareNotFoundResponse();
    }
    throw error;
  }
}

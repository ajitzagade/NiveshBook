import { NextResponse, type NextRequest } from "next/server";
import type { Money, SubPartnerShare, WithdrawalTransaction } from "@niveshbook/types";
import {
  getSession,
  authorize,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeWithdrawalAdjustment,
  extractWithdrawalStatus,
  withdrawalShareKey,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
  WithdrawalShareNotFoundError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
  createWithdrawalAdjustmentPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, parseQueryParams, shareNotFoundResponse } from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `computeCanTake` (via `computeWithdrawalAdjustment`)
 * expects. Mirrors `withdrawal-adjustments/route.ts`'s local helper of the
 * same name -- kept local to each route rather than shared, matching that
 * established precedent.
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
 * Groups every withdrawal transaction recorded against the whole Project
 * (fetched exactly once, via `listByProjectId`) by `(partyType, shareId)` --
 * the shape `computeWithdrawalAdjustment` expects, via `withdrawalShareKey`.
 * Mirrors `withdrawal-adjustments/route.ts`'s identical local helper.
 */
function groupTransactionsByShareKey(
  transactions: readonly WithdrawalTransaction[],
): Record<string, Money[]> {
  const byShareKey: Record<string, Money[]> = {};
  for (const transaction of transactions) {
    const key = withdrawalShareKey(transaction.partyType, transaction.shareId);
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
 * Story 4.6: a Partner or Sub-partner's own, private view of their
 * Withdrawal Adjustment status for one Project --
 * `?partyType=partner|sub_partner&shareId=...` query params (a query against
 * one specific share within this Project, not a distinct resource path;
 * Project-scoped like `withdrawal-adjustments/route.ts`, not nested under a
 * funding requirement). Self-access allowed (the target share's own linked
 * user), alongside unconditional Owner/Admin access, gated by `authorize()`
 * for `"withdrawal_status:view"` -- never redesigning
 * `withdrawal-transactions/route.ts`'s or `withdrawal-adjustments/route.ts`'s
 * existing Owner/Admin-only broad endpoints (this story's Decisions).
 *
 * Exact ordering per this story's Boundaries: session (401) -> project
 * existence (404) -> query params parsed and shape-checked (400
 * `invalid_request` -- needed this early since `partyType`/`shareId` drive
 * the very next step, mirroring `my-investment-status/route.ts`'s identical
 * Story 3.6 timing) -> current Partner/Sub-partner Shares, the Project's
 * available-to-withdraw amount, and every withdrawal transaction ever
 * recorded against the Project fetched (mirroring
 * `withdrawal-adjustments/route.ts`'s existing fetch, never a per-share
 * re-fetch) -> target-share resolved by `partyType`+`shareId` against those
 * *current* shares (404 `not_found` if no match) -> `authorize()` with
 * `resourceRef.ownerId` set to the target share's `userId` (403 `forbidden`)
 * -> `computeWithdrawalAdjustment`, reused unchanged from Story 4.3 (409 on
 * its two precondition errors) -- which also upserts `withdrawal_adjustments`
 * on every view, consistent with `withdrawal-adjustments/route.ts`'s
 * existing side effect, not a new one -> `extractWithdrawalStatus` pulls out
 * just the one requested party's entry -> 200.
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

  const { id: projectId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
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
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const [partnerShares, subPartnerShares, availableToWithdraw, withdrawalTransactions] =
    await Promise.all([
      listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
      listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
      investmentTransactionPort.sumActiveAmountByProjectId(projectId),
      withdrawalTransactionPort.listByProjectId(projectId),
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
    "withdrawal_status:view",
    { ownerId: target.userId ?? "" },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const withdrawalAdjustmentPort = createWithdrawalAdjustmentPort();

  try {
    const partners = await computeWithdrawalAdjustment(
      projectId,
      availableToWithdraw,
      partnerShares,
      groupByPartnerId(subPartnerShares),
      groupTransactionsByShareKey(withdrawalTransactions),
      { withdrawalAdjustments: withdrawalAdjustmentPort },
    );

    // Branched (rather than passing `query.partyType` straight through) so
    // `extractWithdrawalStatus`'s literal-discriminated overloads resolve --
    // a union-typed argument doesn't select an overload on its own, mirrors
    // `my-investment-status/route.ts`'s identical Story 3.6 branching.
    const status =
      query.partyType === "partner"
        ? extractWithdrawalStatus("partner", query.shareId, partners)
        : extractWithdrawalStatus("sub_partner", query.shareId, partners);

    return NextResponse.json({ partyType: query.partyType, status });
  } catch (error) {
    if (error instanceof PartnerSharesNotFullyAllocatedError) {
      return NextResponse.json(
        { code: "shares_not_fully_allocated", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof CanTakeSubPartnerSharesOverAllocatedError) {
      return NextResponse.json(
        { code: "sub_partner_shares_over_allocated", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof WithdrawalShareNotFoundError) {
      // Defense in depth only -- the target share's existence was already
      // confirmed above, against the same fetched Partner/Sub-partner
      // Shares, before `authorize()` ever ran.
      return shareNotFoundResponse();
    }
    throw error;
  }
}

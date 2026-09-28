import { NextResponse, type NextRequest } from "next/server";
import type { Money, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeCanTake,
  computeEffectiveCanTake,
  computeWithdrawalReallocationSplit,
  resolveAvailableToWithdraw,
  toMoney,
  InvalidMoneyError,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
  WithdrawalReallocationDecliningShareNotFoundError,
  WithdrawalReallocationNoRecipientsError,
  type PartnerCanTake,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
  createWithdrawalReallocationPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../shared";
import { INVALID_REQUEST_MESSAGE, SHARE_NOT_FOUND_MESSAGE } from "../shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Mirrors `withdrawal-reallocations/route.ts`'s identical local helper. */
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

/** Mirrors `withdrawal-reallocations/route.ts`'s identical local helper. */
function findLiveCanTake(
  partners: readonly PartnerCanTake[],
  partyType: "partner" | "sub_partner",
  shareId: string,
) {
  if (partyType === "partner") {
    return partners.find((partner) => partner.partnerId === shareId)?.canTake;
  }
  for (const partner of partners) {
    const match = partner.subPartners.find((sub) => sub.subPartnerId === shareId);
    if (match) {
      return match.canTake;
    }
  }
  return undefined;
}

/**
 * Read-only preview of the "Skip this round" dialog's pro-rata split --
 * computes exactly what `POST /withdrawal-reallocations` would persist for
 * the same `partyType`/`shareId`/`declinedAmount`, without writing anything
 * (this codebase's approved plan requires showing this before the Owner/
 * Admin confirms). Deliberately a separate `GET` endpoint, not a `preview`
 * flag on the `POST` body -- a preview needs no `idempotencyKey`, and
 * keeping it a plain, safe, idempotent `GET` avoids any risk of it being
 * mistaken for (or accidentally triggering) the real write path.
 *
 * Reuses the exact same computation as the create route (never a second,
 * divergent implementation of the split math) -- gated by the same
 * `"withdrawal_reallocations:create"` permission, since only someone who
 * could actually perform the decline should be able to preview it.
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

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "withdrawal_reallocations:create", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const { id: projectId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  const searchParams = request.nextUrl.searchParams;
  const partyType = searchParams.get("partyType");
  const shareId = searchParams.get("shareId");
  const declinedAmountRaw = searchParams.get("declinedAmount");

  if (
    (partyType !== "partner" && partyType !== "sub_partner") ||
    !shareId ||
    shareId.trim().length === 0 ||
    !declinedAmountRaw
  ) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const reallocationPort = createWithdrawalReallocationPort();
  const [
    partnerShares,
    subPartnerShares,
    totalActiveInvested,
    totalActiveWithdrawn,
    activeReallocations,
    activeAllocations,
  ] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
    investmentTransactionPort.sumActiveAmountByProjectId(projectId),
    withdrawalTransactionPort.sumActiveAmountByProjectId(projectId),
    reallocationPort.listActiveByProjectId(projectId),
    reallocationPort.listActiveAllocationsByProjectId(projectId),
  ]);
  const availableToWithdraw = resolveAvailableToWithdraw(totalActiveInvested, totalActiveWithdrawn);
  const subPartnerSharesByPartnerId = groupByPartnerId(subPartnerShares);

  const target =
    partyType === "partner"
      ? partnerShares.find((share) => share.partnerId === shareId)
      : subPartnerShares.find((share) => share.subPartnerId === shareId);

  if (!target) {
    return NextResponse.json({ code: "not_found", message: SHARE_NOT_FOUND_MESSAGE }, { status: 404 });
  }

  try {
    const declinedAmount = toMoney(declinedAmountRaw);

    const canTakeTree = computeCanTake(availableToWithdraw, partnerShares, subPartnerSharesByPartnerId);
    const baseCanTake = findLiveCanTake(canTakeTree, partyType, shareId) ?? ("0" as Money);
    const effectiveCanTake = computeEffectiveCanTake(
      baseCanTake,
      partyType,
      shareId,
      activeReallocations,
      activeAllocations,
    );

    const allocationLegs = computeWithdrawalReallocationSplit(
      partyType,
      shareId,
      declinedAmount,
      partnerShares,
      subPartnerSharesByPartnerId,
    );

    return NextResponse.json({ effectiveCanTake, allocationLegs });
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      return NextResponse.json({ code: "validation_error", message: error.message }, { status: 400 });
    }
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
    if (error instanceof WithdrawalReallocationDecliningShareNotFoundError) {
      return NextResponse.json({ code: "not_found", message: error.message }, { status: 404 });
    }
    if (error instanceof WithdrawalReallocationNoRecipientsError) {
      return NextResponse.json({ code: "no_recipients", message: error.message }, { status: 409 });
    }
    throw error;
  }
}

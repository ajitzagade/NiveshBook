import { NextResponse, type NextRequest } from "next/server";
import type { Money, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorize,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeCanTake,
  resolveAvailableToWithdraw,
  recordWithdrawalTransactionBatch,
  toMoney,
  sumMoney,
  compareMoney,
  subtractMoney,
  sumDeclinedByShare,
  sumUnconsumedBonusForShare,
  resolveBonusToConsume,
  InvalidMoneyError,
  InvalidWithdrawalAmountError,
  InvalidWithdrawalDateError,
  InvalidWithdrawalPaymentModeError,
  MissingWithdrawalIdempotencyKeyError,
  EmptyWithdrawalTransactionBatchError,
  WithdrawalShareNotFoundError,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
  WithdrawalIdempotencyKeyConflictError,
  assertExtraWithdrawalAuthorized,
  OwnerAdminRequiredForExtraWithdrawalError,
  ExtraWithdrawalAuthorizationRequiredError,
  ReallocationBonusInsufficientError,
  type PartnerCanTake,
  type WithdrawalTransactionPort,
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
  recordWithdrawalTransactionBatchWithBonusConsumption,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../shared";
import { shareNotFoundResponse } from "../shared";
import { INVALID_REQUEST_MESSAGE, isValidWithdrawalTransactionBatchBody } from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Mirrors `../route.ts`'s identical local helper. */
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

/** Mirrors `../route.ts`'s identical local helper. */
function findLiveCanTake(
  partners: readonly PartnerCanTake[],
  partyType: "partner" | "sub_partner",
  shareId: string,
): Money | undefined {
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
 * Records a split withdrawal -- one Partner/Sub-partner's one Take Now
 * event, paid across multiple payment methods -- as multiple
 * `withdrawal_transactions` rows against one Project, atomically (all rows
 * or none). Mirrors `../route.ts`'s `POST` handler exactly, including
 * Story 4.5's Extra Withdrawal gate and the withdrawal-reallocation bonus
 * consumption -- the one difference (per this feature's own Decisions) is
 * that both are evaluated against the SUM of every row's amount, not a
 * single row: the whole batch is one withdrawal event for Can Take/bonus
 * purposes. Same self-access-or-Owner/Admin `"withdrawal_transactions:create"`
 * gate -- this is still one logical write action from the caller's
 * perspective, just producing several rows instead of one.
 *
 * A repeated `POST` with the same `idempotencyKey` returns the *original*
 * batch's rows with `200` (not `201`), mirroring `../route.ts`'s identical
 * convention.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (!isValidWithdrawalTransactionBatchBody(body)) {
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

  const target =
    body.partyType === "partner"
      ? partnerShares.find((share) => share.partnerId === body.shareId)
      : subPartnerShares.find((share) => share.subPartnerId === body.shareId);

  if (!target) {
    return shareNotFoundResponse();
  }

  const userPort = createUserPort();
  const { allowed } = await authorize(
    session.userId,
    "withdrawal_transactions:create",
    { ownerId: target.userId ?? "" },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const subPartnerSharesByPartnerId = groupByPartnerId(subPartnerShares);
  try {
    // Story 4.5's Extra Withdrawal gate (FR25), evaluated against the BATCH
    // TOTAL (every row's amount summed) -- the whole split withdrawal is one
    // Take Now event for Can Take/bonus purposes (per this feature's
    // Decisions), mirroring `../route.ts`'s identical gate one level up, just
    // against a summed amount instead of a single one.
    const canTakeTree = computeCanTake(availableToWithdraw, partnerShares, subPartnerSharesByPartnerId);
    const liveCanTake = findLiveCanTake(canTakeTree, body.partyType, body.shareId) ?? ("0" as Money);
    const requestedAmount = sumMoney(body.rows.map((row) => toMoney(row.amount)));

    const declinedByThisShare = sumDeclinedByShare(activeReallocations, body.partyType, body.shareId);
    const reducedCanTake =
      compareMoney(liveCanTake, declinedByThisShare) >= 0
        ? subtractMoney(liveCanTake, declinedByThisShare)
        : ("0" as Money);
    const availableReallocationBonus = sumUnconsumedBonusForShare(
      activeAllocations,
      body.partyType,
      body.shareId,
    );

    const actor = await userPort.findUserById(session.userId);
    assertExtraWithdrawalAuthorized({
      requestedAmount,
      canTake: reducedCanTake,
      availableReallocationBonus,
      actorRole: actor?.role ?? "partner",
      actorCanApproveExtraWithdrawal: actor?.canApproveExtraWithdrawal ?? false,
      extraWithdrawalAuthorized: body.extraWithdrawalAuthorized ?? false,
    });

    const bonusToConsume = resolveBonusToConsume(requestedAmount, reducedCanTake, availableReallocationBonus);
    const withdrawalTransactionPortForRecording: WithdrawalTransactionPort = {
      ...withdrawalTransactionPort,
      recordTransactionBatch: (portInput) =>
        recordWithdrawalTransactionBatchWithBonusConsumption(portInput, bonusToConsume),
    };

    const result = await recordWithdrawalTransactionBatch(
      projectId,
      availableToWithdraw,
      partnerShares,
      subPartnerSharesByPartnerId,
      {
        partyType: body.partyType,
        shareId: body.shareId,
        transactionDate: body.transactionDate,
        rows: body.rows.map((row) => ({
          amount: row.amount,
          paymentMode: row.paymentMode,
          referenceNumber: row.referenceNumber ?? null,
          notes: row.notes ?? null,
        })),
        idempotencyKey: body.idempotencyKey,
      },
      session.userId,
      { withdrawalTransactions: withdrawalTransactionPortForRecording },
    );
    return NextResponse.json(
      { transactions: result.transactions },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      // Thrown by this handler's own early `toMoney(row.amount)` calls (run
      // ahead of `recordWithdrawalTransactionBatch`'s internal normalization,
      // so Story 4.5's gate has a validated total to compare) -- mapped to
      // the exact same 400 shape `InvalidWithdrawalAmountError` uses.
      return NextResponse.json(
        { code: "validation_error", message: new InvalidWithdrawalAmountError().message },
        { status: 400 },
      );
    }
    if (error instanceof OwnerAdminRequiredForExtraWithdrawalError) {
      return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
    }
    if (error instanceof ExtraWithdrawalAuthorizationRequiredError) {
      return NextResponse.json(
        { code: "extra_withdrawal_authorization_required", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof ReallocationBonusInsufficientError) {
      return NextResponse.json(
        { code: "reallocation_bonus_changed", message: error.message },
        { status: 409 },
      );
    }
    if (
      error instanceof InvalidWithdrawalAmountError ||
      error instanceof InvalidWithdrawalDateError ||
      error instanceof InvalidWithdrawalPaymentModeError ||
      error instanceof MissingWithdrawalIdempotencyKeyError ||
      error instanceof EmptyWithdrawalTransactionBatchError
    ) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
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
    if (error instanceof WithdrawalIdempotencyKeyConflictError) {
      // A genuine key collision between two unrelated requests -- never
      // silently return the mismatched rows.
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
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

import { NextResponse, type NextRequest } from "next/server";
import type { InvestmentRequirement, PartnerShare, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  toMoney,
  isZeroMoney,
  InvalidMoneyError,
  InsufficientAvailableBalanceError,
  AvailableBalanceSpendIdempotencyKeyConflictError,
  ShareNotFoundError,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
  type DestinationSnapshotInput,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createInvestmentRequirementPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createAvailableBalanceSpendPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../shared";
import {
  DESTINATION_PROJECT_NOT_FOUND_MESSAGE,
  DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  ZERO_OR_NEGATIVE_AMOUNT_MESSAGE,
  isValidAvailableBalanceSpendBody,
  isValidId,
} from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Mirrors `destination-allocations/route.ts`'s identical local helper. */
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
 * Spends part/all of one Partner/Sub-partner's Available Balance at this
 * (source) Project (Story 4.9, FR29, AD-5/AD-6/AD-10). Gated by
 * `authorizeScope()` for `"available_balances:spend"` (Owner/Admin-only, no
 * self-access, mirroring `withdrawal_destination_allocations:create`'s
 * identical shape). Ordering (review finding: corrected to authorize before
 * ANY DB read, per AD-1 -- `destination-allocations/route.ts`'s own
 * project-existence-before-authorize ordering is a pre-existing Story
 * 4.7/4.8 issue, not mirrored here): session (401) -> `authorizeScope()`
 * (403, before any DB call, so an unauthorized caller can never distinguish
 * "project exists" from "project doesn't exist" by status code alone) ->
 * Project existence (404) -> request body parsed/shape-checked (400
 * `invalid_request`) -> `amount` validated via `toMoney` (400
 * `validation_error`) and confirmed non-zero (400 `validation_error` --
 * mirrors Story 4.8's `ZeroAmountProjectLegError` precedent for the
 * identical class of bug, this story's I/O matrix) -> for a `"project"`
 * spend, `destinationProjectId` confirmed to exist as a real Project (400
 * `validation_error`) and `destinationRequirementId`/
 * `destinationShareId` re-resolved fresh against that destination Project's
 * *current* data (404 `not_found` if either doesn't resolve -- never
 * client-trusted, mirrors Story 4.8's route exactly) ->
 * `createAvailableBalanceSpendPort().recordSpend`.
 *
 * Unlike a withdrawal destination-allocation `"project"` leg
 * (`InvalidDestinationProjectError`), a spend's `"project"` destination is
 * deliberately NOT constrained to differ from this (source) Project -- this
 * story's Decisions #1: "the spend destination is unconstrained to that
 * source Project" (e.g. reinvesting a balance back into the very Project it
 * came from is a legitimate spend).
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

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "available_balances:spend", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const { id: sourceProjectId } = await params;

  if (!isValidProjectId(sourceProjectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(sourceProjectId))) {
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

  if (!isValidAvailableBalanceSpendBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  let amount: ReturnType<typeof toMoney>;
  try {
    amount = toMoney(body.amount);
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
  if (isZeroMoney(amount)) {
    return NextResponse.json(
      { code: "validation_error", message: ZERO_OR_NEGATIVE_AMOUNT_MESSAGE },
      { status: 400 },
    );
  }

  let destinationSnapshotInput: DestinationSnapshotInput | null = null;
  if (body.destinationType === "project") {
    const destinationProjectId = body.destinationProjectId as string;
    if (!isValidId(destinationProjectId) || !(await projectPort.findProjectById(destinationProjectId))) {
      return NextResponse.json(
        { code: "validation_error", message: DESTINATION_PROJECT_NOT_FOUND_MESSAGE },
        { status: 400 },
      );
    }

    const destinationRequirementId = body.destinationRequirementId as string;
    const destinationShareId = body.destinationShareId as string;
    const destinationPartyType = body.destinationPartyType as "partner" | "sub_partner";

    if (!isValidId(destinationRequirementId)) {
      return NextResponse.json(
        { code: "not_found", message: DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }
    const investmentRequirementPort = createInvestmentRequirementPort();
    const requirement: InvestmentRequirement | null =
      await investmentRequirementPort.findById(destinationRequirementId);
    if (!requirement || requirement.projectId !== destinationProjectId) {
      return NextResponse.json(
        { code: "not_found", message: DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }

    const partnerSharePort = createPartnerSharePort();
    const subPartnerSharePort = createSubPartnerSharePort();
    const [partnerShares, subPartnerShares]: [readonly PartnerShare[], readonly SubPartnerShare[]] =
      await Promise.all([
        listCurrentPartnerShares(destinationProjectId, { partnerShares: partnerSharePort }),
        listCurrentSubPartnerSharesForProject(destinationProjectId, { subPartnerShares: subPartnerSharePort }),
      ]);
    const subPartnerSharesByPartnerId = groupByPartnerId(subPartnerShares);
    const shareExists =
      destinationPartyType === "partner"
        ? partnerShares.some((share) => share.partnerId === destinationShareId)
        : Object.values(subPartnerSharesByPartnerId).some((subs) =>
            subs.some((sub) => sub.subPartnerId === destinationShareId),
          );
    if (!shareExists) {
      return NextResponse.json(
        { code: "not_found", message: DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }

    destinationSnapshotInput = { requirement, partnerShares, subPartnerSharesByPartnerId };
  }

  const availableBalanceSpendPort = createAvailableBalanceSpendPort();
  try {
    const result = await availableBalanceSpendPort.recordSpend(
      {
        sourceProjectId,
        partyType: body.partyType,
        shareId: body.shareId,
        destinationType: body.destinationType,
        amount,
        notes: body.notes && body.notes.trim().length > 0 ? body.notes.trim() : null,
        destinationProjectId: body.destinationType === "project" ? body.destinationProjectId : null,
        destinationRequirementId: body.destinationType === "project" ? body.destinationRequirementId : null,
        destinationShareId: body.destinationType === "project" ? body.destinationShareId : null,
        destinationPartyType: body.destinationType === "project" ? body.destinationPartyType : null,
        destinationSnapshotInput,
        personName:
          body.destinationType === "person" && body.personName ? body.personName.trim() : null,
      },
      body.idempotencyKey,
      session.userId,
    );
    return NextResponse.json(
      { spend: result.spend, investmentTransaction: result.investmentTransaction, moneyMovement: result.moneyMovement },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof InsufficientAvailableBalanceError) {
      return NextResponse.json(
        { code: "insufficient_balance", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof AvailableBalanceSpendIdempotencyKeyConflictError) {
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    // Defense-in-depth for the race between this route's own destination-
    // share existence check above and the atomic write -- mirrors
    // `destination-allocations/route.ts`'s identical rationale one story
    // over: `buildTransactionSnapshot` (deep inside
    // `spendAvailableBalanceToProject()`) can still throw these if the
    // destination Project's data changed in that narrow window.
    if (error instanceof ShareNotFoundError) {
      return NextResponse.json(
        { code: "not_found", message: DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }
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
    throw error;
  }
}

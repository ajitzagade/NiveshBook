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
  compareMoney,
  isZeroMoney,
  InvalidMoneyError,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
  WithdrawalReallocationDecliningShareNotFoundError,
  WithdrawalReallocationNoRecipientsError,
  WithdrawalReallocationIdempotencyKeyConflictError,
  WithdrawalReallocationExceedsAvailableError,
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
import { isValidProjectId, projectNotFoundResponse } from "../../shared";
import {
  INVALID_REQUEST_MESSAGE,
  SHARE_NOT_FOUND_MESSAGE,
  isValidWithdrawalReallocationBody,
} from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Mirrors `withdrawal-transactions/route.ts`'s/`withdrawal-adjustments/route.ts`'s identical local helper. */
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

/** Mirrors `withdrawal-transactions/route.ts`'s identical local helper. */
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
 * Records an Owner/Admin's decision that one Partner/Sub-partner is
 * declining some amount of their currently-available Can Take, automatically
 * splitting it pro-rata (by relative Share %) across every other current
 * Partner/Sub-partner in the Project -- Owner/Admin-only, no self-access
 * (confirmed with the founder: a Partner/Sub-partner never declines their
 * own share via this action), gated by `authorizeScope()` for
 * `"withdrawal_reallocations:create"`, checked before any DB read (mirrors
 * `adjustment-nettings/route.ts`'s identical ordering).
 *
 * `declinedAmount` is validated against the target's own *effective* Can
 * Take -- `computeEffectiveCanTake` applied to their live `computeCanTake`
 * figure, netting out any of their own prior active declines and adding any
 * unconsumed bonus they've received as someone else's recipient -- so a
 * share can never decline more than they genuinely still have available
 * right now (400 `validation_error` otherwise). The pro-rata split itself
 * (`computeWithdrawalReallocationSplit`) reuses the identical flattened-leaf
 * precondition checks as Can Take, so a Project whose Partner Shares don't
 * total 100% (or whose Sub-partner Shares over-allocate) is rejected the
 * same way `can-take`/`withdrawal-transactions` already are.
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
  const { allowed } = await authorizeScope(session.userId, "withdrawal_reallocations:create", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
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

  if (!isValidWithdrawalReallocationBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
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

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const reallocationPort = createWithdrawalReallocationPort();
  const [partnerShares, subPartnerShares, totalActiveInvested, totalActiveWithdrawn, activeReallocations, activeAllocations] =
    await Promise.all([
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
    body.partyType === "partner"
      ? partnerShares.find((share) => share.partnerId === body.shareId)
      : subPartnerShares.find((share) => share.subPartnerId === body.shareId);

  if (!target) {
    return NextResponse.json({ code: "not_found", message: SHARE_NOT_FOUND_MESSAGE }, { status: 404 });
  }

  try {
    const declinedAmount = toMoney(body.declinedAmount);

    if (isZeroMoney(declinedAmount)) {
      // `toMoney` already rejects a negative amount (its own format check
      // has no `-` in the pattern); a `"0"` decline is separately rejected
      // here -- it's syntactically valid Money but semantically pointless,
      // and without this guard it would persist a genuine, non-replay,
      // all-zero-legs reallocation record that then needs manual cleanup.
      return NextResponse.json(
        { code: "validation_error", message: "Declined amount must be greater than zero." },
        { status: 400 },
      );
    }

    const canTakeTree = computeCanTake(availableToWithdraw, partnerShares, subPartnerSharesByPartnerId);
    const baseCanTake = findLiveCanTake(canTakeTree, body.partyType, body.shareId) ?? ("0" as Money);
    const effectiveCanTake = computeEffectiveCanTake(
      baseCanTake,
      body.partyType,
      body.shareId,
      activeReallocations,
      activeAllocations,
    );

    if (compareMoney(declinedAmount, effectiveCanTake) > 0) {
      return NextResponse.json(
        {
          code: "validation_error",
          message: "Cannot decline more than this Partner/Sub-partner's own currently-available Can Take.",
        },
        { status: 400 },
      );
    }

    const allocationLegs = computeWithdrawalReallocationSplit(
      body.partyType,
      body.shareId,
      declinedAmount,
      partnerShares,
      subPartnerSharesByPartnerId,
    );

    const result = await reallocationPort.record(
      {
        projectId,
        partyType: body.partyType,
        shareId: body.shareId,
        declinedAmount,
        notes: body.notes && body.notes.trim().length > 0 ? body.notes.trim() : null,
        baseCanTake,
      },
      allocationLegs,
      body.idempotencyKey,
      session.userId,
    );

    return NextResponse.json(
      { reallocation: result.reallocation, allocations: result.allocations },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      return NextResponse.json({ code: "validation_error", message: error.message }, { status: 400 });
    }
    if (error instanceof WithdrawalReallocationExceedsAvailableError) {
      // The same 400 this route's own pre-check above already returns for
      // the common case -- this branch only fires when a concurrent decline
      // for the same share won the race between that pre-check and this
      // port call's own lock-guarded re-check (see the port's doc comment).
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
    if (error instanceof WithdrawalReallocationIdempotencyKeyConflictError) {
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}

/**
 * Lists every currently-active reallocation (and their allocation legs) for
 * a Project -- gated by `authorizeScope()` for
 * `"withdrawal_reallocations:view"` (all 3 roles). An `owner_admin` caller
 * gets every row unfiltered (oversight: who declined how much, per-recipient
 * allocated/consumed). A `partner`/`sub_partner` caller gets a row-level
 * scoped view instead -- resolved here, not by the permission gate itself
 * (this is a list endpoint, not a single `resourceRef`): every reallocation
 * where they are the DECLINER (their own decline's own status/notes) or a
 * RECIPIENT of at least one of its legs (so the plan's "so a Partner can see
 * their own incoming bonus" requirement is met), but only their OWN
 * allocation legs -- never another recipient's -- mirroring this codebase's
 * existing "a Partner's Sub-partner split is private" norm (the Can Take
 * panel's own copy). `isOwnerAdminView` tells the client which case this
 * was, so it can gate the Owner/Admin-only Skip/Cancel UI without treating
 * "the GET succeeded" as a proxy for "this is an Owner/Admin session" now
 * that both can succeed.
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
  const { allowed } = await authorizeScope(session.userId, "withdrawal_reallocations:view", {
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

  const reallocationPort = createWithdrawalReallocationPort();
  const [reallocations, allocations, actor] = await Promise.all([
    reallocationPort.listActiveByProjectId(projectId),
    reallocationPort.listActiveAllocationsByProjectId(projectId),
    userPort.findUserById(session.userId),
  ]);

  if (actor?.role === "owner_admin") {
    return NextResponse.json({ reallocations, allocations, isOwnerAdminView: true });
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const [partnerShares, subPartnerShares] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
  ]);
  const myShareKeys = new Set<string>();
  for (const share of partnerShares) {
    if (share.userId === session.userId) myShareKeys.add(`partner:${share.partnerId}`);
  }
  for (const share of subPartnerShares) {
    if (share.userId === session.userId) myShareKeys.add(`sub_partner:${share.subPartnerId}`);
  }

  const isMine = (partyType: "partner" | "sub_partner", shareId: string) =>
    myShareKeys.has(`${partyType}:${shareId}`);

  const scopedAllocations = allocations.filter((allocation) => isMine(allocation.partyType, allocation.shareId));
  const reallocationIdsIAmRecipientOf = new Set(scopedAllocations.map((allocation) => allocation.reallocationId));
  const scopedReallocations = reallocations.filter(
    (reallocation) =>
      isMine(reallocation.partyType, reallocation.shareId) || reallocationIdsIAmRecipientOf.has(reallocation.id),
  );

  return NextResponse.json({
    reallocations: scopedReallocations,
    allocations: scopedAllocations,
    isOwnerAdminView: false,
  });
}

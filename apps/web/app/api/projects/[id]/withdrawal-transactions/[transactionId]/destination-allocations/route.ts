import { NextResponse, type NextRequest } from "next/server";
import type { InvestmentRequirement, PartnerShare, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listWithdrawalTransactions,
  recordDestinationAllocation,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  AllocationMismatchError,
  InvalidDestinationProjectError,
  MissingDestinationRequirementError,
  ZeroAmountProjectLegError,
  AlreadyAllocatedError,
  WithdrawalDestinationAllocationIdempotencyKeyConflictError,
  InvalidMoneyError,
  ShareNotFoundError,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
  type DestinationSnapshotInput,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createWithdrawalTransactionPort,
  createWithdrawalDestinationAllocationPort,
  createInvestmentRequirementPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { UUID_PATTERN } from "@/lib/ids";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import {
  DESTINATION_PROJECT_NOT_FOUND_MESSAGE,
  DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  isValidDestinationAllocationBody,
  isValidWithdrawalTransactionId,
  withdrawalTransactionNotFoundResponse,
} from "./shared";

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `buildTransactionSnapshot` (via
 * `moveWithdrawalToProject()`) expects. Mirrors
 * `investment-requirements/[requirementId]/should-pay/route.ts`'s local
 * helper of the same name -- kept local to each route rather than shared,
 * matching that file's own precedent.
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

interface RouteContext {
  params: Promise<{ id: string; transactionId: string }>;
}

/**
 * Records a withdrawal's full "Where did this money go?" destination split
 * in one atomic save (Story 4.7, FR27) -- Owner/Admin-only, no self-access
 * (spec-4-7's Decisions), gated by `authorizeScope()` for
 * `"withdrawal_destination_allocations:create"`, mirroring
 * `investment_transactions:cancel`'s identical all-or-nothing-for-the-role
 * shape (that route's own `POST .../cancel/route.ts` precedent).
 *
 * Exact ordering per this story's Boundaries: session (401) -> project
 * existence (404) -> the target withdrawal transaction resolved against this
 * Project's own recorded withdrawals (404 if missing, malformed, or it
 * belongs to a different Project -- `listWithdrawalTransactions` is already
 * Project-scoped, so a cross-Project id simply never matches) ->
 * `authorizeScope()` (403 `forbidden`) -> request body parsed and
 * shape-checked (400 `invalid_request`) -> every `"project"` leg's
 * `destinationProjectId` confirmed to exist as a real Project (400
 * `validation_error` otherwise -- this route's own job, since
 * `recordDestinationAllocation` deliberately has no `ProjectPort` dependency,
 * Interface Segregation) -> every `"project"` leg's `destinationRequirementId`/
 * `destinationShareId` re-resolved against that destination Project's
 * *current* data (Story 4.8, FR28: 404 `not_found` if either doesn't resolve
 * -- never trusting the client's earlier fetch, mirroring
 * `destinationProjectId`'s own existence-check precedent one step earlier) ->
 * `recordDestinationAllocation` itself, whose exact-sum/self-Project/
 * write-once/idempotency contract is documented on that function and
 * `WithdrawalDestinationAllocationPort.recordAllocation` -- extended by
 * Story 4.8 to also auto-create, atomically, every `"project"` leg's linked
 * `investment_transactions`/`money_movements` rows (FR28, AD-6).
 *
 * A repeated `POST` with the same `idempotencyKey` and matching legs returns
 * the *original* rows with `200` (not `201`) -- mirrors
 * `withdrawal-transactions/route.ts`'s identical replay-status convention.
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

  const { id: projectId, transactionId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  if (!isValidWithdrawalTransactionId(transactionId)) {
    return withdrawalTransactionNotFoundResponse();
  }

  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const transactions = await listWithdrawalTransactions(projectId, {
    withdrawalTransactions: withdrawalTransactionPort,
  });
  const withdrawal = transactions.find((transaction) => transaction.id === transactionId);
  // `listWithdrawalTransactions` is already Project-scoped (its own
  // `listByProjectId` query filters server-side), so a cross-Project id
  // can't actually appear in `transactions` in real operation -- the
  // `withdrawal.projectId !== projectId` half of this check is defense in
  // depth only, mirroring the investment-transaction cancel route's
  // identical explicit belongs-to-a-different-Project guard (this story's
  // Boundaries names both cases -- missing or cross-Project -- as one 404).
  if (!withdrawal || withdrawal.projectId !== projectId) {
    return withdrawalTransactionNotFoundResponse();
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "withdrawal_destination_allocations:create", {
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

  if (!isValidDestinationAllocationBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  // Every distinct `destinationProjectId` named by a "project" leg must
  // exist -- `recordDestinationAllocation` (packages/core) only checks it
  // differs from the source Project, never that it actually exists
  // (deliberately no `ProjectPort` dependency there). Checked in parallel,
  // deduped via a `Set` so a split naming the same destination Project twice
  // (two separate legs) doesn't look it up redundantly.
  const projectLegIds = [
    ...new Set(
      body.legs
        .filter((leg) => leg.destinationType === "project")
        .map((leg) => leg.destinationProjectId as string),
    ),
  ];
  // Malformed ids (not a UUID) can never match a row -- checked before ever
  // touching the DB, mirroring `isValidProjectId`/`isValidWithdrawalTransactionId`'s
  // identical shape-check-before-query convention above, so a malformed
  // `destinationProjectId` maps to the same 400 `validation_error` a
  // nonexistent-but-well-formed one does, rather than risking an unhandled
  // 500 from `findProjectById`.
  const malformedDestinationProjectId = projectLegIds.some((id) => !isValidProjectId(id));
  const projectLegLookups = malformedDestinationProjectId
    ? []
    : await Promise.all(projectLegIds.map(async (id) => [id, await projectPort.findProjectById(id)] as const));
  const missingDestinationProject =
    malformedDestinationProjectId || projectLegLookups.some(([, found]) => !found);
  if (missingDestinationProject) {
    return NextResponse.json(
      { code: "validation_error", message: DESTINATION_PROJECT_NOT_FOUND_MESSAGE },
      { status: 400 },
    );
  }

  // Story 4.8 (FR28): every "project" leg's destinationRequirementId/
  // destinationShareId, re-resolved against the destination Project's
  // *current* data (never the client's earlier fetch) -- fresh on every
  // request, mirroring destinationProjectId's own existence-check precedent
  // immediately above. Cached per (destinationProjectId, destinationRequirementId)
  // pair so two "project" legs naming the same destination requirement don't
  // fetch it twice.
  const investmentRequirementPort = createInvestmentRequirementPort();
  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const snapshotCache = new Map<string, DestinationSnapshotInput | null>();

  async function resolveDestinationSnapshot(
    destinationProjectId: string,
    destinationRequirementId: string,
  ): Promise<DestinationSnapshotInput | null> {
    const cacheKey = `${destinationProjectId}:${destinationRequirementId}`;
    if (snapshotCache.has(cacheKey)) {
      return snapshotCache.get(cacheKey) ?? null;
    }
    if (!UUID_PATTERN.test(destinationRequirementId)) {
      snapshotCache.set(cacheKey, null);
      return null;
    }
    const requirement: InvestmentRequirement | null =
      await investmentRequirementPort.findById(destinationRequirementId);
    if (!requirement || requirement.projectId !== destinationProjectId) {
      snapshotCache.set(cacheKey, null);
      return null;
    }
    const [partnerShares, subPartnerShares]: [readonly PartnerShare[], readonly SubPartnerShare[]] =
      await Promise.all([
        listCurrentPartnerShares(destinationProjectId, { partnerShares: partnerSharePort }),
        listCurrentSubPartnerSharesForProject(destinationProjectId, {
          subPartnerShares: subPartnerSharePort,
        }),
      ]);
    const snapshot: DestinationSnapshotInput = {
      requirement,
      partnerShares,
      subPartnerSharesByPartnerId: groupByPartnerId(subPartnerShares),
    };
    snapshotCache.set(cacheKey, snapshot);
    return snapshot;
  }

  const legSnapshots = new Map<number, DestinationSnapshotInput>();
  for (let index = 0; index < body.legs.length; index++) {
    const leg = body.legs[index];
    if (!leg || leg.destinationType !== "project") continue;
    // `isValidDestinationAllocationBody`'s shape guard already requires
    // non-empty destinationProjectId/destinationRequirementId/destinationShareId/
    // destinationPartyType for every "project" leg -- these casts reflect
    // that already-proven invariant, not a new assumption.
    const destinationProjectId = leg.destinationProjectId as string;
    const destinationRequirementId = leg.destinationRequirementId as string;
    const destinationShareId = leg.destinationShareId as string;
    const destinationPartyType = leg.destinationPartyType as "partner" | "sub_partner";

    const snapshot = await resolveDestinationSnapshot(destinationProjectId, destinationRequirementId);
    if (!snapshot) {
      return NextResponse.json(
        { code: "not_found", message: DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }
    const shareExists =
      destinationPartyType === "partner"
        ? snapshot.partnerShares.some((share) => share.partnerId === destinationShareId)
        : Object.values(snapshot.subPartnerSharesByPartnerId).some((subs) =>
            subs.some((sub) => sub.subPartnerId === destinationShareId),
          );
    if (!shareExists) {
      return NextResponse.json(
        { code: "not_found", message: DESTINATION_REQUIREMENT_OR_SHARE_NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }
    legSnapshots.set(index, snapshot);
  }

  const legsWithSnapshot = body.legs.map((leg, index) => ({
    ...leg,
    destinationSnapshot: legSnapshots.get(index) ?? null,
  }));

  const withdrawalDestinationAllocationPort = createWithdrawalDestinationAllocationPort();
  try {
    const result = await recordDestinationAllocation(
      withdrawal,
      legsWithSnapshot,
      projectId,
      session.userId,
      body.idempotencyKey,
      { withdrawalDestinationAllocations: withdrawalDestinationAllocationPort },
    );
    return NextResponse.json(
      { allocations: result.allocations, moneyMovements: result.moneyMovements },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    if (
      error instanceof InvalidDestinationProjectError ||
      error instanceof MissingDestinationRequirementError ||
      error instanceof ZeroAmountProjectLegError
    ) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof AllocationMismatchError) {
      return NextResponse.json(
        { code: "allocation_mismatch", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof AlreadyAllocatedError) {
      return NextResponse.json(
        { code: "already_allocated", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof WithdrawalDestinationAllocationIdempotencyKeyConflictError) {
      // A genuine key collision between two unrelated requests (see
      // `packages/db`'s `matchesAllocationRequest`/
      // `WithdrawalDestinationAllocationIdempotencyKeyConflictError` doc
      // comments) -- never silently return the mismatched rows.
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    // Story 4.8 (FR28): defense-in-depth for the race between this route's
    // own destination-share existence check above and the atomic write --
    // `buildTransactionSnapshot` (deep inside `moveWithdrawalToProject()`,
    // called from `recordAllocation`'s transaction) can still throw these if
    // the destination Project's data changed in that narrow window, this
    // story's I/O matrix.
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

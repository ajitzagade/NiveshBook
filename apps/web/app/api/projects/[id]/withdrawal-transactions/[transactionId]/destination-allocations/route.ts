import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  listWithdrawalTransactions,
  recordDestinationAllocation,
  AllocationMismatchError,
  InvalidDestinationProjectError,
  AlreadyAllocatedError,
  WithdrawalDestinationAllocationIdempotencyKeyConflictError,
  InvalidMoneyError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createWithdrawalTransactionPort,
  createWithdrawalDestinationAllocationPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import {
  DESTINATION_PROJECT_NOT_FOUND_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  isValidDestinationAllocationBody,
  isValidWithdrawalTransactionId,
  withdrawalTransactionNotFoundResponse,
} from "./shared";

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
 * Interface Segregation) -> `recordDestinationAllocation` itself, whose
 * exact-sum/self-Project/write-once/idempotency contract is documented on
 * that function and `WithdrawalDestinationAllocationPort.recordAllocation`.
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

  const withdrawalDestinationAllocationPort = createWithdrawalDestinationAllocationPort();
  try {
    const result = await recordDestinationAllocation(
      withdrawal,
      body.legs,
      projectId,
      session.userId,
      body.idempotencyKey,
      { withdrawalDestinationAllocations: withdrawalDestinationAllocationPort },
    );
    return NextResponse.json(
      { allocations: result.allocations },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof InvalidDestinationProjectError) {
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
    throw error;
  }
}

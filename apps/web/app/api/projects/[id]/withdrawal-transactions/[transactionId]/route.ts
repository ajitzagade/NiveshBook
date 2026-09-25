import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  editWithdrawalTransaction,
  WithdrawalAlreadyCancelledError,
  WithdrawalAmountLockedByAllocationError,
  InvalidWithdrawalAmountError,
  InvalidWithdrawalDateError,
  InvalidWithdrawalPaymentModeError,
  MissingWithdrawalIdempotencyKeyError,
  WithdrawalIdempotencyKeyConflictError,
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
import { isValidProjectId, projectNotFoundResponse } from "../../../shared";
import {
  EDIT_INVALID_REQUEST_MESSAGE,
  isValidEditWithdrawalTransactionBody,
  isValidTransactionId,
  transactionNotFoundResponse,
} from "../shared";

interface RouteContext {
  params: Promise<{ id: string; transactionId: string }>;
}

/**
 * Edits a previously recorded withdrawal's mutable fields IN PLACE (Story
 * 4.11) -- Owner/Admin-only, no self-access (mirrors
 * `investment-requirements/[requirementId]/transactions/[transactionId]/route.ts`'s
 * `PATCH` one ledger over -- this story's Decisions mirror Story 3.7's
 * identical "As an Owner/Admin" persona, no self-service qualifier), gated
 * by `authorizeScope()` for `"withdrawal_transactions:edit"`.
 *
 * Exact ordering per this story's Boundaries/Code Map: session (401) ->
 * project existence (404) -> withdrawal existence, incl. cross-project
 * mismatch (404) -> `authorizeScope()` (403 `forbidden`, checked *before*
 * body parsing, mirroring the investment side's identical ordering) ->
 * request body parsed and shape-checked (400 `invalid_request`) -> field
 * validation of amount/date/paymentMode/idempotencyKey, reused unchanged
 * from Story 4.2 (400 `validation_error`) -> `editWithdrawalTransaction` ->
 * 200.
 *
 * A repeated `PATCH` with the same `idempotencyKey` also returns 200 (never
 * 409/201) -- mirrors the investment side's identical "200 either way"
 * convention for a genuine edit vs. a replay.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
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

  if (!isValidTransactionId(transactionId)) {
    return transactionNotFoundResponse();
  }

  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const transaction = await withdrawalTransactionPort.findById(transactionId);
  if (!transaction || transaction.projectId !== projectId) {
    return transactionNotFoundResponse();
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "withdrawal_transactions:edit", {
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
      { code: "invalid_request", message: EDIT_INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (!isValidEditWithdrawalTransactionBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: EDIT_INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const withdrawalDestinationAllocationPort = createWithdrawalDestinationAllocationPort();
  try {
    const result = await editWithdrawalTransaction(
      transactionId,
      {
        amount: body.amount,
        transactionDate: body.transactionDate,
        paymentMode: body.paymentMode,
        referenceNumber: body.referenceNumber ?? null,
        notes: body.notes ?? null,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason ?? null,
      },
      session.userId,
      {
        withdrawalTransactions: withdrawalTransactionPort,
        withdrawalDestinationAllocations: withdrawalDestinationAllocationPort,
      },
    );
    return NextResponse.json(result.transaction, { status: 200 });
  } catch (error) {
    if (
      error instanceof InvalidWithdrawalAmountError ||
      error instanceof InvalidWithdrawalDateError ||
      error instanceof InvalidWithdrawalPaymentModeError ||
      error instanceof MissingWithdrawalIdempotencyKeyError
    ) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof WithdrawalIdempotencyKeyConflictError) {
      // A genuine key collision between two unrelated edit requests -- never
      // silently return the mismatched row.
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof WithdrawalAmountLockedByAllocationError) {
      // This story's Decisions #5: amount is locked once a destination
      // allocation already exists -- every other field stays editable.
      return NextResponse.json(
        { code: "amount_locked_by_allocation", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof WithdrawalAlreadyCancelledError) {
      return NextResponse.json(
        { code: "already_cancelled", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}

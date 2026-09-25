import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  cancelWithdrawalTransaction,
  WithdrawalAlreadyCancelledError,
  AlreadyCancelledError,
  MissingWithdrawalIdempotencyKeyError,
  WithdrawalIdempotencyKeyConflictError,
  InsufficientAvailableBalanceError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createWithdrawalTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import {
  CANCEL_INVALID_REQUEST_MESSAGE,
  isValidCancelWithdrawalTransactionBody,
  isValidTransactionId,
  transactionNotFoundResponse,
} from "../../shared";

interface RouteContext {
  params: Promise<{ id: string; transactionId: string }>;
}

/**
 * Cancels/reverses a previously recorded withdrawal (Story 4.11) --
 * Owner/Admin-only, no self-access (mirrors `PATCH .../[transactionId]`'s
 * `"withdrawal_transactions:edit"` shape exactly, one action over), gated by
 * `authorizeScope()` for `"withdrawal_transactions:cancel"`.
 *
 * Exact ordering per this story's Boundaries, identical to the PATCH route:
 * session (401) -> project existence (404) -> withdrawal existence, incl.
 * cross-project mismatch (404) -> `authorizeScope()` (403 `forbidden`,
 * checked *before* body parsing) -> request body parsed and shape-checked
 * (400 `invalid_request`) -> `idempotencyKey` presence (400
 * `validation_error`) -> `cancelWithdrawalTransaction` -> 200, whose own
 * cascade (`cancelWithdrawalBundle()`, via `packages/db`'s `cancelTransaction`)
 * cancels every linked "project" leg's destination `investment_transactions`
 * row and reverses every linked "available_balance" leg's credited pool,
 * atomically with the withdrawal's own status flip.
 *
 * Maps `WithdrawalAlreadyCancelledError` to 409 `already_cancelled`,
 * `InsufficientAvailableBalanceError` (this story's Decisions #2 -- the
 * pool's cascade-reversal leg couldn't be applied because it was already
 * partly/fully spent onward) to 409 `insufficient_balance_to_reverse`. Also
 * maps the investment-side `AlreadyCancelledError` (propagated from
 * `cancelWithdrawalBundle()`'s cascade, in the rare case a "project" leg's
 * destination row was somehow already independently cancelled) to the same
 * 409 `already_cancelled` -- from the caller's perspective, "this couldn't
 * be cancelled because part of the bundle already was" reads identically
 * either way (documented in spec-4-11's Implementation Notes).
 *
 * A repeated `POST` with the same `idempotencyKey` also returns 200 (never
 * 409/201) -- mirrors the investment side's identical "200 either way"
 * convention for a genuine cancel vs. a replay.
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

  if (!isValidTransactionId(transactionId)) {
    return transactionNotFoundResponse();
  }

  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const transaction = await withdrawalTransactionPort.findById(transactionId);
  if (!transaction || transaction.projectId !== projectId) {
    return transactionNotFoundResponse();
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "withdrawal_transactions:cancel", {
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
      { code: "invalid_request", message: CANCEL_INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (!isValidCancelWithdrawalTransactionBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: CANCEL_INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  try {
    const result = await cancelWithdrawalTransaction(
      transactionId,
      { idempotencyKey: body.idempotencyKey, reason: body.reason ?? null },
      session.userId,
      { withdrawalTransactions: withdrawalTransactionPort },
    );
    return NextResponse.json(
      {
        originalTransaction: result.originalTransaction,
        reversalTransaction: result.reversalTransaction,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof MissingWithdrawalIdempotencyKeyError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof WithdrawalAlreadyCancelledError || error instanceof AlreadyCancelledError) {
      return NextResponse.json(
        { code: "already_cancelled", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof InsufficientAvailableBalanceError) {
      return NextResponse.json(
        { code: "insufficient_balance_to_reverse", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof WithdrawalIdempotencyKeyConflictError) {
      // A genuine key collision between two unrelated cancel requests --
      // never silently return the mismatched row.
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}

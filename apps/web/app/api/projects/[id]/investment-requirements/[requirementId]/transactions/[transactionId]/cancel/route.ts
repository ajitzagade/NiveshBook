import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  cancelInvestmentTransaction,
  AlreadyCancelledError,
  MissingIdempotencyKeyError,
  IdempotencyKeyConflictError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createInvestmentRequirementPort,
  createInvestmentTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../../../shared";
import { isValidRequirementId, requirementNotFoundResponse } from "../../../../shared";
import {
  CANCEL_INVALID_REQUEST_MESSAGE,
  isValidCancelTransactionBody,
  isValidTransactionId,
  transactionNotFoundResponse,
} from "../../shared";

interface RouteContext {
  params: Promise<{ id: string; requirementId: string; transactionId: string }>;
}

/**
 * Cancels/reverses a previously recorded transaction (Story 3.8, FR42) --
 * Owner/Admin-only, no self-access (mirrors `PATCH .../transactions/[transactionId]`'s
 * `"investment_transactions:edit"` shape exactly, one action over), gated by
 * `authorizeScope()` for `"investment_transactions:cancel"`.
 *
 * Exact ordering per this story's Boundaries, identical to the PATCH route:
 * session (401) -> project existence (404) -> requirement existence, incl.
 * cross-project mismatch (404) -> transaction existence, incl.
 * cross-requirement/cross-project mismatch (404) -> `authorizeScope()` (403
 * `forbidden`, checked *before* body parsing) -> request body parsed and
 * shape-checked (400 `invalid_request`) -> `idempotencyKey` presence,
 * reused from Story 3.7 (400 `validation_error`) -> `cancelInvestmentTransaction`
 * -> 200, mapping `AlreadyCancelledError` to 409 `already_cancelled`.
 *
 * A repeated `POST` with the same `idempotencyKey` also returns 200 (never
 * 409/201) -- `cancelInvestmentTransaction`'s `cancelled` flag isn't
 * surfaced in the response body; the returned original/reversal transactions
 * are otherwise identical either way, mirroring the PATCH route's identical
 * "200 either way" convention for a genuine cancel vs. a replay.
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

  const { id: projectId, requirementId, transactionId } = await params;

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

  if (!isValidTransactionId(transactionId)) {
    return transactionNotFoundResponse();
  }

  const investmentTransactionPort = createInvestmentTransactionPort();
  const transaction = await investmentTransactionPort.findById(transactionId);
  if (
    !transaction ||
    transaction.requirementId !== requirementId ||
    transaction.projectId !== projectId
  ) {
    return transactionNotFoundResponse();
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "investment_transactions:cancel", {
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

  if (!isValidCancelTransactionBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: CANCEL_INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  try {
    const result = await cancelInvestmentTransaction(
      transactionId,
      { idempotencyKey: body.idempotencyKey, reason: body.reason ?? null },
      session.userId,
      { investmentTransactions: investmentTransactionPort },
    );
    return NextResponse.json(
      {
        originalTransaction: result.originalTransaction,
        reversalTransaction: result.reversalTransaction,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof MissingIdempotencyKeyError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof AlreadyCancelledError) {
      return NextResponse.json(
        { code: "already_cancelled", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof IdempotencyKeyConflictError) {
      // A genuine key collision between two unrelated cancel requests (see
      // `packages/db`'s `matchesCancelRequest`/`IdempotencyKeyConflictError`
      // doc comments) -- never silently return the mismatched row.
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}

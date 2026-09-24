import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  editInvestmentTransaction,
  AlreadyCancelledError,
  InvalidTransactionAmountError,
  InvalidTransactionDateError,
  InvalidPaymentModeError,
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
import { isValidProjectId, projectNotFoundResponse } from "../../../../../shared";
import { isValidRequirementId, requirementNotFoundResponse } from "../../../shared";
import {
  EDIT_INVALID_REQUEST_MESSAGE,
  isValidEditTransactionBody,
  isValidTransactionId,
  transactionNotFoundResponse,
} from "../shared";

interface RouteContext {
  params: Promise<{ id: string; requirementId: string; transactionId: string }>;
}

/**
 * Edits a previously recorded transaction's mutable fields IN PLACE (Story
 * 3.7, FR41) -- Owner/Admin-only, no self-access (unlike Story 3.3's
 * `investment_transactions:create`; this story's Decisions: the AC's
 * persona is explicitly "As an Owner/Admin", with no self-service
 * qualifier), gated by `authorizeScope()` for `"investment_transactions:edit"`.
 *
 * Exact ordering per this story's Boundaries: session (401) -> project
 * existence (404) -> requirement existence, incl. cross-project mismatch
 * (404) -> transaction existence, incl. cross-requirement/cross-project
 * mismatch (404) -> `authorizeScope()` (403 `forbidden`, checked *before*
 * body parsing -- this codebase's established ordering convention, e.g.
 * `transactions/route.ts`'s `GET`) -> request body parsed and shape-checked
 * (400 `invalid_request`) -> field validation of amount/date/paymentMode/
 * idempotencyKey, reused unchanged from Story 3.3 (400 `validation_error`)
 * -> `editInvestmentTransaction` -> 200.
 *
 * A repeated `PATCH` with the same `idempotencyKey` also returns `200`
 * (never `409`/`201`) -- unlike `POST .../transactions`'s 201-vs-200 split,
 * this story's I/O matrix returns 200 either way: "new value saved" for a
 * genuine edit, or the transaction's already-edited current state for a
 * replay. `editInvestmentTransaction`'s `edited` flag isn't surfaced in the
 * response body -- the returned transaction is otherwise identical either
 * way.
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
  const { allowed } = await authorizeScope(session.userId, "investment_transactions:edit", {
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

  if (!isValidEditTransactionBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: EDIT_INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  try {
    const result = await editInvestmentTransaction(
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
      { investmentTransactions: investmentTransactionPort },
    );
    return NextResponse.json(result.transaction, { status: 200 });
  } catch (error) {
    if (
      error instanceof InvalidTransactionAmountError ||
      error instanceof InvalidTransactionDateError ||
      error instanceof InvalidPaymentModeError ||
      error instanceof MissingIdempotencyKeyError
    ) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof IdempotencyKeyConflictError) {
      // A genuine key collision between two unrelated edit requests (see
      // `packages/db`'s `matchesEditRequest`/`IdempotencyKeyConflictError`
      // doc comments) -- never silently return the mismatched row.
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof AlreadyCancelledError) {
      // Story 3.8: `editInvestmentTransaction`'s new early guard -- a
      // cancelled transaction is a closed financial record and can no
      // longer be edited.
      return NextResponse.json(
        { code: "already_cancelled", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}

import { NextResponse, type NextRequest } from "next/server";
import type { SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorize,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  recordWithdrawalTransaction,
  listWithdrawalTransactions,
  InvalidWithdrawalAmountError,
  InvalidWithdrawalDateError,
  InvalidWithdrawalPaymentModeError,
  MissingWithdrawalIdempotencyKeyError,
  WithdrawalShareNotFoundError,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
  WithdrawalIdempotencyKeyConflictError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, isValidWithdrawalTransactionBody, shareNotFoundResponse } from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `computeCanTake` (via `recordWithdrawalTransaction`'s
 * `buildWithdrawalSnapshot`) expects. Mirrors `can-take/route.ts`'s local
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

/**
 * Records a "Take Now" withdrawal against one Project's Can Take (Story 4.1)
 * for a specific Partner/Sub-partner (Story 4.2) -- self-access allowed (a
 * Partner/Sub-partner may record their own withdrawal), alongside
 * unconditional Owner/Admin access, gated by `authorize()` for
 * `"withdrawal_transactions:create"`.
 *
 * Exact ordering per this story's Boundaries: session (401) -> project
 * existence (404) -> request body parsed and shape-checked (400
 * `invalid_request` -- needed this early since `partyType`/`shareId` drive
 * the very next step) -> current Partner/Sub-partner Shares plus the
 * Project's available-to-withdraw amount fetched -> target-share resolved by
 * `partyType`+`shareId` against those *current* shares (404 `not_found` if
 * no match) -> `authorize()` with `resourceRef.ownerId` set to the target
 * share's `userId` (403 `forbidden`) -> field validation of amount/date/
 * paymentMode/idempotencyKey (400 `validation_error`) -> Can Take
 * preconditions, reused from Story 4.1's `computeCanTake` (409) -> write.
 *
 * A repeated `POST` with the same `idempotencyKey` and matching content
 * returns the *original* row with `200` (not `201`) --
 * `recordWithdrawalTransaction`'s `created` flag (threaded from the port,
 * AD-5) tells this route which status to use; the returned transaction body
 * is otherwise identical either way. No cap against Can Take is enforced
 * here (this story's Decisions) -- any amount, including one exceeding
 * `canTakeSnapshot`, is accepted and recorded as-is.
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

  if (!isValidWithdrawalTransactionBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const [partnerShares, subPartnerShares, availableToWithdraw] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
    investmentTransactionPort.sumActiveAmountByProjectId(projectId),
  ]);

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

  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  try {
    const result = await recordWithdrawalTransaction(
      projectId,
      availableToWithdraw,
      partnerShares,
      groupByPartnerId(subPartnerShares),
      {
        partyType: body.partyType,
        shareId: body.shareId,
        amount: body.amount,
        transactionDate: body.transactionDate,
        paymentMode: body.paymentMode,
        referenceNumber: body.referenceNumber ?? null,
        notes: body.notes ?? null,
        idempotencyKey: body.idempotencyKey,
      },
      session.userId,
      { withdrawalTransactions: withdrawalTransactionPort },
    );
    return NextResponse.json(result.transaction, { status: result.created ? 201 : 200 });
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
      // A genuine key collision between two unrelated requests (see
      // `packages/db`'s `matchesWithdrawalRequest`/
      // `WithdrawalIdempotencyKeyConflictError` doc comments) -- never
      // silently return the mismatched row.
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

/**
 * Lists every withdrawal recorded against one Project (Story 4.2, closing
 * Review Triage Log row 1 -- new this round) -- Owner/Admin-only (listing is
 * oversight functionality, mirroring `investment_transactions:list`'s
 * identical precedent), gated by `authorizeScope()` for
 * `"withdrawal_transactions:list"` with no `scopeOwnerIds`. Mirrors
 * `investment-requirements/[requirementId]/transactions/route.ts`'s `GET`
 * ordering: authorization is checked before any DB read, then project
 * existence.
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
  const { allowed } = await authorizeScope(session.userId, "withdrawal_transactions:list", {
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

  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const transactions = await listWithdrawalTransactions(projectId, {
    withdrawalTransactions: withdrawalTransactionPort,
  });

  return NextResponse.json({ transactions });
}

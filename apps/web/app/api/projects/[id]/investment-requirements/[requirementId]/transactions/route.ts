import { NextResponse, type NextRequest } from "next/server";
import type { SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorize,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  recordInvestmentTransaction,
  listInvestmentTransactions,
  InvalidTransactionAmountError,
  InvalidTransactionDateError,
  InvalidPaymentModeError,
  MissingIdempotencyKeyError,
  ShareNotFoundError,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
  IdempotencyKeyConflictError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentRequirementPort,
  createInvestmentTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import { isValidRequirementId, requirementNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, isValidTransactionBody, shareNotFoundResponse } from "./shared";

interface RouteContext {
  params: Promise<{ id: string; requirementId: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `computeShouldPay` (via `recordInvestmentTransaction`'s
 * `buildTransactionSnapshot`) expects. Mirrors `should-pay/route.ts`'s local
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
 * Records a "Paid Now" transaction against one funding requirement's Should
 * Pay for a specific Partner/Sub-partner (Story 3.3) -- self-access allowed
 * (a Partner/Sub-partner may record their own payment), alongside
 * unconditional Owner/Admin access, gated by `authorize()` for
 * `"investment_transactions:create"`.
 *
 * Exact ordering per this story's Boundaries: session (401) -> project
 * existence (404) -> requirement existence, incl. cross-project mismatch
 * (404) -> request body parsed and shape-checked (400 `invalid_request` --
 * needed this early since `partyType`/`shareId` drive the very next step)
 * -> current Partner/Sub-partner Shares fetched -> target-share resolved by
 * `partyType`+`shareId` against those *current* shares (404 `not_found` if
 * no match) -> `authorize()` with `resourceRef.ownerId` set to the target
 * share's `userId` (403 `forbidden`) -> field validation of amount/date/
 * paymentMode/idempotencyKey (400 `validation_error`) -> Should Pay
 * preconditions, reused from Story 3.2's `computeShouldPay` (409) -> write.
 *
 * A repeated `POST` with the same `idempotencyKey` returns the *original*
 * row with `200` (not `201`) -- `recordInvestmentTransaction`'s `created`
 * flag (threaded from the port, AD-5) tells this route which status to use;
 * the returned transaction body is otherwise identical either way.
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

  const { id: projectId, requirementId } = await params;

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (!isValidTransactionBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const [partnerShares, subPartnerShares] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
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
    "investment_transactions:create",
    { ownerId: target.userId ?? "" },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const investmentTransactionPort = createInvestmentTransactionPort();
  try {
    const result = await recordInvestmentTransaction(
      projectId,
      requirementId,
      requirement,
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
      { investmentTransactions: investmentTransactionPort },
    );
    return NextResponse.json(result.transaction, { status: result.created ? 201 : 200 });
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
    if (error instanceof IdempotencyKeyConflictError) {
      // A genuine key collision between two unrelated requests (see
      // `packages/db`'s `matchesRequest`/`IdempotencyKeyConflictError` doc
      // comments) -- never silently return the mismatched row.
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof ShareNotFoundError) {
      // Defense in depth only -- the target share's existence was already
      // confirmed above, against the same fetched Partner/Sub-partner
      // Shares, before `authorize()` ever ran.
      return shareNotFoundResponse();
    }
    throw error;
  }
}

/**
 * Lists every transaction recorded against one funding requirement --
 * Owner/Admin-only (this story's Decisions: listing is oversight
 * functionality, unlike recording), gated by `authorizeScope()` for
 * `"investment_transactions:list"` with no `scopeOwnerIds`. Mirrors
 * `investment-requirements/route.ts`'s `GET` ordering: authorization is
 * checked before any DB read, then existence (project, then requirement).
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
  const { allowed } = await authorizeScope(session.userId, "investment_transactions:list", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const { id: projectId, requirementId } = await params;

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

  const investmentTransactionPort = createInvestmentTransactionPort();
  const transactions = await listInvestmentTransactions(requirementId, {
    investmentTransactions: investmentTransactionPort,
  });

  return NextResponse.json({ transactions });
}

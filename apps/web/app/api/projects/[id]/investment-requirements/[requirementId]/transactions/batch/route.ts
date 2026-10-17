import { NextResponse, type NextRequest } from "next/server";
import type { SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorize,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  recordInvestmentTransactionBatch,
  InvalidTransactionAmountError,
  InvalidTransactionDateError,
  InvalidPaymentModeError,
  MissingIdempotencyKeyError,
  EmptyTransactionBatchError,
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
import { isValidProjectId, projectNotFoundResponse } from "../../../../../shared";
import { isValidRequirementId, requirementNotFoundResponse } from "../../../shared";
import { shareNotFoundResponse } from "../shared";
import { INVALID_REQUEST_MESSAGE, isValidTransactionBatchBody } from "./shared";

interface RouteContext {
  params: Promise<{ id: string; requirementId: string }>;
}

/** Mirrors `../route.ts`'s identical local helper. */
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
 * Records a split payment -- one Partner/Sub-partner's one contribution,
 * paid across multiple payment methods -- as multiple `investment_transactions`
 * rows against one funding requirement, atomically (all rows or none).
 * Mirrors `../route.ts`'s `POST` handler exactly: same auth/existence/
 * ordering (session -> project -> requirement -> body shape -> target share
 * -> `authorize()` -> field validation -> Should Pay preconditions -> write),
 * same self-access-or-Owner/Admin `"investment_transactions:create"` gate --
 * this is still one logical write action from the caller's perspective, just
 * producing several rows instead of one.
 *
 * A repeated `POST` with the same `idempotencyKey` returns the *original*
 * batch's rows with `200` (not `201`) -- `recordInvestmentTransactionBatch`'s
 * `created` flag (threaded from the port) tells this route which status to
 * use, mirroring the single-row route's identical convention.
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

  if (!isValidTransactionBatchBody(body)) {
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
    const result = await recordInvestmentTransactionBatch(
      projectId,
      requirementId,
      requirement,
      partnerShares,
      groupByPartnerId(subPartnerShares),
      {
        partyType: body.partyType,
        shareId: body.shareId,
        transactionDate: body.transactionDate,
        rows: body.rows.map((row) => ({
          amount: row.amount,
          paymentMode: row.paymentMode,
          referenceNumber: row.referenceNumber ?? null,
          notes: row.notes ?? null,
        })),
        idempotencyKey: body.idempotencyKey,
      },
      session.userId,
      { investmentTransactions: investmentTransactionPort },
    );
    return NextResponse.json(
      { transactions: result.transactions },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (
      error instanceof InvalidTransactionAmountError ||
      error instanceof InvalidTransactionDateError ||
      error instanceof InvalidPaymentModeError ||
      error instanceof MissingIdempotencyKeyError ||
      error instanceof EmptyTransactionBatchError
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
      // `packages/db`'s `matchesInvestmentBatchRequest`/`IdempotencyKeyConflictError`
      // doc comments) -- never silently return the mismatched rows.
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

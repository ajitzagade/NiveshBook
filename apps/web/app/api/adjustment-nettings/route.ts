import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  toMoney,
  InvalidMoneyError,
  AdjustmentNettingIdempotencyKeyConflictError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createInvestmentAdjustmentPort,
  createWithdrawalAdjustmentPort,
  createAdjustmentNettingPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import {
  ADJUSTMENTS_NOT_FOUND_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  PROJECT_NOT_FOUND_MESSAGE,
  isValidAdjustmentNettingBody,
} from "./shared";

/**
 * Story 5.3 (FR33/FR34, Epic 5, AD-4): records an Owner/Admin's explicit
 * netting decision between one person's Investment Adjustment (at a specific
 * funding requirement) and their Withdrawal Adjustment (at this Project) --
 * a pure audit record. `investment_adjustments`/`withdrawal_adjustments`
 * themselves are NEVER read-to-compute-or-offset each other here, and never
 * written to by this route (AD-4's literal "never a side effect of either
 * cycle's calculation") -- this route only confirms both referenced rows
 * already exist, then hands off to `AdjustmentNettingPort.recordNetting`,
 * which writes to `adjustment_nettings` alone.
 *
 * Ordering: session (401) -> `authorizeScope("adjustment_nettings:create")`
 * (403, before any DB read -- AD-1, Owner/Admin-only, no self-access) ->
 * request body parsed/shape-checked (400 `invalid_request`) -> `amount`
 * validated via `toMoney` (400 `validation_error`) -> Project existence
 * (404 `not_found`) -> the referenced `investment_adjustments` row
 * (matching `partyType`/`shareId`/`investmentRequirementId` at this
 * Project) AND the referenced `withdrawal_adjustments` row (matching
 * `partyType`/`shareId` at this Project) both re-resolved fresh, never
 * client-trusted alone (404 `not_found` otherwise, mirrors every other
 * create route's existence-check convention, e.g.
 * `available-balance/spend/route.ts`'s destination-requirement/share
 * re-resolution) -> `AdjustmentNettingPort.recordNetting()`.
 */
export async function POST(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "adjustment_nettings:create", { users: userPort });

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

  if (!isValidAdjustmentNettingBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  let amount: ReturnType<typeof toMoney>;
  try {
    amount = toMoney(body.amount);
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }

  const projectPort = createProjectPort();
  const project = await projectPort.findProjectById(body.projectId);
  if (!project) {
    return NextResponse.json({ code: "not_found", message: PROJECT_NOT_FOUND_MESSAGE }, { status: 404 });
  }

  const investmentAdjustmentPort = createInvestmentAdjustmentPort();
  const withdrawalAdjustmentPort = createWithdrawalAdjustmentPort();
  const [investmentAdjustments, withdrawalAdjustments] = await Promise.all([
    investmentAdjustmentPort.listByProjectId(body.projectId),
    withdrawalAdjustmentPort.listByProjectId(body.projectId),
  ]);

  const investmentAdjustment = investmentAdjustments.find(
    (row) =>
      row.partyType === body.partyType &&
      row.shareId === body.shareId &&
      row.requirementId === body.investmentRequirementId,
  );
  if (!investmentAdjustment) {
    return NextResponse.json(
      { code: "not_found", message: ADJUSTMENTS_NOT_FOUND_MESSAGE },
      { status: 404 },
    );
  }

  const withdrawalAdjustment = withdrawalAdjustments.find(
    (row) => row.partyType === body.partyType && row.shareId === body.shareId,
  );
  if (!withdrawalAdjustment) {
    return NextResponse.json(
      { code: "not_found", message: ADJUSTMENTS_NOT_FOUND_MESSAGE },
      { status: 404 },
    );
  }

  const adjustmentNettingPort = createAdjustmentNettingPort();
  try {
    const result = await adjustmentNettingPort.recordNetting(
      {
        projectId: body.projectId,
        partyType: body.partyType,
        shareId: body.shareId,
        investmentRequirementId: body.investmentRequirementId,
        amount,
        notes: body.notes && body.notes.trim().length > 0 ? body.notes.trim() : null,
      },
      body.idempotencyKey,
      session.userId,
    );
    return NextResponse.json({ netting: result.netting }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof AdjustmentNettingIdempotencyKeyConflictError) {
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}

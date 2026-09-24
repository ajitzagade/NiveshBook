import { NextResponse, type NextRequest } from "next/server";
import type { SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeCanTake,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares (already reduced to the
 * latest version per `subPartnerId` by `listCurrentSubPartnerSharesForProject`)
 * by their parent `partnerId` -- the shape `computeCanTake` expects. Pure
 * grouping only, mirrors `should-pay/route.ts`'s identical local helper
 * (duplicated per-route in this codebase, not shared, per the existing
 * `investment-requirements`/`adjustments`/`transactions`/`my-investment-status`
 * route precedent).
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
 * Computes Can Take for every current Partner/Sub-partner against one
 * Project's live available-to-withdraw amount (Story 4.1, FR21) -- a pure,
 * live calculation on every read, never persisted/snapshotted (this story's
 * Boundaries). Gated by `authorizeScope()` for `"can_take:view"`
 * (Owner/Admin-only, this story's Decisions), checked immediately after the
 * session check and before any DB read -- mirrors `should-pay/route.ts`'s
 * identical ordering.
 *
 * Existence is checked next: the Project `id` (404 if missing/malformed),
 * before ever fetching Partner/Sub-partner Shares or the available-to-
 * withdraw amount.
 *
 * "The Project's available-to-withdraw amount" (this story's Decisions) is
 * resolved via `InvestmentTransactionPort.sumActiveAmountByProjectId` -- the
 * sum of every non-cancelled `investment_transactions.amount` row for the
 * Project, across all its funding requirements, computed live. Nothing is
 * subtracted for withdrawals yet (no `withdrawal_transactions`/
 * `available_balances` ledger exists until Stories 4.2/4.9) -- a later story
 * extends only this resolution step, never `computeCanTake`'s pure signature.
 *
 * `computeCanTake`'s two precondition errors (Partner Shares not totaling
 * 100%, or a Partner's Sub-partner Shares over-allocated) are caught here and
 * mapped to 409, using the exact same `code`/JSON shape as Should Pay's
 * identical precedent (`shares_not_fully_allocated` /
 * `sub_partner_shares_over_allocated`) even though the underlying TS error
 * classes are `can-take.ts`'s own local copies, not `should-pay.ts`'s
 * (this story's Decisions -- Open/Closed, Story 3.2 is already `done`).
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
  const { allowed } = await authorizeScope(session.userId, "can_take:view", { users: userPort });

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

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const [partnerShares, subPartnerShares, availableToWithdraw] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
    investmentTransactionPort.sumActiveAmountByProjectId(projectId),
  ]);

  try {
    const partners = computeCanTake(availableToWithdraw, partnerShares, groupByPartnerId(subPartnerShares));

    return NextResponse.json({ availableToWithdraw, partners });
  } catch (error) {
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
    throw error;
  }
}

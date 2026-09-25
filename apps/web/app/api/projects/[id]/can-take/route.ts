import { NextResponse, type NextRequest } from "next/server";
import type { Money, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeCanTake,
  compareMoney,
  subtractMoney,
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
  createWithdrawalTransactionPort,
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
 * Project, across all its funding requirements, computed live.
 *
 * Story 4.9 (FR29, the Can Take fix this spec's Intent names): now
 * additionally subtracts `WithdrawalTransactionPort.sumActiveAmountByProjectId`
 * -- every withdrawal already recorded against this Project -- via
 * `subtractMoney` (AD-2), so `availableToWithdraw` correctly shrinks after a
 * withdrawal instead of staying pinned to the raw invested total forever.
 * Only this resolution step changes; `computeCanTake`'s own pure signature
 * is untouched, exactly as this story's Boundaries require.
 *
 * Review finding: `totalActiveWithdrawn` can exceed `totalActiveInvested`
 * once Story 3.8's investment cancel/reverse path removes a previously-
 * active investment from the numerator while a withdrawal already taken
 * against it stays recorded (no withdrawal-cancel path exists yet, per this
 * story's own Implementation Notes) -- e.g. invest ₹10,00,000, withdraw
 * ₹8,00,000, then cancel ₹5,00,000 of the original investment: active-
 * invested drops to ₹5,00,000 while active-withdrawn stays ₹8,00,000. A
 * raw `subtractMoney` would throw `NegativeMoneyResultError` uncaught here.
 * Domain-wise that's not an error state -- it just means nothing further is
 * available to withdraw -- so `compareMoney` (AD-2) decides the direction
 * first, and the negative case resolves to `"0"` (Money) instead of ever
 * letting the subtraction itself throw.
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
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const [partnerShares, subPartnerShares, totalActiveInvested, totalActiveWithdrawn] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
    investmentTransactionPort.sumActiveAmountByProjectId(projectId),
    withdrawalTransactionPort.sumActiveAmountByProjectId(projectId),
  ]);
  const availableToWithdraw =
    compareMoney(totalActiveInvested, totalActiveWithdrawn) >= 0
      ? subtractMoney(totalActiveInvested, totalActiveWithdrawn)
      : ("0" as Money);

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

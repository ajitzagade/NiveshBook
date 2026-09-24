import { NextResponse, type NextRequest } from "next/server";
import type { Money, SubPartnerShare, WithdrawalTransaction } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeWithdrawalAdjustment,
  withdrawalShareKey,
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
  createWithdrawalAdjustmentPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `computeCanTake` (via `computeWithdrawalAdjustment`)
 * expects. Mirrors `can-take/route.ts`'s/`adjustments/route.ts`'s local
 * helper of the same name -- kept local to each route rather than shared,
 * matching that established precedent.
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
 * Groups every withdrawal transaction recorded against the whole Project
 * (fetched exactly once, via `listByProjectId`) by `(partyType, shareId)` --
 * the shape `computeWithdrawalAdjustment` expects, via `withdrawalShareKey`.
 * Never re-fetched per share (this story's Boundaries). Mirrors
 * `investment-requirements/[requirementId]/adjustments/route.ts`'s
 * `groupTransactionsByShareKey`, but Project-scoped (no `requirementId`
 * narrowing) -- "Taken" sums every withdrawal to date, not one funding
 * round's worth (this story's Decisions).
 */
function groupTransactionsByShareKey(
  transactions: readonly WithdrawalTransaction[],
): Record<string, Money[]> {
  const byShareKey: Record<string, Money[]> = {};
  for (const transaction of transactions) {
    const key = withdrawalShareKey(transaction.partyType, transaction.shareId);
    const bucket = byShareKey[key];
    if (bucket) {
      bucket.push(transaction.amount);
    } else {
      byShareKey[key] = [transaction.amount];
    }
  }
  return byShareKey;
}

/**
 * Computes the Withdrawal Adjustment (Can Take - Taken, Story 4.3) for every
 * current Partner/Sub-partner against one Project's live Can Take (Story
 * 4.1) and all-time Taken, and **upserts** each into the single-row-per-share
 * ledger -- "viewing" this endpoint is also what keeps the ledger current
 * (this story's Decisions). Gated by `authorizeScope()` for
 * `"withdrawal_adjustments:view"` (Owner/Admin-only), checked immediately
 * after the session check and before any DB read -- mirrors
 * `investment-requirements/[requirementId]/adjustments/route.ts`'s ordering
 * exactly.
 *
 * Existence is checked next: the Project `id` (404 if missing/malformed),
 * before ever fetching Partner/Sub-partner Shares or any transactions.
 *
 * Unlike Investment Adjustment, there is no funding-requirement to resolve
 * -- Can Take is Project-scoped (Story 4.1). "The Project's
 * available-to-withdraw amount" is resolved the identical way `can-take/route.ts`
 * does (`InvestmentTransactionPort.sumActiveAmountByProjectId`). Every
 * withdrawal transaction ever recorded against the Project is fetched
 * exactly once (via `WithdrawalTransactionPort.listByProjectId` -- no
 * `status` column exists yet per Story 4.2's Decisions, so nothing to
 * filter), then grouped by `(partyType, shareId)` (`groupTransactionsByShareKey`)
 * before `computeWithdrawalAdjustment` is called -- never a per-share
 * re-fetch.
 *
 * `computeCanTake`'s two precondition errors (reused inside
 * `computeWithdrawalAdjustment`) are caught here and mapped to 409 -- the
 * only non-2xx outcome once authorization/existence checks pass, per this
 * story's I/O matrix.
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
  const { allowed } = await authorizeScope(session.userId, "withdrawal_adjustments:view", {
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

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const [partnerShares, subPartnerShares, availableToWithdraw, withdrawalTransactions] =
    await Promise.all([
      listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
      listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
      investmentTransactionPort.sumActiveAmountByProjectId(projectId),
      withdrawalTransactionPort.listByProjectId(projectId),
    ]);

  const withdrawalAdjustmentPort = createWithdrawalAdjustmentPort();
  try {
    const partners = await computeWithdrawalAdjustment(
      projectId,
      availableToWithdraw,
      partnerShares,
      groupByPartnerId(subPartnerShares),
      groupTransactionsByShareKey(withdrawalTransactions),
      { withdrawalAdjustments: withdrawalAdjustmentPort },
    );
    return NextResponse.json({ partners });
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

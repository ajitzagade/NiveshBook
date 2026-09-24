import { NextResponse, type NextRequest } from "next/server";
import type { InvestmentTransaction, Money, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  listInvestmentTransactions,
  computeInvestmentAdjustment,
  filterActiveTransactions,
  shareKey,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentRequirementPort,
  createInvestmentTransactionPort,
  createInvestmentAdjustmentPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import { isValidRequirementId, requirementNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string; requirementId: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `computeShouldPay` (via `computeInvestmentAdjustment`)
 * expects. Mirrors `should-pay/route.ts`'s/`transactions/route.ts`'s local
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
 * Groups one funding requirement's transactions (fetched exactly once, via
 * `listInvestmentTransactions`) by `(partyType, shareId)` -- the shape
 * `computeInvestmentAdjustment` expects, via `shareKey`. Never re-fetched
 * per share (this story's Boundaries).
 */
function groupTransactionsByShareKey(
  transactions: readonly InvestmentTransaction[],
): Record<string, Money[]> {
  const byShareKey: Record<string, Money[]> = {};
  for (const transaction of transactions) {
    const key = shareKey(transaction.partyType, transaction.shareId);
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
 * Computes the Investment Adjustment (Should Pay - Actual Paid, Story 3.4)
 * for every current Partner/Sub-partner against one funding requirement, and
 * **upserts** each into the single-row-per-share ledger -- "viewing" this
 * endpoint is also what keeps the ledger current (this story's Decisions).
 * Gated by `authorizeScope()` for `"investment_adjustments:view"`
 * (Owner/Admin-only), checked immediately after the session check and
 * before any DB read -- mirrors `should-pay/route.ts`'s ordering exactly.
 *
 * Existence is checked next, in the same order as `should-pay/route.ts`:
 * the Project `id` (404 if missing/malformed), then the `requirementId`
 * (404 if missing/malformed, OR if it belongs to a *different* Project) --
 * both before ever fetching Partner/Sub-partner Shares, this requirement's
 * own transactions, or calculating anything.
 *
 * This requirement's transactions are fetched exactly once (via
 * `listInvestmentTransactions`), then grouped by `(partyType, shareId)`
 * (`groupTransactionsByShareKey`) before `computeInvestmentAdjustment` is
 * called -- never a per-share re-fetch.
 *
 * `computeShouldPay`'s two precondition errors (reused inside
 * `computeInvestmentAdjustment`) are caught here and mapped to 409 -- the
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
  const { allowed } = await authorizeScope(session.userId, "investment_adjustments:view", {
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

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const [partnerShares, subPartnerShares, transactions] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
    listInvestmentTransactions(requirementId, { investmentTransactions: investmentTransactionPort }),
  ]);

  const investmentAdjustmentPort = createInvestmentAdjustmentPort();
  try {
    const partners = await computeInvestmentAdjustment(
      requirement,
      partnerShares,
      groupByPartnerId(subPartnerShares),
      // Story 3.8: excludes cancelled transactions (and their reversal
      // rows, also `status: "cancelled"`) BEFORE `computeInvestmentAdjustment`
      // -- itself unmodified -- ever sees them, so a cancelled amount stops
      // counting toward Paid Now the next time this ledger is viewed.
      groupTransactionsByShareKey(filterActiveTransactions(transactions)),
      { investmentAdjustments: investmentAdjustmentPort },
    );
    return NextResponse.json({ partners });
  } catch (error) {
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
    throw error;
  }
}

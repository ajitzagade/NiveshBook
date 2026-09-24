import { NextResponse, type NextRequest } from "next/server";
import type { SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeShouldPay,
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
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import { isValidRequirementId, requirementNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string; requirementId: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares (already reduced to the
 * latest version per `subPartnerId` by `listCurrentSubPartnerSharesForProject`)
 * by their parent `partnerId` -- the shape `computeShouldPay` expects. Pure
 * grouping only, no reduction logic here (that lives in `packages/core`'s
 * `subpartner-share.ts`, per spec-3-2's Code Map).
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
 * Computes Should Pay for every current Partner/Sub-partner against one
 * funding requirement's amount (Story 3.2) -- a pure, live calculation, no
 * write path and nothing persisted (Story 3.3's job). Gated by
 * `authorizeScope()` for `"should_pay:view"` (Owner/Admin-only, this story's
 * Decisions), checked immediately after the session check and before any DB
 * read -- mirrors `investment-requirements/route.ts`'s `GET` ordering.
 *
 * Existence is checked next, in order: the Project `id` (404 if missing/
 * malformed), then the `requirementId` (404 if missing/malformed, OR if it
 * belongs to a *different* Project -- the `requirement.projectId !== projectId`
 * check catches a syntactically valid but cross-project id) -- both before
 * ever fetching Partner/Sub-partner Shares or calculating anything.
 *
 * `computeShouldPay`'s two precondition errors (Partner Shares not totaling
 * 100%, or a Partner's Sub-partner Shares over-allocated) are caught here and
 * mapped to 409 -- the only non-2xx outcome once authorization/existence
 * checks pass, per this story's I/O matrix.
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
  const { allowed } = await authorizeScope(session.userId, "should_pay:view", { users: userPort });

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
  const [partnerShares, subPartnerShares] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
  ]);

  try {
    const partners = computeShouldPay(requirement, partnerShares, groupByPartnerId(subPartnerShares));
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

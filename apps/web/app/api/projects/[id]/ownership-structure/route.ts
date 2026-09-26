import { NextResponse, type NextRequest } from "next/server";
import type { PartnerShare, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorize,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  assembleOwnershipStructure,
  type OwnershipStructureScope,
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

export const INVALID_REQUEST_MESSAGE = "Query string may include at most one of `partnerId` or `subPartnerId`, not both.";
export const SHARE_NOT_FOUND_MESSAGE = "No current Partner or Sub-partner Share matches that id on this Project.";

function shareNotFoundResponse() {
  return NextResponse.json({ code: "not_found", message: SHARE_NOT_FOUND_MESSAGE }, { status: 404 });
}

/**
 * Story 5.10 (Ownership & Money-Flow Structure Diagram): the one endpoint
 * `structure/[projectId]/page.tsx` calls, mirroring `GET /api/reports/[type]`'s
 * established "own guard, own data, no client-side authorize() call" shape --
 * this is where the frozen spec's literal "403" outcomes live and are tested,
 * exactly like every other self-access-capable endpoint in this codebase
 * (`my-withdrawal-status/route.ts`, `investment-transactions/[id]/audit-log/route.ts`).
 * The page itself is a `"use client"` component (Decision #7's client-side
 * view-mode toggle, Decision #6's client-side drill-down) -- per this
 * codebase's own established precedent (there is no example anywhere of a
 * page component calling `authorize()`/`authorizeScope()` directly; every
 * self-access-capable, interactive screen -- Money History, Reports -- does
 * so via a REST route exactly like this one), the page's "own guard,
 * independent of `(dashboard)/layout.tsx`'s shell" property is satisfied by
 * this route: no real tree data is ever fetched or rendered until THIS
 * route's own `authorize()`/`authorizeScope()` call has passed, regardless of
 * which of the 3 roles the shell already let through. See this story's
 * Implementation Notes for the full rationale/deviation from the Code Map's
 * literal "page.tsx calls authorize()" wording.
 *
 * Query params: neither `partnerId` nor `subPartnerId` -> the full,
 * unscoped Project tree (`"ownership_structure:view_project"`, owner_admin-
 * only, `authorizeScope()`, no resourceRef needed). `partnerId` XOR
 * `subPartnerId` -> that one Partner's or Sub-partner's own scoped slice
 * (`"ownership_structure:view_partner"`, self-access via `authorize()`) --
 * the target share is resolved from this Project's *current* Partner/
 * Sub-partner Shares FIRST (mirrors `my-withdrawal-status/route.ts`'s/
 * `investment-transactions/[id]/audit-log/route.ts`'s identical "read the
 * one row needed to know `resourceRef.ownerId`, then authorize()" shape --
 * an accepted, established exception to "no data read before authorize()"
 * that exists solely to resolve the target's own ownerId, never to serve
 * any other data before the gate). Both params present at once is a 400
 * `invalid_request` -- this endpoint has no notion of a combined scope.
 *
 * Ordering (AD-1): session (401) -> project existence (404) -> query
 * params parsed (400) -> [project scope: `authorizeScope()` (403) -> full
 * data fetch] or [partner/sub_partner scope: minimal current-shares fetch
 * to resolve the target (404 if no match) -> `authorize()` (403) -> the
 * REMAINING data fetch] -> `assembleOwnershipStructure()` -> 200.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json({ code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE }, { status: 401 });
  }

  const { id: projectId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  const project = await projectPort.findProjectById(projectId);
  if (!project) {
    return projectNotFoundResponse();
  }

  const partnerIdParam = request.nextUrl.searchParams.get("partnerId")?.trim() || null;
  const subPartnerIdParam = request.nextUrl.searchParams.get("subPartnerId")?.trim() || null;

  if (partnerIdParam && subPartnerIdParam) {
    return NextResponse.json({ code: "invalid_request", message: INVALID_REQUEST_MESSAGE }, { status: 400 });
  }

  const userPort = createUserPort();
  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();

  let scope: OwnershipStructureScope;
  // Populated only by the partner/sub_partner branches below (which must
  // fetch one of these two lists first, to resolve `resourceRef.ownerId`
  // before calling `authorize()`) -- reused in the final `Promise.all` below
  // instead of fetching the same list a second time.
  let resolvedPartnerShares: PartnerShare[] | null = null;
  let resolvedSubPartnerShares: SubPartnerShare[] | null = null;

  if (!partnerIdParam && !subPartnerIdParam) {
    const { allowed } = await authorizeScope(session.userId, "ownership_structure:view_project", {
      users: userPort,
    });
    if (!allowed) {
      return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
    }
    scope = { type: "project" };
  } else if (partnerIdParam) {
    resolvedPartnerShares = await listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort });
    const target = resolvedPartnerShares.find((share) => share.partnerId === partnerIdParam);
    if (!target) {
      return shareNotFoundResponse();
    }
    const { allowed } = await authorize(
      session.userId,
      "ownership_structure:view_partner",
      { ownerId: target.userId ?? "" },
      { users: userPort },
    );
    if (!allowed) {
      return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
    }
    scope = { type: "partner", partnerId: target.partnerId };
  } else {
    resolvedSubPartnerShares = await listCurrentSubPartnerSharesForProject(projectId, {
      subPartnerShares: subPartnerSharePort,
    });
    const target = resolvedSubPartnerShares.find((share) => share.subPartnerId === subPartnerIdParam);
    if (!target) {
      return shareNotFoundResponse();
    }
    const { allowed } = await authorize(
      session.userId,
      "ownership_structure:view_partner",
      { ownerId: target.userId ?? "" },
      { users: userPort },
    );
    if (!allowed) {
      return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
    }
    scope = { type: "sub_partner", subPartnerId: target.subPartnerId };
  }

  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();

  const [currentPartnerShares, currentSubPartnerShares, allInvestmentTransactions, withdrawalTransactions] =
    await Promise.all([
      resolvedPartnerShares ?? listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
      resolvedSubPartnerShares ??
        listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
      investmentTransactionPort.listAll(),
      withdrawalTransactionPort.listByProjectId(projectId),
    ]);

  const investmentTransactions = allInvestmentTransactions.filter((tx) => tx.projectId === projectId);

  const tree = assembleOwnershipStructure(scope, {
    currentPartnerShares,
    currentSubPartnerShares,
    investmentTransactions,
    withdrawalTransactions,
  });

  return NextResponse.json({ projectId, projectName: project.name, tree });
}

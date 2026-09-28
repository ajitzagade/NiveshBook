import { NextResponse, type NextRequest } from "next/server";
import type { PartnerShare, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorize,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  assembleOwnershipStructure,
  assembleMoneyHistory,
  deriveMoneyFlowEdges,
  moneyHistoryShareKey,
  moneyHistoryPersonNameKey,
  type OwnershipStructureScope,
  type MoneyHistoryScope,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
  createWithdrawalDestinationAllocationPort,
  createMoneyMovementPort,
  createAvailableBalanceSpendPort,
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
 * Query params: neither `partnerId` nor `subPartnerId`, actor is owner_admin
 * -> the full, unscoped Project tree (`"ownership_structure:view_project"`,
 * `authorizeScope()`, no resourceRef needed). Neither param, actor is a
 * Partner/Sub-partner -> auto-resolves THEIR OWN current Partner or
 * Sub-partner Share in this Project as an implicit self-scope (2026-09-28
 * fix -- nothing that links to this page supplies `?partnerId=` for a
 * Partner/Sub-partner viewing their own Project, so without this fallback
 * the page was unreachable for those two roles even for their own data;
 * `authorize()` still runs on the resolved `ownerId`, so this only makes an
 * already-permitted view reachable, it never widens access). `partnerId` XOR
 * `subPartnerId` explicit -> that one Partner's or Sub-partner's own scoped
 * slice (`"ownership_structure:view_partner"`, self-access via `authorize()`
 * -- lets an owner_admin drill into any specific Partner/Sub-partner too) --
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
    if (allowed) {
      scope = { type: "project" };
    } else {
      // Not an owner_admin -- nothing today links a Partner/Sub-partner to
      // this page WITH an explicit `?partnerId=`/`?subPartnerId=` (the
      // sidebar/Home "View Money Flow" links, and the all-Projects diagram's
      // own node-click, all navigate here bare), so falling straight to 403
      // made this page permanently unreachable for those two roles even for
      // their own Project. Auto-resolve the actor's own current Partner or
      // Sub-partner Share in this Project instead, mirroring the identical
      // "resolve the one row needed to know ownerId, then authorize()"
      // shape the explicit-param branches below already use -- `authorize()`
      // trivially passes once `ownerId` is the actor's own userId, so this
      // never widens what a Partner/Sub-partner can see, it only makes their
      // own already-permitted view reachable without the URL knowing their
      // shareId in advance.
      resolvedPartnerShares = await listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort });
      const ownPartnerShare = resolvedPartnerShares.find(
        (share) => share.userId?.toLowerCase() === session.userId.toLowerCase(),
      );
      if (ownPartnerShare) {
        scope = { type: "partner", partnerId: ownPartnerShare.partnerId };
      } else {
        resolvedSubPartnerShares = await listCurrentSubPartnerSharesForProject(projectId, {
          subPartnerShares: subPartnerSharePort,
        });
        const ownSubPartnerShare = resolvedSubPartnerShares.find(
          (share) => share.userId?.toLowerCase() === session.userId.toLowerCase(),
        );
        if (!ownSubPartnerShare) {
          return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
        }
        scope = { type: "sub_partner", subPartnerId: ownSubPartnerShare.subPartnerId };
      }
    }
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
  const withdrawalDestinationAllocationPort = createWithdrawalDestinationAllocationPort();
  const moneyMovementPort = createMoneyMovementPort();
  const availableBalanceSpendPort = createAvailableBalanceSpendPort();

  const [
    currentPartnerShares,
    currentSubPartnerShares,
    allInvestmentTransactions,
    withdrawalTransactions,
    withdrawalDestinationAllocations,
    moneyMovements,
    availableBalanceSpends,
    allProjects,
  ] = await Promise.all([
    resolvedPartnerShares ?? listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    resolvedSubPartnerShares ??
      listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
    investmentTransactionPort.listAll(),
    withdrawalTransactionPort.listByProjectId(projectId),
    withdrawalDestinationAllocationPort.listAll(),
    moneyMovementPort.listByDestinationProjectId(projectId),
    availableBalanceSpendPort.listAll(),
    projectPort.listProjects(),
  ]);

  const investmentTransactions = allInvestmentTransactions.filter((tx) => tx.projectId === projectId);

  const tree = assembleOwnershipStructure(scope, {
    currentPartnerShares,
    currentSubPartnerShares,
    investmentTransactions,
    withdrawalTransactions,
  });

  // Money-flow edges (founder feedback 2026-09-28): built on TOP of
  // `assembleMoneyHistory()`'s already-tested join/scoping rather than a
  // second parallel implementation -- see `deriveMoneyFlowEdges`'s own doc
  // comment. `projectNamesById` is intentionally system-wide (every
  // Project's name, not just ones this actor has a Share in) -- mirrors
  // `GET /api/money-history`'s own identical, already-shipped precedent: a
  // partner/sub_partner may see another Project's NAME as a plain-language
  // label on their own entry, never that Project's own tree/shares/nodes.
  const projectNamesById = Object.fromEntries(allProjects.map((p) => [p.id, p.name]));
  const partnerNamesById = Object.fromEntries(
    currentPartnerShares.map((share) => [moneyHistoryPersonNameKey(share.partnerId, share.projectId), share.name]),
  );
  const subPartnerNamesById = Object.fromEntries(
    currentSubPartnerShares.map((share) => [
      moneyHistoryPersonNameKey(share.subPartnerId, share.projectId),
      share.name,
    ]),
  );

  // Mirrors the tree's own scoping exactly (never new privacy logic): the
  // unscoped Project view sees every party's entries; a Partner's own scoped
  // view includes their own Sub-partners' entries too (matching
  // `assembleOwnershipStructure`'s own `buildPartnerNode` always nesting
  // `subPartners`); a Sub-partner's own scoped view sees only their own
  // single share, no parent Partner data.
  let historyScope: MoneyHistoryScope;
  if (scope.type === "project") {
    historyScope = { unrestricted: true };
  } else if (scope.type === "partner") {
    const ownSubPartnerKeys = currentSubPartnerShares
      .filter((share) => share.partnerId === scope.partnerId)
      .map((share) => moneyHistoryShareKey("sub_partner", share.subPartnerId, projectId));
    historyScope = {
      unrestricted: false,
      shareKeys: new Set([moneyHistoryShareKey("partner", scope.partnerId, projectId), ...ownSubPartnerKeys]),
    };
  } else {
    historyScope = {
      unrestricted: false,
      shareKeys: new Set([moneyHistoryShareKey("sub_partner", scope.subPartnerId, projectId)]),
    };
  }

  const entries = assembleMoneyHistory(
    {
      investmentTransactions,
      withdrawalTransactions,
      withdrawalDestinationAllocations,
      moneyMovements,
      availableBalanceSpends,
      projectNamesById,
      partnerNamesById,
      subPartnerNamesById,
    },
    historyScope,
    { projectId },
  );
  const moneyFlowEdges = deriveMoneyFlowEdges(entries);

  return NextResponse.json({ projectId, projectName: project.name, tree, moneyFlowEdges });
}

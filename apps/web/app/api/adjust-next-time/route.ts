import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  resolveMoneyHistoryScope,
  filterAdjustNextTimeByScope,
  moneyHistoryPersonNameKey,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentAdjustmentPort,
  createWithdrawalAdjustmentPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

const UNKNOWN_PROJECT_NAME = "Unknown Project";
const UNKNOWN_PERSON_NAME = "Unknown";

/**
 * Story 5.3 (FR33/FR34, Epic 5): the Adjust Next Time page's own read --
 * deliberately NOT Project-scoped (mirrors `GET /api/money-history`'s
 * identical Story 5.1 precedent, this story's Code Map) since a Partner/
 * Sub-partner's own carried-forward adjustments span every Project they're
 * linked to, not just one.
 *
 * `authorizeScope("adjust_next_time:view", ...)` runs before any data fetch
 * (AD-1) -- all three roles are granted at the permission-table level
 * (`authorize.ts`'s Decisions), with the actual per-row scoping computed
 * separately by `resolveMoneyHistoryScope()`/`filterAdjustNextTimeByScope()`
 * below (both reused UNCHANGED from Story 5.1, per spec-5-3's Code Map: "no
 * new scope-resolution logic").
 *
 * `investmentAdjustments`/`withdrawalAdjustments` come back as plain
 * `listAll()` rows -- `personName`/`projectName` are resolved and attached
 * here at the route layer (mirrors `GET /api/money-history`'s own
 * `partnerNamesById`/`subPartnerNamesById` map-building convention exactly,
 * reusing the identical `moneyHistoryPersonNameKey` key-builder) rather than
 * in `packages/core`'s `adjust-next-time.ts`, which stays a pure scope
 * filter only (this story's Code Map).
 *
 * `canNet` is computed here from the actor's own live role -- `true` only
 * for `owner_admin` -- so the page can hide the "Net Adjustment" action for
 * a Partner/Sub-partner without inventing a new client-side session-role
 * primitive; `POST /api/adjustment-nettings`'s own `authorizeScope()` is the
 * real, authoritative gate either way (this flag is a UX convenience, never
 * itself a security boundary).
 */
export async function GET(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "adjust_next_time:view", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  // `authorizeScope` already confirmed this user exists in a granted role
  // above -- re-fetched here purely to learn WHICH role, mirroring
  // `GET /api/money-history`'s identical two-step
  // authorize-then-read-more pattern.
  const actor = await userPort.findUserById(session.userId);
  if (!actor) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const projectPort = createProjectPort();
  const investmentAdjustmentPort = createInvestmentAdjustmentPort();
  const withdrawalAdjustmentPort = createWithdrawalAdjustmentPort();

  const [allPartnerShares, allSubPartnerShares, projects, investmentAdjustments, withdrawalAdjustments] =
    await Promise.all([
      listAllCurrentPartnerShares({ partnerShares: partnerSharePort }),
      listAllCurrentSubPartnerShares({ subPartnerShares: subPartnerSharePort }),
      projectPort.listProjects(),
      investmentAdjustmentPort.listAll(),
      withdrawalAdjustmentPort.listAll(),
    ]);

  const scope = resolveMoneyHistoryScope(actor.role, actor.id, allPartnerShares, allSubPartnerShares);
  const scoped = filterAdjustNextTimeByScope({ investmentAdjustments, withdrawalAdjustments }, scope);

  const projectNamesById = Object.fromEntries(projects.map((project) => [project.id, project.name]));
  const partnerNamesById = Object.fromEntries(
    allPartnerShares.map((share) => [moneyHistoryPersonNameKey(share.partnerId, share.projectId), share.name]),
  );
  const subPartnerNamesById = Object.fromEntries(
    allSubPartnerShares.map((share) => [
      moneyHistoryPersonNameKey(share.subPartnerId, share.projectId),
      share.name,
    ]),
  );

  function resolvePersonName(partyType: "partner" | "sub_partner", shareId: string, projectId: string): string {
    const table = partyType === "partner" ? partnerNamesById : subPartnerNamesById;
    return table[moneyHistoryPersonNameKey(shareId, projectId)] ?? UNKNOWN_PERSON_NAME;
  }

  function resolveProjectName(projectId: string): string {
    return projectNamesById[projectId] ?? UNKNOWN_PROJECT_NAME;
  }

  return NextResponse.json({
    investmentAdjustments: scoped.investmentAdjustments.map((row) => ({
      ...row,
      personName: resolvePersonName(row.partyType, row.shareId, row.projectId),
      projectName: resolveProjectName(row.projectId),
    })),
    withdrawalAdjustments: scoped.withdrawalAdjustments.map((row) => ({
      ...row,
      personName: resolvePersonName(row.partyType, row.shareId, row.projectId),
      projectName: resolveProjectName(row.projectId),
    })),
    canNet: actor.role === "owner_admin",
  });
}

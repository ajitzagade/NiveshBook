import { NextResponse, type NextRequest } from "next/server";
import type { AvailableBalance, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createAvailableBalancePort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- mirrors `can-take/route.ts`'s identical local helper
 * (duplicated per-route in this codebase, not shared, per the existing
 * `investment-requirements`/`adjustments`/`transactions`/`can-take` route
 * precedent).
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

/** `"0"` for a share with no `available_balances` row yet -- this story's Code Map. */
function balanceFor(
  balances: readonly AvailableBalance[],
  partyType: "partner" | "sub_partner",
  shareId: string,
): string {
  return balances.find((b) => b.partyType === partyType && b.shareId === shareId)?.balance ?? "0";
}

/**
 * Lists every current Partner/Sub-partner's Available Balance for one
 * Project (Story 4.9, FR29) -- the *source* Project a withdrawal's
 * `"available_balance"` destination-allocation leg was credited against
 * (this story's Decisions #1). Gated by `authorizeScope()` for
 * `"available_balances:view"` (Owner/Admin-only), mirroring
 * `can-take/route.ts`'s identical ordering: authorization checked
 * immediately after the session check, before any DB read; Project
 * existence checked next.
 *
 * Joins the Project's *current* Partner/Sub-partner Shares
 * (`listCurrentPartnerShares`/`listCurrentSubPartnerSharesForProject`,
 * mirroring Can Take's exact resolution) against
 * `AvailableBalancePort.listBalancesByProjectId` -- a share with no
 * `available_balances` row yet (never credited) defaults to `"0"`
 * (`balanceFor`), never omitted from the response.
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
  const { allowed } = await authorizeScope(session.userId, "available_balances:view", { users: userPort });

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
  const availableBalancePort = createAvailableBalancePort();
  const [partnerShares, subPartnerShares, balances] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
    availableBalancePort.listBalancesByProjectId(projectId),
  ]);
  const subPartnerSharesByPartnerId = groupByPartnerId(subPartnerShares);

  const partners = partnerShares.map((partner) => ({
    partnerId: partner.partnerId,
    name: partner.name,
    sharePercent: partner.sharePercent,
    balance: balanceFor(balances, "partner", partner.partnerId),
    subPartners: (subPartnerSharesByPartnerId[partner.partnerId] ?? []).map((sub) => ({
      subPartnerId: sub.subPartnerId,
      name: sub.name,
      sharePercent: sub.sharePercent,
      balance: balanceFor(balances, "sub_partner", sub.subPartnerId),
    })),
  }));

  return NextResponse.json({ partners });
}

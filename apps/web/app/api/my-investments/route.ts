import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  assembleMyInvestments,
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
  createRecommendedAmountPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

/**
 * Founder feedback 2026-09-26: the All Investments view's own cross-project
 * list -- deliberately NOT Project-scoped (mirrors `GET /api/money-history`'s
 * identical Story 5.1 shape), since the actor's investments span every
 * Project they're linked to.
 *
 * `authorizeScope("my_investments:list", ...)` runs before any data fetch
 * (AD-1) -- all three roles are granted at the permission-table level
 * (`authorize.ts`), with the actual per-entry scoping (owner_admin: all
 * projects/parties; partner/sub-partner: own current Shares only, own
 * numbers only -- FR10) computed by `assembleMyInvestments()`
 * (`packages/core/src/my-investments.ts`), never inferred from
 * client-supplied data. No query params: the actor's own identity/role is
 * the only input.
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
  const { allowed } = await authorizeScope(session.userId, "my_investments:list", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  // Re-fetched purely to learn WHICH role drives the assembler's scoping --
  // mirrors `money-history/route.ts`'s identical two-step
  // authorize-then-read-more pattern.
  const actor = await userPort.findUserById(session.userId);
  if (!actor) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const [allCurrentPartnerShares, allCurrentSubPartnerShares, projects] = await Promise.all([
    listAllCurrentPartnerShares({ partnerShares: createPartnerSharePort() }),
    listAllCurrentSubPartnerShares({ subPartnerShares: createSubPartnerSharePort() }),
    createProjectPort().listProjects(),
  ]);

  const projectNamesById = Object.fromEntries(projects.map((project) => [project.id, project.name]));

  const entries = await assembleMyInvestments(
    actor.role,
    actor.id,
    { allCurrentPartnerShares, allCurrentSubPartnerShares, projectNamesById },
    {
      investmentRequirements: createInvestmentRequirementPort(),
      investmentTransactions: createInvestmentTransactionPort(),
      recommendedAmounts: createRecommendedAmountPort(),
      investmentAdjustments: createInvestmentAdjustmentPort(),
    },
  );

  return NextResponse.json({ entries });
}

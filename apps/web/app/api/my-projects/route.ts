import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  assembleMyProjects,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

/**
 * spec-partner-project-list-self-access: the self-scoped Project list behind
 * the sidebar switcher and Money History's Project filter -- mirrors
 * `GET /api/my-investments`'s exact shape (this spec's Approach): one
 * permission, all 3 roles, scoping computed inside `packages/core` from the
 * actor's role, never inferred from client-supplied data.
 *
 * `authorizeScope("my_projects:list", ...)` runs before any data fetch
 * (AD-1) -- all three roles are granted at the permission-table level
 * (`authorize.ts`), with the actual per-Project scoping (owner_admin: every
 * Project; partner/sub-partner: only Projects where they hold a current
 * Partner or Sub-partner Share) computed by `assembleMyProjects()`
 * (`packages/core/src/my-projects.ts`). No query params: the actor's own
 * identity/role is the only input.
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
  const { allowed } = await authorizeScope(session.userId, "my_projects:list", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  // Re-fetched purely to learn WHICH role drives the assembler's scoping --
  // mirrors `my-investments/route.ts`'s identical two-step
  // authorize-then-read-more pattern.
  const actor = await userPort.findUserById(session.userId);
  if (!actor) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const [allProjects, currentPartnerShares, currentSubPartnerShares] = await Promise.all([
    createProjectPort().listProjects(),
    listAllCurrentPartnerShares({ partnerShares: createPartnerSharePort() }),
    listAllCurrentSubPartnerShares({ subPartnerShares: createSubPartnerSharePort() }),
  ]);

  const projects = assembleMyProjects(actor.role, actor.id, allProjects, currentPartnerShares, currentSubPartnerShares);

  return NextResponse.json({ projects });
}

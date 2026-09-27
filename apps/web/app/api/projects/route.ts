import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  createProject,
  InvalidProjectNameError,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  assembleProjectSummaries,
} from "@niveshbook/core";
import type { ProjectListItem } from "@niveshbook/types";
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
import { INVALID_REQUEST_MESSAGE, isValidProjectBody } from "./shared";

/**
 * Owner/Admin-only Projects list (AD-1) — proves `authorizeScope()` for a
 * second resource beyond the user directory. Returns `ProjectListItem[]`
 * (founder feedback 2026-09-27) — each `Project` plus its
 * `assembleProjectSummaries` row (Partners/Sub-partners/Share%/"N Add Money"
 * counts) for the redesigned Projects card grid. The three summary sources
 * (`listAllCurrentPartnerShares`/`listAllCurrentSubPartnerShares`/
 * `InvestmentRequirementPort.listAll()`) are each a single unfiltered read,
 * grouped in memory by `assembleProjectSummaries` — never a per-project
 * fetch, so this stays O(1) queries regardless of how many Projects exist
 * (NFR10).
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
  const { allowed } = await authorizeScope(session.userId, "projects:list", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const projectPort = createProjectPort();
  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentRequirementPort = createInvestmentRequirementPort();

  const [allProjects, currentPartnerShares, currentSubPartnerShares, investmentRequirements] = await Promise.all([
    projectPort.listProjects(),
    listAllCurrentPartnerShares({ partnerShares: partnerSharePort }),
    listAllCurrentSubPartnerShares({ subPartnerShares: subPartnerSharePort }),
    investmentRequirementPort.listAll(),
  ]);

  const summaries = assembleProjectSummaries(
    allProjects.map((project) => project.id),
    { currentPartnerShares, currentSubPartnerShares, investmentRequirements },
  );

  const projectListItems: ProjectListItem[] = allProjects.map((project) => {
    // project.id comes from the same listProjects() read assembleProjectSummaries was seeded with, so a matching row always exists
    const summary = summaries[project.id];
    return {
      ...project,
      partnersCount: summary.partnersCount,
      subPartnersCount: summary.subPartnersCount,
      totalSharePercent: summary.totalSharePercent,
      isFullyAllocated: summary.isFullyAllocated,
      addMoneyRoundCount: summary.addMoneyRoundCount,
    };
  });

  return NextResponse.json(projectListItems);
}

/**
 * Creates a Project with just a name and description — no partner
 * information is required to save (this story's core rule). Gated by
 * `authorizeScope()` for `"projects:create"` (Owner/Admin-only), checked
 * immediately after the session check and before the body is parsed/
 * validated — so a non-Owner/Admin always gets a uniform 403, never a 400
 * from a malformed body leaking ahead of the authorization check. Empty/
 * whitespace-only names are rejected by `packages/core`'s `createProject`,
 * surfaced here as a 400 `validation_error`.
 */
export async function POST(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "projects:create", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (!isValidProjectBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const projectPort = createProjectPort();
  try {
    const project = await createProject(
      { name: body.name, description: body.description ?? null },
      { projects: projectPort },
    );
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidProjectNameError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}

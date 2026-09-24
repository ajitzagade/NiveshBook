import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  createInvestmentRequirement,
  listInvestmentRequirements,
  InvalidRequirementAmountError,
  InvalidRequirementDateError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort, createProjectPort, createInvestmentRequirementPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, isValidInvestmentRequirementBody } from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Lists every funding requirement for a Project (Story 3.1) --
 * Owner/Admin-only, gated by `authorizeScope()` for
 * `"investment_requirements:list"` with no `scopeOwnerIds` (this story's
 * Decisions: unlike `partner_shares:list`, there is no Partner/Sub-partner
 * scoped access yet). The 403 for a non-Owner/Admin is checked before the
 * Project-existence lookup even runs -- mirrors `partner-shares/route.ts`'s
 * `POST` ordering, simplified here since `GET` needs no pre-fetched data to
 * compute a scope from.
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
  const { allowed } = await authorizeScope(session.userId, "investment_requirements:list", {
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

  const investmentRequirementPort = createInvestmentRequirementPort();
  const requirements = await listInvestmentRequirements(projectId, {
    investmentRequirements: investmentRequirementPort,
  });

  return NextResponse.json({ requirements });
}

/**
 * Creates a new funding requirement for a Project (this story's core flow).
 * Gated by `authorizeScope()` for `"investment_requirements:create"`
 * (Owner/Admin-only), checked immediately after the session check and
 * before the body is parsed/validated -- so a non-Owner/Admin always gets a
 * uniform 403, never a 400 from a malformed body leaking ahead of the
 * authorization check (mirrors `partner-shares/route.ts`'s `POST`). 404s
 * for a nonexistent (or malformed) project `id` before ever calling
 * `createInvestmentRequirement`, rather than letting the insert fail
 * uncaught against the `investment_requirements_project_id_projects_id_fk`
 * foreign key. `amount`/`requirementDate` validation (`toMoney` + `> 0`,
 * and the `YYYY-MM-DD` format check) happens inside `createInvestmentRequirement`
 * itself -- this route only catches the resulting domain errors and maps
 * them to a 400 `validation_error`.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "investment_requirements:create", {
    users: userPort,
  });

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

  if (!isValidInvestmentRequirementBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const { id: projectId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  const investmentRequirementPort = createInvestmentRequirementPort();
  try {
    const requirement = await createInvestmentRequirement(
      projectId,
      { amount: body.amount, requirementDate: body.requirementDate },
      { investmentRequirements: investmentRequirementPort },
    );
    return NextResponse.json(requirement, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidRequirementAmountError || error instanceof InvalidRequirementDateError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}

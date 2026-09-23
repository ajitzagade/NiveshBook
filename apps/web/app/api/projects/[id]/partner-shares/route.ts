import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  addPartnerShare,
  listCurrentPartnerShares,
  computeShareTotal,
  InvalidPartnerNameError,
  InvalidSharePercentError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort, createProjectPort, createPartnerSharePort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, isValidPartnerShareBody } from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Lists the *current* Partner Shares for a Project (one row per Partner --
 * `listCurrentPartnerShares` reduces every version row down to the latest
 * per `partnerId`) plus the live running total (`computeShareTotal`,
 * AD-2's decimal-safe addition). Owner/Admin-only (AD-1), gated by
 * `authorizeScope()` for `"partner_shares:list"` -- mirrors
 * `apps/web/app/api/projects/route.ts`'s GET. 404s for a nonexistent (or
 * malformed) project `id`, matching `apps/web/app/api/projects/[id]/route.ts`'s
 * own existence-check precedent, rather than silently returning an empty list.
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
  const { allowed } = await authorizeScope(session.userId, "partner_shares:list", {
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

  const partnerSharePort = createPartnerSharePort();
  const shares = await listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort });
  const total = computeShareTotal(shares);

  return NextResponse.json({ shares, total });
}

/**
 * Adds a new Partner to a Project with a Share % (this story's core flow).
 * Gated by `authorizeScope()` for `"partner_shares:create"` (Owner/Admin-only),
 * checked immediately after the session check and before the body is
 * parsed/validated -- so a non-Owner/Admin always gets a uniform 403, never
 * a 400 from a malformed body leaking ahead of the authorization check
 * (mirrors `apps/web/app/api/projects/route.ts`'s POST). Never blocks on
 * the running total not reconciling to 100% (spec-2-2's Decisions) --
 * that's informational-only, computed live by `GET` and displayed by the
 * page, not enforced here. 404s for a nonexistent (or malformed) project
 * `id` before ever calling `addPartnerShare`, rather than letting the
 * insert fail uncaught against the `partner_shares_project_id_projects_id_fk`
 * foreign key.
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
  const { allowed } = await authorizeScope(session.userId, "partner_shares:create", {
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

  if (!isValidPartnerShareBody(body)) {
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

  const partnerSharePort = createPartnerSharePort();
  try {
    const share = await addPartnerShare(
      projectId,
      { name: body.name, sharePercent: body.sharePercent },
      { partnerShares: partnerSharePort },
    );
    return NextResponse.json(share, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidPartnerNameError || error instanceof InvalidSharePercentError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}

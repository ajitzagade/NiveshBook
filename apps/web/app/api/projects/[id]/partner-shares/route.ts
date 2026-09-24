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
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE, resolveLinkedUserId } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, isValidPartnerShareBody } from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Lists the *current* Partner Shares for a Project (one row per Partner --
 * `listCurrentPartnerShares` reduces every version row down to the latest
 * per `partnerId`) plus the live running total (`computeShareTotal`,
 * AD-2's decimal-safe addition). Owner/Admin-only, OR any linked Partner
 * whose `userId` matches a `userId` on one of this Project's *current*
 * Partner Shares (Story 2.4's co-partner privacy boundary, FR7) -- gated by
 * `authorizeScope()` for `"partner_shares:list"` with a `scopeOwnerIds`
 * list computed from the Project's current Partner Shares. Top-level Partner
 * Share data (name + Share %) is not part of the privacy boundary (AC4) --
 * a linked co-partner sees the full, unfiltered list once the membership
 * check passes, no per-row redaction.
 *
 * The Project and its current Partner Shares are resolved *before* the
 * authorization check (needed to compute `scopeOwnerIds`) -- but the 403 for
 * "not Owner/Admin and not linked to this Project" is returned uniformly
 * regardless of whether the Project actually exists, so an unrelated Partner
 * can never use this endpoint to confirm/deny a Project id (spec-2-4's
 * Decisions). Only once the caller is authorized does a still-missing (or
 * malformed) Project id fall through to the existing 404, matching
 * `apps/web/app/api/projects/[id]/route.ts`'s own existence-check precedent.
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

  const { id: projectId } = await params;

  const projectPort = createProjectPort();
  const partnerSharePort = createPartnerSharePort();

  const project = isValidProjectId(projectId) ? await projectPort.findProjectById(projectId) : null;
  const currentShares = project
    ? await listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort })
    : [];

  const scopeOwnerIds = currentShares
    .map((share) => share.userId)
    .filter((userId): userId is string => userId !== null);

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(
    session.userId,
    "partner_shares:list",
    { users: userPort },
    scopeOwnerIds,
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  if (!project) {
    return projectNotFoundResponse();
  }

  const total = computeShareTotal(currentShares);

  return NextResponse.json({ shares: currentShares, total });
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
 * foreign key. `linkedUserEmail` (Story 2.4) is resolved to a `userId | null`
 * via `resolveLinkedUserId()` after the project-existence check -- an empty
 * string means no link; a non-empty, unresolvable, or wrong-role (must be
 * `"partner"`) email is a 400 `validation_error`, no row created.
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

  const linked = await resolveLinkedUserId(body.linkedUserEmail, "partner", userPort);
  if (!linked.ok) {
    return NextResponse.json({ code: "validation_error", message: linked.message }, { status: 400 });
  }

  const partnerSharePort = createPartnerSharePort();
  try {
    const share = await addPartnerShare(
      projectId,
      {
        name: body.name,
        sharePercent: body.sharePercent,
        userId: linked.userId,
        subPartnerVisibilityGrant: body.subPartnerVisibilityGrant,
      },
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

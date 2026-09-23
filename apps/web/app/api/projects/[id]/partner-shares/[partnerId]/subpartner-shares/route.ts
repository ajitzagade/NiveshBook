import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  addSubPartnerShare,
  listCurrentSubPartnerShares,
  computeSubAllocationTotal,
  InvalidSubPartnerNameError,
  InvalidSubPartnerSharePercentError,
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
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import { isValidPartnerId, partnerShareNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, isValidSubPartnerShareBody } from "./shared";

interface RouteContext {
  params: Promise<{ id: string; partnerId: string }>;
}

/**
 * Validates every path segment this route receives before touching data:
 * the project `id` must exist, and `partnerId` must belong to that project
 * (`findLatestByPartnerId` + `existing.projectId === id`) -- mirrors
 * `partner-shares/[partnerId]/route.ts`'s own cross-project check, one
 * level up the URL. Returns the found `PartnerShare` on success, or a
 * `NextResponse` to return immediately on any mismatch -- all 404, per
 * spec-2-3's "same class of bug, one level deeper" note.
 */
async function resolveScope(
  projectId: string,
  partnerId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!isValidProjectId(projectId)) {
    return { ok: false, response: projectNotFoundResponse() };
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return { ok: false, response: projectNotFoundResponse() };
  }

  if (!isValidPartnerId(partnerId)) {
    return { ok: false, response: partnerShareNotFoundResponse() };
  }

  const partnerSharePort = createPartnerSharePort();
  const partner = await partnerSharePort.findLatestByPartnerId(partnerId);
  if (!partner || partner.projectId !== projectId) {
    return { ok: false, response: partnerShareNotFoundResponse() };
  }

  return { ok: true };
}

/**
 * Lists the *current* Sub-partner Shares for a Partner (one row per
 * Sub-partner -- `listCurrentSubPartnerShares` reduces every version row
 * down to the latest per `subPartnerId`) plus the live running total
 * (`computeSubAllocationTotal`, AD-2's decimal-safe addition, scoped to
 * this Partner's own slice -- never the Project's 100% total). Owner/Admin-
 * only (AD-1), gated by `authorizeScope()` for `"subpartner_shares:list"` --
 * mirrors `partner-shares/route.ts`'s GET one level down. 404s for a
 * nonexistent project `id` or a `partnerId` that doesn't belong to it,
 * rather than silently returning an empty list.
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
  const { allowed } = await authorizeScope(session.userId, "subpartner_shares:list", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const { id: projectId, partnerId } = await params;

  const scope = await resolveScope(projectId, partnerId);
  if (!scope.ok) {
    return scope.response;
  }

  const subPartnerSharePort = createSubPartnerSharePort();
  const shares = await listCurrentSubPartnerShares(partnerId, {
    subPartnerShares: subPartnerSharePort,
  });
  const total = computeSubAllocationTotal(shares);

  return NextResponse.json({ shares, total });
}

/**
 * Adds a new Sub-partner under a Partner with a Share % of the full
 * Project (this story's core flow). Gated by `authorizeScope()` for
 * `"subpartner_shares:create"` (Owner/Admin-only), checked immediately
 * after the session check and before the body is parsed/validated -- so a
 * non-Owner/Admin always gets a uniform 403, never a 400 from a malformed
 * body leaking ahead of the authorization check (mirrors
 * `partner-shares/route.ts`'s POST). Never blocks on the Sub-partner
 * allocation total not reconciling to the parent Partner's own Share %
 * (spec-2-3's Decisions) -- that's informational-only, computed live by
 * `GET` and displayed by the page, not enforced here. 404s for a
 * nonexistent project `id` or a `partnerId` that doesn't belong to it
 * before ever calling `addSubPartnerShare`.
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
  const { allowed } = await authorizeScope(session.userId, "subpartner_shares:create", {
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

  if (!isValidSubPartnerShareBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const { id: projectId, partnerId } = await params;

  const scope = await resolveScope(projectId, partnerId);
  if (!scope.ok) {
    return scope.response;
  }

  const subPartnerSharePort = createSubPartnerSharePort();
  try {
    const share = await addSubPartnerShare(
      partnerId,
      projectId,
      { name: body.name, sharePercent: body.sharePercent },
      { subPartnerShares: subPartnerSharePort },
    );
    return NextResponse.json(share, { status: 201 });
  } catch (error) {
    if (
      error instanceof InvalidSubPartnerNameError ||
      error instanceof InvalidSubPartnerSharePercentError
    ) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}

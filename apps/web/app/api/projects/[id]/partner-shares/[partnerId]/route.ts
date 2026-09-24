import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  updatePartnerShare,
  listCurrentSubPartnerShares,
  InvalidPartnerNameError,
  InvalidSharePercentError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE, resolveLinkedUserId } from "@/lib/users";
import { isValidProjectId } from "../../../shared";
import {
  INVALID_REQUEST_MESSAGE,
  isValidPartnerShareBody,
  isValidPartnerId,
  partnerShareNotFoundResponse,
} from "../shared";

interface RouteContext {
  params: Promise<{ id: string; partnerId: string }>;
}

/**
 * Returns a single Partner's detail (Story 2.6). Owner/Admin always gets the
 * *full* `PartnerShare` row, unconditionally. A Sub-partner gets a minimal
 * `{ sharePercent }` projection -- never `name`/`userId`/`id`/`effectiveFrom`/
 * `createdAt` -- if and only if both (a) they're linked to one of this
 * specific Partner's *current* Sub-partner Shares, checked via
 * `authorizeScope()`'s `"partner_shares:view_grant"` action (reusing Story
 * 2.4's `SCOPE_SELF_ACCESS_ACTIONS` mechanism one level down, scoped by
 * `listCurrentSubPartnerShares(partnerId, ...)`'s current rows' `userId`s),
 * and (b) `partner.subPartnerVisibilityGrant === true` -- a separate,
 * additional business-rule condition checked here, not inside `authorize.ts`.
 * Every other caller -- a Partner role, a different Partner's Sub-partner,
 * grant off -- gets the identical uniform `403 {code: "forbidden"}`, so
 * nothing distinguishes "wrong Partner" from "right Partner, grant off" from
 * the response.
 *
 * Path-segment resolution (project `id` exists, `partnerId` belongs to it)
 * runs identically for every caller -- mirrors Story 2.5's
 * `resolutionFailed()` pattern exactly: only Owner/Admin can turn a
 * resolution failure into the existing granular 404; everyone else gets the
 * same uniform 403 for every failure mode (malformed id, nonexistent
 * Partner, wrong Sub-partner, or grant disabled) -- no existence oracle.
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
  const { id: projectId, partnerId } = await params;

  const forbidden = () =>
    NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });

  const resolutionFailed = async (): Promise<NextResponse> => {
    const actor = await userPort.findUserById(session.userId);
    if (actor?.role === "owner_admin") {
      return partnerShareNotFoundResponse();
    }
    return forbidden();
  };

  if (!isValidProjectId(projectId) || !isValidPartnerId(partnerId)) {
    return await resolutionFailed();
  }

  const partnerSharePort = createPartnerSharePort();
  const partner = await partnerSharePort.findLatestByPartnerId(partnerId);
  if (!partner || partner.projectId !== projectId) {
    return await resolutionFailed();
  }

  const actor = await userPort.findUserById(session.userId);
  if (actor?.role === "owner_admin") {
    return NextResponse.json(partner);
  }

  const subPartnerSharePort = createSubPartnerSharePort();
  const currentSubShares = await listCurrentSubPartnerShares(partnerId, {
    subPartnerShares: subPartnerSharePort,
  });
  const scopeOwnerIds = currentSubShares
    .map((share) => share.userId)
    .filter((userId): userId is string => userId !== null);

  const { allowed } = await authorizeScope(
    session.userId,
    "partner_shares:view_grant",
    { users: userPort },
    scopeOwnerIds,
  );

  if (!allowed || !partner.subPartnerVisibilityGrant) {
    return forbidden();
  }

  return NextResponse.json({ sharePercent: partner.sharePercent });
}

/**
 * Edits an existing Partner's name/Share %. Gated by `authorizeScope()` for
 * `"partner_shares:update"` (Owner/Admin-only), checked immediately after
 * the session check and before the body is parsed/validated -- mirrors
 * `apps/web/app/api/projects/[id]/route.ts`'s PATCH. Per AD-3 (and
 * spec-2-2's Decisions), this **always** creates a new versioned row --
 * `packages/core`'s `updatePartnerShare` never overwrites the existing one
 * in place, regardless of whether transactions exist against it.
 * A nonexistent or malformed `partnerId` -- or a malformed project `id`, or
 * a `partnerId` that belongs to a *different* project than the URL's `id`
 * segment -- all get the same 404 (`apps/web/lib/ids.ts`'s
 * malformed-id-looks-like-404 convention), so none of those cases leak
 * which one applies, and a Partner Share can never be edited through
 * another project's URL. `linkedUserEmail` (Story 2.4) is resolved to a
 * `userId | null` via `resolveLinkedUserId()`, full-overwrite every time
 * (empty string unlinks) -- unresolvable or wrong-role (`"partner"`) is a
 * 400 `validation_error`, no new version created.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "partner_shares:update", {
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

  const { id: projectId, partnerId } = await params;

  if (!isValidProjectId(projectId) || !isValidPartnerId(partnerId)) {
    return partnerShareNotFoundResponse();
  }

  const partnerSharePort = createPartnerSharePort();
  try {
    const existing = await partnerSharePort.findLatestByPartnerId(partnerId);

    if (!existing || existing.projectId !== projectId) {
      return partnerShareNotFoundResponse();
    }

    const linked = await resolveLinkedUserId(body.linkedUserEmail, "partner", userPort);
    if (!linked.ok) {
      return NextResponse.json(
        { code: "validation_error", message: linked.message },
        { status: 400 },
      );
    }

    const updated = await updatePartnerShare(
      partnerId,
      {
        name: body.name,
        sharePercent: body.sharePercent,
        userId: linked.userId,
        subPartnerVisibilityGrant: body.subPartnerVisibilityGrant,
      },
      { partnerShares: partnerSharePort },
    );

    if (!updated) {
      return partnerShareNotFoundResponse();
    }

    return NextResponse.json(updated);
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

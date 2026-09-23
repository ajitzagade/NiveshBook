import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  updatePartnerShare,
  InvalidPartnerNameError,
  InvalidSharePercentError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort, createPartnerSharePort } from "@niveshbook/db";
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
      { name: body.name, sharePercent: body.sharePercent, userId: linked.userId },
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

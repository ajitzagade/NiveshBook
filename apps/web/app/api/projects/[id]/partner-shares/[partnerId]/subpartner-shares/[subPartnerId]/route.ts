import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorize,
  authorizeScope,
  updateSubPartnerShare,
  InvalidSubPartnerNameError,
  InvalidSubPartnerSharePercentError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort, createPartnerSharePort, createSubPartnerSharePort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE, resolveLinkedUserId } from "@/lib/users";
import { isValidProjectId } from "../../../../../shared";
import { isValidPartnerId } from "../../../shared";
import {
  INVALID_REQUEST_MESSAGE,
  isValidSubPartnerShareBody,
  isValidSubPartnerId,
  subPartnerShareNotFoundResponse,
} from "../shared";

interface RouteContext {
  params: Promise<{ id: string; partnerId: string; subPartnerId: string }>;
}

/**
 * Returns a single Sub-partner Share row (Story 2.5). Allowed for
 * Owner/Admin unconditionally, or the specific linked Sub-partner viewing
 * their own row (`subShare.userId === session.userId`, via
 * `authorize()`'s `"subpartner_shares:view"` self-access override) -- never
 * the parent Partner, never a different Sub-partner (spec-2-5's Decisions:
 * no single-detail grant for the parent Partner here, they already have
 * full list access via `GET .../subpartner-shares`).
 *
 * Path-segment resolution (project `id` exists, `partnerId` belongs to it,
 * `subPartnerId` belongs to `partnerId`) runs identically for *every*
 * caller -- the same chain `PATCH` already uses -- so the response never
 * reveals which stage failed. What differs is the response on failure:
 * Owner/Admin gets the existing granular 404 (`subPartnerShareNotFoundResponse()`,
 * matching `PATCH`'s own precedent of using that response for every
 * resolution-failure stage); anyone else -- including a non-matching
 * Sub-partner or the parent Partner -- gets the same uniform 403 used for a
 * resolution *success* where ownership just doesn't match. This closes
 * Story 2.4's own review lesson structurally: resolution always runs the
 * same way, but only an already-privileged caller (Owner/Admin) can turn a
 * resolution failure into an existence signal -- no unauthorized caller can
 * ever distinguish "doesn't exist" from "not yours."
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
  const { id: projectId, partnerId, subPartnerId } = await params;

  const forbidden = () =>
    NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });

  const resolutionFailed = async (): Promise<NextResponse> => {
    const actor = await userPort.findUserById(session.userId);
    if (actor?.role === "owner_admin") {
      return subPartnerShareNotFoundResponse();
    }
    return forbidden();
  };

  if (
    !isValidProjectId(projectId) ||
    !isValidPartnerId(partnerId) ||
    !isValidSubPartnerId(subPartnerId)
  ) {
    return await resolutionFailed();
  }

  const partnerSharePort = createPartnerSharePort();
  const partner = await partnerSharePort.findLatestByPartnerId(partnerId);
  if (!partner || partner.projectId !== projectId) {
    return await resolutionFailed();
  }

  const subPartnerSharePort = createSubPartnerSharePort();
  const subShare = await subPartnerSharePort.findLatestBySubPartnerId(subPartnerId);
  if (!subShare || subShare.partnerId !== partnerId) {
    return await resolutionFailed();
  }

  const { allowed } = await authorize(
    session.userId,
    "subpartner_shares:view",
    { ownerId: subShare.userId ?? "" },
    { users: userPort },
  );

  if (!allowed) {
    return forbidden();
  }

  return NextResponse.json(subShare);
}

/**
 * Edits an existing Sub-partner's name/Share %. Gated by `authorizeScope()`
 * for `"subpartner_shares:update"` (Owner/Admin-only), checked immediately
 * after the session check and before the body is parsed/validated --
 * mirrors `partner-shares/[partnerId]/route.ts`'s PATCH one level down. Per
 * AD-3 (and spec-2-3's Decisions), this **always** creates a new versioned
 * row -- `packages/core`'s `updateSubPartnerShare` never overwrites the
 * existing one in place, regardless of whether transactions exist against
 * it.
 *
 * All three path segments (`id`, `partnerId`, `subPartnerId`) are validated
 * and cross-checked against each other before anything is updated: a
 * malformed `id`/`partnerId`/`subPartnerId`, a `partnerId` that doesn't
 * belong to the URL's project `id`, or a `subPartnerId` that doesn't belong
 * to the URL's `partnerId`, all get the same uniform 404 -- the same class
 * of bug as Story 2.2's cross-project PATCH fix, one level deeper, so none
 * of those cases leak which one applies and a Sub-partner Share can never
 * be edited through another Partner's or another Project's URL.
 * `linkedUserEmail` (Story 2.4) is resolved to a `userId | null` via
 * `resolveLinkedUserId()`, validated against `role: "sub_partner"` --
 * unresolvable or wrong-role is a 400 `validation_error`, no new version
 * created.
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
  const { allowed } = await authorizeScope(session.userId, "subpartner_shares:update", {
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

  const { id: projectId, partnerId, subPartnerId } = await params;

  if (
    !isValidProjectId(projectId) ||
    !isValidPartnerId(partnerId) ||
    !isValidSubPartnerId(subPartnerId)
  ) {
    return subPartnerShareNotFoundResponse();
  }

  const partnerSharePort = createPartnerSharePort();
  const partner = await partnerSharePort.findLatestByPartnerId(partnerId);
  if (!partner || partner.projectId !== projectId) {
    return subPartnerShareNotFoundResponse();
  }

  const subPartnerSharePort = createSubPartnerSharePort();
  try {
    const existing = await subPartnerSharePort.findLatestBySubPartnerId(subPartnerId);

    if (!existing || existing.partnerId !== partnerId) {
      return subPartnerShareNotFoundResponse();
    }

    const linked = await resolveLinkedUserId(body.linkedUserEmail, "sub_partner", userPort);
    if (!linked.ok) {
      return NextResponse.json(
        { code: "validation_error", message: linked.message },
        { status: 400 },
      );
    }

    const updated = await updateSubPartnerShare(
      subPartnerId,
      { name: body.name, sharePercent: body.sharePercent, userId: linked.userId },
      { subPartnerShares: subPartnerSharePort },
    );

    if (!updated) {
      return subPartnerShareNotFoundResponse();
    }

    return NextResponse.json(updated);
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

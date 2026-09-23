import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorize,
  setApprovalAuthority,
  InvalidApprovalAuthorityTargetError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { UUID_PATTERN } from "@/lib/ids";

const NOT_FOUND_MESSAGE = "User not found.";
const INVALID_REQUEST_MESSAGE = "Request body must be valid JSON";
const INVALID_GRANT_MESSAGE = "`canApproveExtraWithdrawal` must be a boolean.";
const NOT_OWNER_ADMIN_MESSAGE = "canApproveExtraWithdrawal only applies to Owner/Admin users.";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

interface UpdateGrantRequestBody {
  canApproveExtraWithdrawal?: unknown;
}

/**
 * Grants/revokes one Owner/Admin's Extra Withdrawal approval authority
 * (FR45), gated by `authorize()` for `"permissions:manage"` (Owner/Admin-
 * only, no self-access override — matches Story 1.6's
 * `users:update-status`). Both this endpoint and `GET /api/permissions`
 * always re-read live data (AD-1) — a grant change here is visible on the
 * very next `GET`.
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

  let body: UpdateGrantRequestBody;
  try {
    body = (await request.json()) as UpdateGrantRequestBody;
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (typeof body.canApproveExtraWithdrawal !== "boolean") {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_GRANT_MESSAGE },
      { status: 400 },
    );
  }

  const { userId } = await params;
  const userPort = createUserPort();

  const { allowed } = await authorize(
    session.userId,
    "permissions:manage",
    { ownerId: userId },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  if (!UUID_PATTERN.test(userId)) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  let updated;
  try {
    updated = await setApprovalAuthority(userId, body.canApproveExtraWithdrawal, {
      users: userPort,
    });
  } catch (err) {
    if (err instanceof InvalidApprovalAuthorityTargetError) {
      return NextResponse.json(
        { code: "invalid_request", message: NOT_OWNER_ADMIN_MESSAGE },
        { status: 400 },
      );
    }
    throw err;
  }

  if (!updated) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  return NextResponse.json({
    id: updated.id,
    email: updated.email,
    canApproveExtraWithdrawal: updated.canApproveExtraWithdrawal,
  });
}

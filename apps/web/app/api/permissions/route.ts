import { NextResponse, type NextRequest } from "next/server";
import { getSession, authorizeScope, getPermissionsOverview } from "@niveshbook/core";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

/**
 * Owner/Admin-only Permissions overview (FR45): which roles are in use and
 * who currently holds Extra Withdrawal approval authority. Gated by
 * `authorizeScope()` for `"permissions:view"`. Always re-reads live data
 * (AD-1) — never cached — so a change made via `PATCH
 * /api/permissions/[userId]`, or a role/active change made elsewhere, is
 * visible on the very next `GET`.
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
  const { allowed } = await authorizeScope(session.userId, "permissions:view", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const overview = await getPermissionsOverview({ users: userPort });
  return NextResponse.json(overview);
}

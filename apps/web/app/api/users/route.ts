import { NextResponse, type NextRequest } from "next/server";
import { getSession, authorizeScope } from "@niveshbook/core";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { sanitizeUser, UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

/** Owner/Admin-only user directory (AD-1) — proves `authorizeScope()`. */
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
  const { allowed } = await authorizeScope(session.userId, "users:list", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const allUsers = await userPort.listAllUsers();
  return NextResponse.json(allUsers.map(sanitizeUser));
}

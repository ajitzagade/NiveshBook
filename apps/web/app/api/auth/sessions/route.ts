import { NextResponse, type NextRequest } from "next/server";
import { getSession, listSessions } from "@niveshbook/core";
import { createSessionPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";

const UNAUTHENTICATED_MESSAGE = "You must be logged in to do that.";

export async function GET(request: NextRequest) {
  const token = readSessionToken(request);
  const sessionPort = createSessionPort();
  const session = await getSession(token, { sessions: sessionPort });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const sessions = await listSessions(session.userId, { sessions: sessionPort });

  // Only the fields the caller needs to recognize/revoke a session —
  // tokenHash never leaves the server.
  return NextResponse.json(
    sessions.map((s) => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt })),
  );
}

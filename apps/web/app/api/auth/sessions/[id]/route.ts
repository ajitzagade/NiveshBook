import { NextResponse, type NextRequest } from "next/server";
import { getSession, revokeSession } from "@niveshbook/core";
import { createSessionPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UUID_PATTERN } from "@/lib/ids";

const UNAUTHENTICATED_MESSAGE = "You must be logged in to do that.";
const NOT_FOUND_MESSAGE = "Session not found.";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const sessionPort = createSessionPort();
  const session = await getSession(token, { sessions: sessionPort });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  // Scoped to the caller's own userId — a session id belonging to someone
  // else deletes nothing and reads as a plain 404, same as an unknown id.
  const revoked = await revokeSession(id, session.userId, { sessions: sessionPort });

  if (!revoked) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

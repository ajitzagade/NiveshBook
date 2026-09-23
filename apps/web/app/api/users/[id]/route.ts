import { NextResponse, type NextRequest } from "next/server";
import { getSession, authorize, setUserActiveStatus } from "@niveshbook/core";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { sanitizeUser, UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

const NOT_FOUND_MESSAGE = "User not found.";
const INVALID_REQUEST_MESSAGE = "Request body must be valid JSON";
const INVALID_ACTIVE_MESSAGE = "`active` must be a boolean.";

// User ids are UUIDs (v7) — a malformed id can never match a row, so once
// the caller is authorized it gets the same 404 as an id that simply
// doesn't exist, without ever reaching the DB.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Single-user view, gated by `authorize()` (AD-1): allowed if the caller is
 * `owner_admin`, or if they're viewing their own profile (self-access
 * override), regardless of role. Existence (404) and permission (403) are
 * only ever distinguishable to an authorized caller — an unauthorized
 * caller gets 403 whether or not the target id exists.
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

  const { id } = await params;
  const userPort = createUserPort();

  const { allowed } = await authorize(
    session.userId,
    "users:view",
    { ownerId: id },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  const target = await userPort.findUserById(id);

  if (!target) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  return NextResponse.json(sanitizeUser(target));
}

interface UpdateStatusRequestBody {
  active?: unknown;
}

/**
 * Activates/deactivates a user, gated by `authorize()` for
 * `"users:update-status"` (Owner/Admin-only, no self-access override —
 * unlike `GET`). A true -> false transition also deletes the target's live
 * sessions (Story 1.4's session port) so access ends on their very next
 * request, not just their next login.
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

  let body: UpdateStatusRequestBody;
  try {
    body = (await request.json()) as UpdateStatusRequestBody;
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

  if (typeof body.active !== "boolean") {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_ACTIVE_MESSAGE },
      { status: 400 },
    );
  }

  const { id } = await params;
  const userPort = createUserPort();
  const sessionPort = createSessionPort();

  const { allowed } = await authorize(
    session.userId,
    "users:update-status",
    { ownerId: id },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  const updated = await setUserActiveStatus(id, body.active, {
    users: userPort,
    sessions: sessionPort,
  });

  if (!updated) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  return NextResponse.json(sanitizeUser(updated));
}

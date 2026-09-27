import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorize,
  resetUserPassword,
  PasswordTooShortError,
  PasswordTooLongError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { sanitizeUser, UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { UUID_PATTERN } from "@/lib/ids";

const NOT_FOUND_MESSAGE = "User not found.";
const INVALID_REQUEST_MESSAGE = "Request body must be valid JSON";
const INVALID_PASSWORD_MESSAGE = "`password` must be a string.";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ResetPasswordRequestBody {
  password?: unknown;
}

/**
 * Resets a user's password (spec-user-reset-deactivate) -- a distinct,
 * separately-auditable-later sub-route from `PATCH /api/users/[id]`
 * (Decision #1), gated by `authorize()` for `"users:reset-password"`
 * (Owner/Admin-only, no self-access override), checked immediately after the
 * session check and BEFORE the body is parsed/validated -- mirrors `POST
 * /api/users`'s exact "authorize before touching the body" shape (AD-1): a
 * non-Owner/Admin always gets a uniform 403, never a 400 from a malformed
 * body leaking ahead of the authorization check.
 *
 * Ordering after that: not-found (404, `UUID_PATTERN` check) directly follows
 * the permission check, mirroring `GET`/`PATCH /api/users/[id]`'s identical
 * "authorize, then existence" sequence -- before the body is ever parsed.
 *
 * Length validation (8-128 characters) is `resetUserPassword()`'s own job
 * (`packages/core`), not this route's -- this route only checks the body's
 * *shape* (`password` present and a string) before calling it, then maps
 * `PasswordTooShortError`/`PasswordTooLongError` to a 400 `validation_error`
 * with that error's own message.
 *
 * A true `resetUserPassword()` invalidates every one of the target's
 * sessions (Story 1.6's `deleteAllSessionsForUser`, reused unchanged) so the
 * new password takes effect immediately -- the old password/sessions stop
 * working right away, not just at their next natural expiry.
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

  const { id } = await params;
  const userPort = createUserPort();
  const sessionPort = createSessionPort();

  const { allowed } = await authorize(
    session.userId,
    "users:reset-password",
    { ownerId: id },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  // Mirrors GET/PATCH /api/users/[id]'s own ordering -- the not-found check
  // directly follows the permission check, before the body is ever touched.
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  let body: ResetPasswordRequestBody;
  try {
    body = (await request.json()) as ResetPasswordRequestBody;
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

  if (typeof body.password !== "string") {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_PASSWORD_MESSAGE },
      { status: 400 },
    );
  }

  try {
    const updated = await resetUserPassword(id, body.password, {
      users: userPort,
      sessions: sessionPort,
    });

    if (!updated) {
      return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    return NextResponse.json(sanitizeUser(updated));
  } catch (error) {
    if (error instanceof PasswordTooShortError || error instanceof PasswordTooLongError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}

import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  createUser,
  InvalidCreatableRoleError,
  UserEmailAlreadyExistsError,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from "@niveshbook/core";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { sanitizeUser, isCreatableUserRole, UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

const INVALID_REQUEST_MESSAGE = "Request body must be valid JSON";
const EMAIL_INVALID_MESSAGE = "Enter a valid email address.";
const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
const PASSWORD_TOO_LONG_MESSAGE = `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
const ROLE_INVALID_MESSAGE = "Role must be Owner/Admin, Partner, or Sub-partner.";
const EMAIL_IN_USE_MESSAGE = "Email already in use.";
// `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH` now live in `@niveshbook/core`
// (spec-user-reset-deactivate, added alongside `resetUserPassword()`) --
// imported above rather than re-declared here, so the 8-128 bound has one
// server-side source of truth. An unbounded password length reaching
// `argon2.hash()` is a self-inflicted hashing-cost vector (argon2's cost
// scales with input size), even on an Owner/Admin-only endpoint -- mirrors
// `apps/web/app/(dashboard)/users/page.tsx`'s own client-side cap (review
// fix), which stays a separately-declared copy for the same client-bundle
// reason `CREATABLE_USER_ROLES` documents there.

// Deliberately simple -- format validation only, never used to decide
// deliverability. Mirrors the login form's own native `type="email"` check;
// the actual uniqueness check is `findUserByEmail` (pre-check) + the DB's
// `users.email` UNIQUE constraint (race-safe backstop), not this pattern.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

interface CreateUserRequestBody {
  email?: unknown;
  password?: unknown;
  role?: unknown;
}

/**
 * Creates a new login account (spec-user-creation) -- the in-app onboarding
 * path for a Partner/Sub-partner (or another Owner/Admin) that previously
 * only existed as a dev-only seed script. Gated by `authorizeScope()` for
 * `"users:create"` (Owner/Admin-only), checked immediately after the session
 * check and before the body is parsed/validated -- mirrors `POST
 * /api/projects`'s exact "authorize before touching the body" shape (AD-1):
 * a non-Owner/Admin always gets a uniform 403, never a 400 from a malformed
 * body leaking ahead of the authorization check.
 *
 * Duplicate email is checked twice (spec-user-creation's Boundaries): a
 * friendly `findUserByEmail` pre-check for the common case, THEN the
 * `users.email` UNIQUE constraint as the race-safe backstop
 * (`UserEmailAlreadyExistsError`, caught below) -- either path returns the
 * identical 400 message, never a 500 or a raw DB error.
 */
export async function POST(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "users:create", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  let body: CreateUserRequestBody;
  try {
    body = (await request.json()) as CreateUserRequestBody;
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

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" ? body.role : "";

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { code: "validation_error", message: EMAIL_INVALID_MESSAGE },
      { status: 400 },
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { code: "validation_error", message: PASSWORD_TOO_SHORT_MESSAGE },
      { status: 400 },
    );
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json(
      { code: "validation_error", message: PASSWORD_TOO_LONG_MESSAGE },
      { status: 400 },
    );
  }

  if (!isCreatableUserRole(role)) {
    return NextResponse.json(
      { code: "validation_error", message: ROLE_INVALID_MESSAGE },
      { status: 400 },
    );
  }

  // Lowercased here to match `createUser()`'s own normalization exactly
  // (review fix) -- `findUserByEmail` itself also normalizes internally, so
  // this doesn't change behavior, but keeps this pre-check self-evidently
  // consistent with the case-insensitive uniqueness it's checking for,
  // without relying on a reader knowing the port's own internals.
  const existing = await userPort.findUserByEmail(email.toLowerCase());
  if (existing) {
    return NextResponse.json(
      { code: "validation_error", message: EMAIL_IN_USE_MESSAGE },
      { status: 400 },
    );
  }

  try {
    const created = await createUser(email, password, role, { users: userPort });
    return NextResponse.json(sanitizeUser(created), { status: 201 });
  } catch (error) {
    if (error instanceof UserEmailAlreadyExistsError) {
      return NextResponse.json(
        { code: "validation_error", message: EMAIL_IN_USE_MESSAGE },
        { status: 400 },
      );
    }
    if (error instanceof InvalidCreatableRoleError) {
      return NextResponse.json(
        { code: "validation_error", message: ROLE_INVALID_MESSAGE },
        { status: 400 },
      );
    }
    throw error;
  }
}

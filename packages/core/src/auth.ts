import { randomBytes, createHash } from "node:crypto";
import * as argon2 from "argon2";
import type { Session, User, UserRole } from "@niveshbook/types";
import type { UserPort } from "./user-port";
import type { SessionPort } from "./session-port";

/** Sessions expire after 30 minutes of inactivity (Epic 1 assumption). */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * A precomputed argon2 hash with no corresponding user, verified against on
 * an unknown-email login so that path costs the same as a known-email/
 * wrong-password path — otherwise the unknown-email branch returns early
 * and an attacker can enumerate valid emails purely from response timing,
 * even though the response text is identical.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$0Gk2gAeAlpF0QZuXa6hRXQ$oMfXx9fjW8JV0CQnfepEh+q1Pzr+vWhsE2OEwKw4pwI";

export interface AuthDeps {
  users: UserPort;
  sessions: SessionPort;
}

export type LoginErrorCode = "invalid_credentials" | "inactive_account";

export type LoginResult =
  | { ok: true; token: string; expiresAt: string; userId: string }
  | { ok: false; error: LoginErrorCode };

/**
 * Hashes an opaque session token for storage/lookup. Only the hash is ever
 * persisted (AD-8) — the raw token is the bearer credential in the cookie.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Verifies credentials, checks the account is active, and (on success)
 * creates a server-side session. A wrong password and an unknown email
 * return the identical `invalid_credentials` error — callers must render
 * them as the same message so neither case can be distinguished.
 */
export async function login(email: string, password: string, deps: AuthDeps): Promise<LoginResult> {
  const user = await deps.users.findUserByEmail(email);

  const passwordValid = await argon2
    .verify(user ? user.passwordHash : DUMMY_PASSWORD_HASH, password)
    .catch(() => false);

  if (!user || !passwordValid) {
    return { ok: false, error: "invalid_credentials" };
  }

  if (!user.active) {
    return { ok: false, error: "inactive_account" };
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await deps.sessions.createSession({ userId: user.id, tokenHash, expiresAt });

  return { ok: true, token, expiresAt, userId: user.id };
}

/**
 * Deletes the session row server-side so the token can never authenticate
 * again — logout is never just a client-side cookie clear.
 */
export async function logout(tokenHash: string, deps: Pick<AuthDeps, "sessions">): Promise<void> {
  await deps.sessions.deleteSession(tokenHash);
}

/**
 * Resolves a bearer session token to a live, unexpired session. Missing,
 * garbage, unknown, or expired tokens are all treated as unauthenticated
 * (returns `null`) rather than throwing.
 *
 * Every successful resolution renews the session's `expiresAt` by another
 * `SESSION_TTL_MS` (sliding window, FR5) — a continuously-active user is
 * never logged out mid-session, only genuine inactivity expires it.
 */
export async function getSession(
  token: string | null | undefined,
  deps: Pick<AuthDeps, "sessions">,
): Promise<Session | null> {
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const session = await deps.sessions.findSessionByTokenHash(tokenHash);

  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const touchedCount = await deps.sessions.touchSession(tokenHash, expiresAt);

  // TOCTOU guard: if the session was revoked between the read above and
  // this write, the update matched no row — treat that as unauthenticated
  // rather than returning the now-stale session we already read.
  if (touchedCount === 0) {
    return null;
  }

  return { ...session, expiresAt };
}

/**
 * Lists a user's own active sessions. Scoped to `userId` at the port level
 * so it can never return another user's session rows.
 */
export async function listSessions(
  userId: string,
  deps: Pick<AuthDeps, "sessions">,
): Promise<Session[]> {
  return deps.sessions.listSessionsByUser(userId);
}

/**
 * Revokes a session by id, scoped to the owning user — deletes the row
 * immediately (AD-8) so the very next request using that token is rejected.
 * If `sessionId` belongs to a different user (or doesn't exist), nothing is
 * deleted and this resolves to `false`; callers should surface that as a
 * plain 404, not a 403 that would hint the id exists elsewhere.
 */
export async function revokeSession(
  sessionId: string,
  userId: string,
  deps: Pick<AuthDeps, "sessions">,
): Promise<boolean> {
  const deletedCount = await deps.sessions.deleteSessionById(sessionId, userId);
  return deletedCount > 0;
}

/**
 * Sets a user's `active` flag (Story 1.6). Callers must run `authorize()`
 * for `"users:update-status"` before calling this — it performs no
 * permission check of its own.
 *
 * A true -> false transition also deletes every one of the target's
 * `sessions` rows (AD-8), so access ends on their very next request rather
 * than merely at next login. Every other case — reactivating (false ->
 * true), or setting the same value again (idempotent no-op) — never touches
 * sessions: reactivating never restores/recreates a session.
 *
 * Returns `null` if `userId` doesn't match any user, so callers can surface
 * a 404.
 */
export async function setUserActiveStatus(
  userId: string,
  active: boolean,
  deps: Pick<AuthDeps, "users" | "sessions">,
): Promise<User | null> {
  const before = await deps.users.findUserById(userId);

  if (!before) {
    return null;
  }

  const updated = await deps.users.setUserActive(userId, active);

  if (!updated) {
    return null;
  }

  if (before.active && !active) {
    await deps.sessions.deleteAllSessionsForUser(userId);
  }

  return updated;
}

/**
 * The roles an Owner/Admin may create an account with (spec-user-creation,
 * Decision #1) -- deliberately excludes `project_admin` (FR6): that role is
 * valid-but-ungated everywhere else in the app (Story 1.8's job to enable
 * per-client), so an account created with it today would be a dead end.
 * Spelled out explicitly here (not derived from `UserRole` minus one member)
 * so this list can never silently widen just because `UserRole` itself grows
 * a new member elsewhere.
 *
 * Exported so a test can assert this set matches `apps/web/lib/users.ts`'s
 * own separately-declared `CREATABLE_USER_ROLES` copy (that file can't
 * import this one at runtime -- a `"use client"` page importing
 * `@niveshbook/core` breaks the client bundle, argon2 has no browser-safe
 * subpath export) -- catching drift between the two with a test instead of
 * leaving it to be noticed by hand.
 */
export const CREATABLE_USER_ROLES: ReadonlySet<UserRole> = new Set(["owner_admin", "partner", "sub_partner"]);

/**
 * Thrown by `createUser()` when `role` isn't one of `CREATABLE_USER_ROLES` --
 * most importantly, `project_admin` (see that constant's doc comment). The
 * route layer validates this ahead of time too (spec-user-creation's Task
 * list), so in practice this only fires for a caller that skips that
 * validation -- still enforced here as the domain-layer's own invariant,
 * never trusted to the route alone.
 */
export class InvalidCreatableRoleError extends Error {
  constructor(role: string) {
    super(`"${role}" is not a role that can be created here.`);
    this.name = "InvalidCreatableRoleError";
  }
}

/** The same 8-128 character bounds `createUser()`'s own route-layer validation established (spec-user-creation) -- `resetUserPassword()` reuses them, this time enforced at the domain layer itself (see that function's own doc comment for why). */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** Thrown by `resetUserPassword()` for a password under `MIN_PASSWORD_LENGTH` characters. */
export class PasswordTooShortError extends Error {
  constructor() {
    super(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    this.name = "PasswordTooShortError";
  }
}

/**
 * Thrown by `resetUserPassword()` for a password over `MAX_PASSWORD_LENGTH`
 * characters -- an unbounded length reaching `argon2.hash()` is a
 * self-inflicted hashing-cost vector (argon2's cost scales with input size),
 * mirroring `POST /api/users`'s own identical rationale for capping
 * `createUser()`'s password at the route layer.
 */
export class PasswordTooLongError extends Error {
  constructor() {
    super(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
    this.name = "PasswordTooLongError";
  }
}

/**
 * Resets a user's password (spec-user-reset-deactivate) -- an Owner/Admin's
 * replacement for direct DB access when a Partner/Sub-partner (or another
 * Owner/Admin) forgets or compromises their password. Callers must run
 * `authorize()` for `"users:reset-password"` before calling this (AD-1) — it
 * performs no permission check of its own, mirroring `setUserActiveStatus()`'s/
 * `createUser()`'s identical contract.
 *
 * Unlike `createUser()` (whose 8-128 length bound is enforced only at the
 * route layer, `apps/web/app/api/users/route.ts`), this function validates
 * `newPassword`'s length itself, throwing `PasswordTooShortError`/
 * `PasswordTooLongError` -- this spec's Code Map calls for the domain layer
 * to own this invariant directly rather than trusting the route alone, since
 * a resettable password is otherwise unbounded input reaching `argon2.hash()`
 * (a self-inflicted hashing-cost vector) with no route-level gate of its own
 * guaranteed to exist ahead of it.
 *
 * `newPassword` is hashed via `argon2.hash()` (the same call shape
 * `createUser()` already uses, no explicit cost params) -- the plaintext
 * password is never itself stored, logged, or returned. On a successful
 * update, every one of the target's `sessions` rows is deleted (mirrors
 * `setUserActiveStatus()`'s true -> false session-invalidation precedent),
 * so the reset takes effect immediately: the old password's sessions stop
 * working right away, not just at their next natural expiry.
 *
 * Returns `null` if `userId` doesn't match any user, so callers can surface
 * a 404 -- mirrors `setUserActiveStatus()`'s identical not-found contract.
 * No `sessions.deleteAllSessionsForUser` call happens in that case.
 */
export async function resetUserPassword(
  userId: string,
  newPassword: string,
  deps: Pick<AuthDeps, "users" | "sessions">,
): Promise<User | null> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordTooShortError();
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordTooLongError();
  }

  const passwordHash = await argon2.hash(newPassword);
  const updated = await deps.users.updatePassword(userId, passwordHash);

  if (!updated) {
    return null;
  }

  await deps.sessions.deleteAllSessionsForUser(userId);

  return updated;
}

/**
 * Creates a new login account (spec-user-creation) -- the in-app
 * replacement for the dev-only `packages/db/src/seed.ts` script, which
 * always hardcoded `role: "owner_admin"`. Callers must run `authorizeScope()`
 * for `"users:create"` before calling this (AD-1) — it performs no
 * permission check of its own, mirroring `setUserActiveStatus()`'s identical
 * contract.
 *
 * `email` is trimmed/lowercased here -- `login()` itself does NOT normalize
 * (that happens one layer up, in `apps/web/app/api/auth/login/route.ts`,
 * before it ever calls `login()`); this function normalizes internally
 * instead, matching that route's own convention, so a case-differing
 * resubmission of the same address is still caught by the `users.email`
 * UNIQUE constraint rather than silently creating a second account.
 * `password` is hashed via `argon2.hash()` (the same call
 * shape `packages/db/src/seed.ts` already uses, no explicit cost params) --
 * the plaintext password is never itself stored, logged, or returned.
 *
 * Throws `InvalidCreatableRoleError` for a role outside `CREATABLE_USER_ROLES`,
 * or propagates `UserEmailAlreadyExistsError` from `deps.users.createUser()`
 * unchanged if the email collides with an existing account (the route layer
 * maps both to a 400 `validation_error`, never a 500).
 */
export async function createUser(
  email: string,
  password: string,
  role: UserRole,
  deps: Pick<AuthDeps, "users">,
): Promise<User> {
  if (!CREATABLE_USER_ROLES.has(role)) {
    throw new InvalidCreatableRoleError(role);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await argon2.hash(password);

  return deps.users.createUser({ email: normalizedEmail, passwordHash, role });
}

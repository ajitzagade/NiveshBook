import { randomBytes, createHash } from "node:crypto";
import * as argon2 from "argon2";
import type { Session } from "@niveshbook/types";
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

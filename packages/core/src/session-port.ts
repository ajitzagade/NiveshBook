import type { Session } from "@niveshbook/types";

export interface CreateSessionInput {
  userId: string;
  /** Hash of the opaque session token — the raw token is never persisted. */
  tokenHash: string;
  /** ISO 8601 timestamp. */
  expiresAt: string;
}

/**
 * Port for the Postgres-backed `sessions` table (AD-8). Sessions are
 * server-side and immediately revocable — deleting the row ends the
 * session on the very next request. Implemented by `packages/db`;
 * `packages/core` never imports a DB driver directly (AD-9).
 */
export interface SessionPort {
  createSession(input: CreateSessionInput): Promise<Session>;
  deleteSession(tokenHash: string): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<Session | null>;
}

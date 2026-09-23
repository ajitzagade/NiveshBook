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
  /**
   * Slides a session's expiry forward to `expiresAt` — the sliding-window
   * renewal that keeps a continuously-active user logged in (FR5). Returns
   * the number of rows updated (0 or 1) so a caller can detect a
   * revoke-then-renew race: if the row was deleted between the read and
   * this write, the update matches nothing.
   */
  touchSession(tokenHash: string, expiresAt: string): Promise<number>;
  /** All sessions belonging to a user, for self-service session listing. */
  listSessionsByUser(userId: string): Promise<Session[]>;
  /**
   * Deletes a session only if it belongs to `userId`. Returns the number of
   * rows deleted (0 or 1) so a mismatched/unknown owner is indistinguishable
   * from the caller's side — both delete nothing rather than throwing.
   */
  deleteSessionById(id: string, userId: string): Promise<number>;
}

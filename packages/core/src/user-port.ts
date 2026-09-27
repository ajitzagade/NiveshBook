import type { User, UserRole } from "@niveshbook/types";

/**
 * Already-validated input for creating one login account (spec-user-
 * creation) -- `email` is already trimmed/lowercased and `passwordHash` is
 * already an `argon2.hash()` output by the time this reaches the port;
 * `role` has already been confirmed to be in the creatable set. This port
 * never sees a plaintext password (AD-9-style separation: hashing is
 * `packages/core`'s `createUser()` domain function's job, never the DB
 * layer's).
 */
export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role: UserRole;
}

/**
 * Thrown by `packages/db`'s `createUserPort().createUser` when the
 * `users.email` UNIQUE constraint rejects an insert -- the race-safe
 * backstop behind `packages/core`'s `createUser()`'s friendly
 * `findUserByEmail` pre-check (spec-user-creation's Boundaries: two
 * concurrent requests for the same email can both pass that pre-check, but
 * only one insert can win). Mirrors `AdjustmentNettingIdempotencyKeyConflictError`'s
 * exact "typed error for a DB unique-constraint violation" shape.
 */
export class UserEmailAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`A user with the email "${email}" already exists.`);
    this.name = "UserEmailAlreadyExistsError";
  }
}

/**
 * Port for reading user records. Implemented by `packages/db` against
 * Postgres; `packages/core` never imports a DB driver directly (AD-9).
 */
export interface UserPort {
  findUserByEmail(email: string): Promise<User | null>;
  /** Looks up a user by id — the live role read that `authorize()`/`authorizeScope()` rely on (AD-1). */
  findUserById(id: string): Promise<User | null>;
  /** Every user, for the Owner/Admin-only user directory (never sorted/filtered at this layer). */
  listAllUsers(): Promise<User[]>;
  /**
   * Flips a user's `active` flag. Returns the updated user, or `null` if
   * `id` doesn't match any row — callers surface that as a 404 rather than
   * throwing.
   */
  setUserActive(id: string, active: boolean): Promise<User | null>;
  /**
   * Toggles a user's Extra Withdrawal approval-authority grant (FR45, Story
   * 1.7). Returns the updated user, or `null` if `id` doesn't match any row.
   * Performs no role validation of its own — `packages/core`'s
   * `setApprovalAuthority` domain function confirms the target is
   * `owner_admin` before ever calling this.
   */
  setApprovalAuthority(id: string, granted: boolean): Promise<User | null>;
  /**
   * Inserts a new login account (spec-user-creation). Throws
   * `UserEmailAlreadyExistsError` if `input.email` collides with the
   * `users.email` UNIQUE constraint -- the only error this method is
   * expected to throw; any other DB error propagates unchanged.
   */
  createUser(input: CreateUserInput): Promise<User>;
}

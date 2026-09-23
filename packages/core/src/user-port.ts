import type { User } from "@niveshbook/types";

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
}

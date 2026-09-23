export type UserRole = "owner_admin" | "partner" | "sub_partner" | "project_admin";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  /**
   * Grants Extra Withdrawal approval authority (FR25/FR45, Story 1.7). Only
   * meaningful for `owner_admin` — a distinct, revocable grant, not merely
   * "is this user `owner_admin`". Not yet enforced anywhere (Epic 4's Extra
   * Withdrawal flow is its first consumer).
   */
  canApproveExtraWithdrawal: boolean;
  /** ISO 8601 timestamp */
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  /** ISO 8601 timestamp */
  expiresAt: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * A Project (Epic 2, Story 2.1): created with just a Name and Description —
 * no partner information is required to save. `description` is nullable —
 * a Project can exist with none. Money/balance columns and Partner Share
 * data are added by later Epic 2/3/4 stories, not this type.
 */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

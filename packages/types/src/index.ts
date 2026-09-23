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

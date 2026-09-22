export type UserRole = "owner_admin" | "partner" | "sub_partner" | "project_admin";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
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

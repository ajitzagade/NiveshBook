import type { User, UserRole } from "@niveshbook/types";
import type { UserPort } from "@niveshbook/core";

export const UNAUTHENTICATED_MESSAGE = "You must be logged in to do that.";
export const FORBIDDEN_MESSAGE = "You don't have permission to do that.";

/** Never includes `passwordHash` — this is the only shape a user route ever returns. */
export function sanitizeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
  };
}

export type LinkedUserResolution = { ok: true; userId: string | null } | { ok: false; message: string };

const ROLE_LABEL: Record<UserRole, string> = {
  owner_admin: "Owner/Admin",
  partner: "Partner",
  sub_partner: "Sub-partner",
  project_admin: "Project Admin",
};

/**
 * Resolves the "Linked user (email)" field shared by the Add/Edit Partner
 * and Add/Edit Sub-partner dialogs (Story 2.4) into a `userId | null` --
 * email resolution deliberately happens here, at the route layer, never in
 * `packages/core` (spec-2-4's Decisions: keeps `packages/core`'s port
 * dependencies narrow -- the domain layer never needs a `UserPort`).
 *
 * An empty string always means "no link", never "leave unchanged" -- every
 * POST/PATCH body is a full overwrite (matches `name`/`sharePercent`'s
 * existing convention, AD-3). A non-empty email that doesn't resolve to any
 * user, or resolves to a user whose global `role` doesn't match
 * `expectedRole` (`"partner"` for Partner Shares, `"sub_partner"` for
 * Sub-partner Shares), is rejected -- the caller surfaces this as a 400
 * `validation_error` before ever calling into `packages/core`.
 */
export async function resolveLinkedUserId(
  linkedUserEmail: string,
  expectedRole: UserRole,
  userPort: UserPort,
): Promise<LinkedUserResolution> {
  const trimmed = linkedUserEmail.trim();
  if (trimmed.length === 0) {
    return { ok: true, userId: null };
  }

  const user = await userPort.findUserByEmail(trimmed);
  if (!user) {
    return { ok: false, message: "No user found with that email." };
  }

  if (user.role !== expectedRole) {
    return {
      ok: false,
      message: `That user is not a ${ROLE_LABEL[expectedRole]}.`,
    };
  }

  return { ok: true, userId: user.id };
}

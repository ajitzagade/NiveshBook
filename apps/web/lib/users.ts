import type { User } from "@niveshbook/types";

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

import type { UserRole } from "@niveshbook/types";
import type { UserPort } from "./user-port";

/** Re-exported under the gate's own name for readability at call sites. */
export type Role = UserRole;

/**
 * Protected actions this story's gate proves against a real resource (the
 * user directory). Later epics extend this union as Project/Partner-scoped
 * actions arrive — the gate mechanism itself doesn't change.
 */
export type Action =
  | "users:list"
  | "users:view"
  | "users:update-status"
  | "permissions:view"
  | "permissions:manage";

/**
 * Role -> allowed-actions permission table. All actions here are
 * Owner/Admin-only; `project_admin` exists as a valid role value (FR6) but
 * is not granted anything yet — per-client enabling of that role is Story
 * 1.8's job, not this gate's.
 */
const PERMISSIONS: Record<Action, ReadonlySet<Role>> = {
  "users:list": new Set(["owner_admin"]),
  "users:view": new Set(["owner_admin"]),
  "users:update-status": new Set(["owner_admin"]),
  // Story 1.7 (FR45): the Permissions area (role-usage view + Extra
  // Withdrawal approval-authority grants). Owner/Admin-only, matching
  // users:update-status — no self-access override either.
  "permissions:view": new Set(["owner_admin"]),
  "permissions:manage": new Set(["owner_admin"]),
};

/**
 * Actions where self-access always short-circuits to allowed, regardless of
 * role (e.g. viewing your own profile). `users:update-status` is
 * deliberately excluded — an Owner/Admin acting on their own id still goes
 * through the normal role check (there is no override to grant a
 * non-Owner/Admin the ability to deactivate themselves either).
 */
const SELF_ACCESS_ACTIONS: ReadonlySet<Action> = new Set(["users:view"]);

export interface AuthorizeDeps {
  users: UserPort;
}

export interface ResourceRef {
  /**
   * The id of the user who "owns" the resource being checked. For the
   * user-directory single-view action this is simply the target user's id:
   * a caller is always allowed to view their own profile regardless of
   * role (self-access override), independent of the permission table.
   */
  ownerId: string;
}

export interface AuthorizeResult {
  allowed: boolean;
}

/**
 * Single-resource authorization check (AD-1). Always re-reads the actor's
 * *current* role from the `users` table via `deps.users.findUserById` —
 * never from the session row — so a role change takes effect on the very
 * next call, not the next login.
 *
 * Self-access is allowed for actions in `SELF_ACCESS_ACTIONS` (e.g.
 * `users:view`): if `resourceRef.ownerId` equals `actorUserId`, the check
 * short-circuits to allowed without even needing the actor to still exist in
 * a role granted by the permission table. Compared case-insensitively —
 * UUIDs are case-insensitive (RFC 4122), and this endpoint can be called
 * directly with a hand-typed id. Actions not in that allow-list (e.g.
 * `users:update-status`) always fall through to the normal role check, even
 * when the actor is targeting their own id.
 */
export async function authorize(
  actorUserId: string,
  action: Action,
  resourceRef: ResourceRef,
  deps: AuthorizeDeps,
): Promise<AuthorizeResult> {
  if (
    SELF_ACCESS_ACTIONS.has(action) &&
    resourceRef.ownerId.toLowerCase() === actorUserId.toLowerCase()
  ) {
    return { allowed: true };
  }

  const actor = await deps.users.findUserById(actorUserId);

  if (!actor) {
    return { allowed: false };
  }

  return { allowed: PERMISSIONS[action].has(actor.role) };
}

/**
 * List/scope-level authorization check (AD-1). Returns `{ allowed: boolean
 * }` for now — full scope-filtering (e.g. "partners see only their own
 * projects") arrives in Epic 2 once Project/Partner resources exist; this
 * story's actions (`users:list`) are all-or-nothing for a given role, so
 * there is no filter to compute yet.
 *
 * Like `authorize()`, always re-reads the actor's live role — never cached.
 */
export async function authorizeScope(
  actorUserId: string,
  action: Action,
  deps: AuthorizeDeps,
): Promise<AuthorizeResult> {
  const actor = await deps.users.findUserById(actorUserId);

  if (!actor) {
    return { allowed: false };
  }

  return { allowed: PERMISSIONS[action].has(actor.role) };
}

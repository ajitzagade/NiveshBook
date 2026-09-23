import type { User } from "@niveshbook/types";
import type { UserPort } from "./user-port";

export interface PermissionsDeps {
  users: UserPort;
}

export interface PermissionsOverviewDeps extends PermissionsDeps {
  /**
   * Whether Project Admin is enabled for this deployment, resolved by the
   * caller from `client.config` (Story 1.8, AD-7/AD-9). `packages/core`
   * never reads a `CLIENT_*` env var or imports `client-config.ts` itself —
   * this is supplied the same way any other dependency is.
   */
  projectAdminEnabled: boolean;
}

/** The shape of one Owner/Admin's approval-authority grant, as surfaced by the Permissions area. */
export interface ApproverSummary {
  id: string;
  email: string;
  canApproveExtraWithdrawal: boolean;
}

export interface PermissionsOverview {
  /**
   * Which roles are enabled for this deployment. `project_admin` is sourced
   * entirely from the caller-supplied `projectAdminEnabled` (Story 1.8's
   * per-client config) — not from whether any `project_admin` user
   * currently exists or is active.
   */
  enabledRoles: { project_admin: boolean };
  /** Every `owner_admin` user and their current Extra Withdrawal approval-authority grant. */
  approvers: ApproverSummary[];
}

function toApproverSummary(user: User): ApproverSummary {
  return {
    id: user.id,
    email: user.email,
    canApproveExtraWithdrawal: user.canApproveExtraWithdrawal,
  };
}

/**
 * Builds the Owner/Admin Permissions overview (FR45): which roles are
 * enabled for this deployment, and who currently holds Extra Withdrawal
 * approval authority. `enabledRoles.project_admin` is taken directly from
 * `deps.projectAdminEnabled` (Story 1.8's per-client config) — approvers
 * always re-read live data via `listAllUsers()` — never cached (AD-1) — so
 * a grant toggled by `setApprovalAuthority` is visible on the very next
 * call.
 */
export async function getPermissionsOverview(
  deps: PermissionsOverviewDeps,
): Promise<PermissionsOverview> {
  const allUsers = await deps.users.listAllUsers();

  const approvers = allUsers
    .filter((user) => user.role === "owner_admin" && user.active)
    .map(toApproverSummary);

  return {
    enabledRoles: { project_admin: deps.projectAdminEnabled },
    approvers,
  };
}

/**
 * Thrown by `setApprovalAuthority` when the target user isn't `owner_admin`
 * — `canApproveExtraWithdrawal` only ever means something for that role, so
 * attempting to set it on any other role is a caller error. Callers (the
 * `PATCH /api/permissions/[userId]` route) catch this and surface a 400,
 * making no change.
 */
export class InvalidApprovalAuthorityTargetError extends Error {
  constructor() {
    super("canApproveExtraWithdrawal only applies to owner_admin users.");
    this.name = "InvalidApprovalAuthorityTargetError";
  }
}

/**
 * Grants/revokes one Owner/Admin's Extra Withdrawal approval authority
 * (FR45). Callers must run `authorize()` for `"permissions:manage"` before
 * calling this — it performs no permission check of its own.
 *
 * Resolves to `null` if `userId` doesn't match any user, so callers can
 * surface a 404. Throws `InvalidApprovalAuthorityTargetError` (a caller
 * error, surfaced as 400) if the target exists but isn't `owner_admin` —
 * no change is made in that case.
 */
export async function setApprovalAuthority(
  userId: string,
  granted: boolean,
  deps: PermissionsDeps,
): Promise<User | null> {
  const target = await deps.users.findUserById(userId);

  if (!target) {
    return null;
  }

  if (target.role !== "owner_admin") {
    throw new InvalidApprovalAuthorityTargetError();
  }

  return deps.users.setApprovalAuthority(userId, granted);
}

import type { User } from "@niveshbook/types";
import type { UserPort } from "./user-port";
import type { PartnerSharePort } from "./partner-share-port";
import { listAllCurrentPartnerShares } from "./partner-share";

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
  /** Story 2.7: source of every current Partner Share, across every Project, for the `partners` visibility-grant list. */
  partnerShares: PartnerSharePort;
}

/** The shape of one Owner/Admin's approval-authority grant, as surfaced by the Permissions area. */
export interface ApproverSummary {
  id: string;
  email: string;
  canApproveExtraWithdrawal: boolean;
}

/**
 * The shape of one Partner's Sub-partner Visibility Grant (Story 2.6)
 * state, as surfaced by the Permissions area (Story 2.7). A minimal
 * projection, not the full `PartnerShare` row -- never `sharePercent`,
 * `userId`, `id`, `effectiveFrom`, or `createdAt`. `projectId` is included
 * for traceability/uniqueness only (two Projects can have same-named
 * Partners) -- no Project `name` join.
 */
export interface PartnerVisibilitySummary {
  partnerId: string;
  projectId: string;
  name: string;
  subPartnerVisibilityGrant: boolean;
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
  /** Every current Partner Share, across every Project, with its Sub-partner Visibility Grant state (Story 2.7). Global, not per-Project. */
  partners: PartnerVisibilitySummary[];
}

function toApproverSummary(user: User): ApproverSummary {
  return {
    id: user.id,
    email: user.email,
    canApproveExtraWithdrawal: user.canApproveExtraWithdrawal,
  };
}

function toPartnerVisibilitySummary(share: {
  partnerId: string;
  projectId: string;
  name: string;
  subPartnerVisibilityGrant: boolean;
}): PartnerVisibilitySummary {
  return {
    partnerId: share.partnerId,
    projectId: share.projectId,
    name: share.name,
    subPartnerVisibilityGrant: share.subPartnerVisibilityGrant,
  };
}

/**
 * Builds the Owner/Admin Permissions overview (FR45): which roles are
 * enabled for this deployment, who currently holds Extra Withdrawal
 * approval authority, and (Story 2.7) which Partners currently have their
 * Sub-partner Visibility Grant on, across every Project.
 * `enabledRoles.project_admin` is taken directly from
 * `deps.projectAdminEnabled` (Story 1.8's per-client config) — approvers
 * and partners always re-read live data via `listAllUsers()` /
 * `listAllCurrentPartnerShares()` — never cached (AD-1) — so a grant
 * toggled by `setApprovalAuthority` or a Partner's edit is visible on the
 * very next call.
 */
export async function getPermissionsOverview(
  deps: PermissionsOverviewDeps,
): Promise<PermissionsOverview> {
  const allUsers = await deps.users.listAllUsers();

  const approvers = allUsers
    .filter((user) => user.role === "owner_admin" && user.active)
    .map(toApproverSummary);

  const currentPartnerShares = await listAllCurrentPartnerShares({
    partnerShares: deps.partnerShares,
  });
  const partners = currentPartnerShares.map(toPartnerVisibilitySummary);

  return {
    enabledRoles: { project_admin: deps.projectAdminEnabled },
    approvers,
    partners,
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

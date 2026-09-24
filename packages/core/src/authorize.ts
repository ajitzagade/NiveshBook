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
  | "permissions:manage"
  | "projects:create"
  | "projects:update"
  | "projects:list"
  | "partner_shares:create"
  | "partner_shares:update"
  | "partner_shares:list"
  | "partner_shares:view_grant"
  | "subpartner_shares:create"
  | "subpartner_shares:update"
  | "subpartner_shares:list"
  | "subpartner_shares:view";

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
  // Story 2.1 (Epic 2): a Project must be creatable/editable with zero
  // partners, so there's no Project-shaped `ResourceRef` yet — these three
  // actions are all-or-nothing per role, exactly like `users:list`, checked
  // via `authorizeScope()` only. Story 2.4+ builds Project/Partner-scoped
  // `resourceRef`s once Partner records exist to scope against.
  "projects:create": new Set(["owner_admin"]),
  "projects:update": new Set(["owner_admin"]),
  "projects:list": new Set(["owner_admin"]),
  // Story 2.2: same story as Story 2.1's Project actions -- no Partner
  // Share-shaped `ResourceRef` yet (that's Story 2.4+, once the co-partner
  // privacy boundary needs something to scope against), so these are
  // all-or-nothing per role, checked via `authorizeScope()` only. Every
  // Partner Share is visible to every Owner/Admin request.
  "partner_shares:create": new Set(["owner_admin"]),
  "partner_shares:update": new Set(["owner_admin"]),
  "partner_shares:list": new Set(["owner_admin"]),
  // Story 2.6: single-resource "view this Partner's total Share % via the
  // grant" -- same all-or-nothing-for-the-role-table shape as the other
  // `partner_shares:*` actions (Owner/Admin unconditionally, checked at the
  // route layer against the full row); the actual Sub-partner grant-gated
  // access is admitted below via `SCOPE_SELF_ACCESS_ACTIONS`, reusing
  // `authorizeScope()`'s Story 2.4 mechanism one level down (a Partner's
  // *current Sub-partners'* `userId`s as `scopeOwnerIds`, not a Partner's
  // own). The `partner.subPartnerVisibilityGrant` flag itself is a separate
  // condition checked by the route, not by this permission table.
  "partner_shares:view_grant": new Set(["owner_admin"]),
  // Story 2.3: same story as Story 2.2's Partner Share actions -- no
  // Sub-partner Share-shaped `ResourceRef` yet (that's Stories 2.4-2.6, once
  // the co-partner/sub-partner privacy boundary needs something to scope
  // against), so these are all-or-nothing per role, checked via
  // `authorizeScope()` only. Every Sub-partner Share is visible to every
  // Owner/Admin request.
  "subpartner_shares:create": new Set(["owner_admin"]),
  "subpartner_shares:update": new Set(["owner_admin"]),
  "subpartner_shares:list": new Set(["owner_admin"]),
  // Story 2.5: single-resource "view your own Sub-partner Share" -- same
  // all-or-nothing-for-the-role-table shape as the other
  // `subpartner_shares:*` actions (Owner/Admin unconditionally); the actual
  // Sub-partner self-access is granted below via `SELF_ACCESS_ACTIONS`, not
  // by adding `sub_partner` to this Set.
  "subpartner_shares:view": new Set(["owner_admin"]),
};

/**
 * Actions where self-access always short-circuits to allowed, regardless of
 * role (e.g. viewing your own profile). `users:update-status` is
 * deliberately excluded — an Owner/Admin acting on their own id still goes
 * through the normal role check (there is no override to grant a
 * non-Owner/Admin the ability to deactivate themselves either).
 *
 * Story 2.4 adds `subpartner_shares:list`: a linked Partner may list their
 * own Sub-partner structure (`resourceRef.ownerId` is the target Partner
 * Share row's `userId`) — the same single-resource idiom as `users:view`,
 * just scoped to a different resource. A `sub_partner`-role actor's own
 * `userId` is never a `partner_shares.userId` (different table/column), so
 * this cannot accidentally admit a Sub-partner (Story 2.5's job, untouched
 * here).
 *
 * Story 2.5 adds `subpartner_shares:view`: the specific linked Sub-partner
 * may view their own single Sub-partner Share row (`resourceRef.ownerId` is
 * the target row's own `userId`) -- the identical single-resource idiom as
 * `subpartner_shares:list` above, just one level deeper (a Sub-partner's own
 * row rather than a Partner's whole structure) and matched against the
 * Sub-partner's own `userId` rather than a Partner's.
 */
const SELF_ACCESS_ACTIONS: ReadonlySet<Action> = new Set([
  "users:view",
  "subpartner_shares:list",
  "subpartner_shares:view",
]);

/**
 * Actions where `authorizeScope()` additionally allows any actor whose id
 * appears in the caller-supplied `scopeOwnerIds` list (Story 2.4) — the
 * list/scope-level generalization of `SELF_ACCESS_ACTIONS`'s single-resource
 * idiom, one owner to many. `partner_shares:list` opens to a linked Partner,
 * scoped to Projects they're actually linked to (their `userId` matches a
 * `userId` on a *current* Partner Share row for the requested Project) — not
 * every Project (FR7). The route computes `scopeOwnerIds` from the Project's
 * current Partner Shares' `userId`s before calling `authorizeScope()`.
 *
 * Story 2.6 adds `partner_shares:view_grant`: a Sub-partner linked to one of
 * a *specific* Partner's *current* Sub-partner Shares -- `scopeOwnerIds` is
 * that Partner's current Sub-partner Shares' `userId`s (via
 * `listCurrentSubPartnerShares`), not the Project's Partner Shares' `userId`s
 * used by `partner_shares:list` above. This alone only proves "linked to
 * this Partner's own Sub-partners" -- the route separately checks
 * `partner.subPartnerVisibilityGrant` before admitting the caller, since the
 * grant is a business-rule condition this gate itself never sees.
 */
const SCOPE_SELF_ACCESS_ACTIONS: ReadonlySet<Action> = new Set([
  "partner_shares:list",
  "partner_shares:view_grant",
]);

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
 * List/scope-level authorization check (AD-1). Always re-reads the actor's
 * live role — never cached.
 *
 * `scopeOwnerIds` (Story 2.4) is an optional list of userIds legitimately
 * scoped-in for this specific request — e.g. the `userId`s of a Project's
 * *current* Partner Shares, for `"partner_shares:list"`. For actions in
 * `SCOPE_SELF_ACCESS_ACTIONS`, if `actorUserId` case-insensitively appears in
 * `scopeOwnerIds`, the check short-circuits to allowed — in addition to the
 * existing role-based `PERMISSIONS[action].has(actor.role)` check below, not
 * replacing it. Fully backward-compatible: every pre-Story-2.4 call site
 * omits the parameter and behaves exactly as before.
 */
export async function authorizeScope(
  actorUserId: string,
  action: Action,
  deps: AuthorizeDeps,
  scopeOwnerIds?: readonly string[],
): Promise<AuthorizeResult> {
  if (
    SCOPE_SELF_ACCESS_ACTIONS.has(action) &&
    scopeOwnerIds?.some((ownerId) => ownerId.toLowerCase() === actorUserId.toLowerCase())
  ) {
    return { allowed: true };
  }

  const actor = await deps.users.findUserById(actorUserId);

  if (!actor) {
    return { allowed: false };
  }

  return { allowed: PERMISSIONS[action].has(actor.role) };
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@niveshbook/core";
import type { Session } from "@niveshbook/types";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { SESSION_COOKIE_NAME } from "./session";

/**
 * Server-side session guard for the authenticated `(dashboard)` shell
 * (Story 2.1). Reads the live session the same way the root page does
 * (`getSession()` re-validates/renews on every call — AD-1) and redirects
 * to the login page ("/") when there's none — the dashboard shell never
 * renders for an unauthenticated request, matching the existing
 * route-handler 401 pattern's intent at the page-navigation layer.
 */
export async function requireSession(): Promise<Session> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    redirect("/");
  }

  return session;
}

/**
 * Gates the `(dashboard)` route group to `owner_admin` only (Story 2.1).
 * Every route currently behind this shell (Projects) is Owner/Admin-only at
 * the API layer too (`authorizeScope()`'s `projects:*` grants), so rendering
 * the sidebar's "Projects" link for any other authenticated role would be a
 * live link that 403s on click — EXPERIENCE.md forbids a visible-but-blocked
 * nav item. Redirects any other authenticated role to `/`, same destination
 * `requireSession()` uses for the no-session case, since there's no
 * role-scoped dashboard for them yet (that's Epic 5).
 *
 * Deliberately layered on top of `requireSession()` rather than folded into
 * it — `requireSession()` stays a pure "is there a live session" check with
 * no role lookup, matching its existing (and now unit-tested) contract.
 */
export async function requireOwnerAdminSession(): Promise<Session> {
  const session = await requireSession();
  const actor = await createUserPort().findUserById(session.userId);

  if (!actor || actor.role !== "owner_admin") {
    redirect("/");
  }

  return session;
}

/**
 * Gates the `(dashboard)` route group to `owner_admin` OR `partner` (Story
 * 5.5, FR36) -- mirrors `requireOwnerAdminSession()`'s exact shape, one role
 * wider. This is the first story where a non-Owner/Admin role reaches a
 * real page behind this shell: `partner`'s own scoped dashboard (`/home`)
 * plus the 2 already-self-access pages (Money History, Story 5.1; Adjust
 * Next Time, Story 5.3) become reachable via THIS shell for the first time
 * -- `layout.tsx`'s own `NAV_ITEMS` filtering (this story) is what keeps
 * every other item hidden for a `partner` session, not this guard.
 *
 * Deliberately still excludes `sub_partner` -- a later story's (5.6) own
 * job to widen the shell further, mirroring this story's own frozen
 * Boundaries ("No widening of the shell to `sub_partner`"). Redirects any
 * other role (or `sub_partner`) to `/`, same destination
 * `requireOwnerAdminSession()`/`requireSession()` both use, since there's
 * no role-scoped dashboard for them yet.
 *
 * `requireOwnerAdminSession()` itself is left completely untouched
 * (Open/Closed) -- this is a new sibling, not a widened version of it.
 */
export async function requireOwnerAdminOrPartnerSession(): Promise<Session> {
  const session = await requireSession();
  const actor = await createUserPort().findUserById(session.userId);

  if (!actor || (actor.role !== "owner_admin" && actor.role !== "partner")) {
    redirect("/");
  }

  return session;
}

/**
 * Gates the `(dashboard)` route group to `owner_admin`, `partner`, OR
 * `sub_partner` (Story 5.6, FR37) -- mirrors `requireOwnerAdminOrPartnerSession()`'s
 * exact shape, one role wider. This is the role `requireOwnerAdminOrPartnerSession()`'s
 * own doc comment already named as "a later story's (5.6) own job" -- a
 * Sub-partner's own scoped dashboard (`/home`) plus the same 2 already
 * self-access pages (Money History, Story 5.1; Adjust Next Time, Story 5.3)
 * become reachable via THIS shell for `sub_partner` too -- `layout.tsx`'s
 * own `NAV_ITEMS` filtering (this story) is what keeps every other item
 * hidden for a `sub_partner` session, not this guard.
 *
 * Redirects any other role to `/`, same destination every sibling guard
 * uses, since there's no role-scoped dashboard for them yet.
 *
 * `requireOwnerAdminSession()` and `requireOwnerAdminOrPartnerSession()` are
 * both left completely untouched (Open/Closed) -- this is a new sibling,
 * not a widened version of either.
 */
export async function requireOwnerAdminOrPartnerOrSubPartnerSession(): Promise<Session> {
  const session = await requireSession();
  const actor = await createUserPort().findUserById(session.userId);

  if (!actor || (actor.role !== "owner_admin" && actor.role !== "partner" && actor.role !== "sub_partner")) {
    redirect("/");
  }

  return session;
}

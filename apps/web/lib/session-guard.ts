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

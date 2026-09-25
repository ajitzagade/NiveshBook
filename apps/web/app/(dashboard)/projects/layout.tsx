import type { ReactNode } from "react";
import { requireOwnerAdminSession } from "@/lib/session-guard";

/**
 * Story 5.5 finding, documented in that story's Implementation Notes:
 * widening the `(dashboard)` layout's own gate to admit `partner`
 * (`requireOwnerAdminOrPartnerSession()`, this story's own change) removed
 * the ONLY protection every page under `/projects/**` previously had. None
 * of them (Projects list/new/edit, Partner Shares, Add Money, Withdraw
 * Money, Available Balance) call any guard of their own — they're all
 * `"use client"` components that only fetch from REST APIs already gated
 * Owner/Admin-only via `authorizeScope()`.
 *
 * Before Story 5.5, a Partner could never even reach this shell at all
 * (`requireOwnerAdminSession()` at the top-level layout redirected them to
 * `/` before any page rendered). After that story's widening, without this
 * nested layout, a Partner navigating directly to e.g. `/projects` would
 * see the full page shell (title, "New Project" button) with only an
 * empty/failed data fetch underneath — no real data leaks (the API still
 * 403s), but this violates Story 5.5's own frozen I/O matrix row 8 ("A
 * Partner navigates directly to a hidden page's URL ... Rejected ...
 * `403`/redirect (pre-existing, unchanged)").
 *
 * This nested layout closes that gap for the ENTIRE `/projects/**` subtree
 * in one place — covering all 5 owner_admin-only nav items whose real
 * pages live here (Projects, Partner Shares, Add Money, Withdraw Money,
 * and Available Balance all resolve to `/projects` or `/projects/[id]/...`)
 * — by reusing `requireOwnerAdminSession()` completely UNCHANGED (Open/Closed;
 * Story 5.5's own explicit constraint: that guard must stay byte-for-byte
 * unchanged), restoring the exact pre-existing "redirect to `/` before any
 * page content renders" behavior for any non-owner_admin role, Partner
 * included. `home`/`money-history`/`adjust-next-time` deliberately have no
 * equivalent nested layout — those 3 are exactly the pages Story 5.5 makes
 * genuinely reachable for `partner`.
 */
export default async function ProjectsLayout({ children }: { children: ReactNode }) {
  await requireOwnerAdminSession();
  return children;
}

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@niveshbook/ui";
import {
  Home,
  LayoutGrid,
  Percent,
  Plus,
  Minus,
  Wallet,
  RotateCcw,
  History,
  BarChart3,
  ShieldCheck,
} from "lucide-react";
import { createUserPort } from "@niveshbook/db";
import { requireOwnerAdminOrPartnerOrSubPartnerSession } from "@/lib/session-guard";
import { getClientConfig } from "@/lib/client-config";
import type { SidebarNavItem } from "./SidebarNav";
import { SidebarShell } from "./SidebarShell";

// Guards every route in this group with a live, owner_admin OR partner OR
// sub_partner session (via `requireOwnerAdminOrPartnerOrSubPartnerSession()`,
// Story 5.6) on every request — never statically cached.
export const dynamic = "force-dynamic";

const ICON_SIZE = 14;

/**
 * The fixed sidebar's 9 items, per NFR18 (`EXPERIENCE.md`'s Information
 * Architecture table) and `DESIGN.md`'s nav-badge mapping. All 9 render for
 * Owner/Admin — Owner/Admin is authorized for all of them (rendering isn't
 * the "unauthorized item" case EXPERIENCE.md forbids, that's about role,
 * not build-completeness).
 *
 * Each item's `roles` (Story 5.5, widened by Story 5.6) says which role(s)
 * may see it — `DashboardLayout` filters this array by the actor's resolved
 * role before ever passing it to `SidebarShell`. Only `home`/`moneyHistory`/
 * `adjustNextTime` admit `partner`/`sub_partner` (each already self-access at
 * the API layer — Story 5.1/5.3/5.5/5.6 respectively); every other item stays
 * `owner_admin`-only, since its underlying page/API is still Owner/Admin-only
 * (EXPERIENCE.md's "never a visible-but-blocked nav item" rule, unchanged).
 *
 * Partner Shares, Add Money, Withdraw Money, and Available Balance's own
 * screens are Project-scoped (`/projects/[id]/shares`,
 * `/projects/[id]/add-money`, `/projects/[id]/withdraw-money`,
 * `/projects/[id]/available-balance`). Their `href` below is only the
 * fallback for "no active Project chosen yet" -- `SidebarShell` (2026-09-25)
 * now owns an "active Project" concept (a Projects-list dropdown, plus
 * treating any `/projects/[id]/...` URL you're already on as that Project)
 * and rewrites these 4 items' `href` to point straight at it once one is
 * known, entirely client-side (never persisted server-side). `SidebarNav`
 * still highlights each correctly when you're actually on a Project's own
 * Shares/Add Money/Withdraw Money/Available Balance page, independent of
 * this link target. Adjust Next Time (Story 5.3) and Money History (Story
 * 5.1) are both deliberately NOT Project-scoped, so each links straight to
 * its own page instead. Reports still renders icon+label with no
 * destination (inert, not a dead link) until its story lands.
 */
const OWNER_ADMIN_ONLY = ["owner_admin"] as const;
const OWNER_ADMIN_OR_PARTNER_OR_SUB_PARTNER = ["owner_admin", "partner", "sub_partner"] as const;

const NAV_ITEMS: readonly SidebarNavItem[] = [
  {
    key: "home",
    label: "Home",
    icon: <Home size={ICON_SIZE} />,
    href: "/home",
    roles: OWNER_ADMIN_OR_PARTNER_OR_SUB_PARTNER,
  },
  {
    key: "projects",
    label: "Projects",
    icon: <LayoutGrid size={ICON_SIZE} />,
    href: "/projects",
    roles: OWNER_ADMIN_ONLY,
  },
  {
    key: "partnerShares",
    label: "Partner Shares",
    icon: <Percent size={ICON_SIZE} />,
    href: "/projects",
    roles: OWNER_ADMIN_ONLY,
  },
  {
    key: "addMoney",
    label: "Add Money",
    icon: <Plus size={ICON_SIZE} />,
    href: "/projects",
    roles: OWNER_ADMIN_ONLY,
  },
  {
    key: "withdrawMoney",
    label: "Withdraw Money",
    icon: <Minus size={ICON_SIZE} />,
    href: "/projects",
    roles: OWNER_ADMIN_ONLY,
  },
  {
    key: "availableBalance",
    label: "Available Balance",
    icon: <Wallet size={ICON_SIZE} />,
    href: "/projects",
    roles: OWNER_ADMIN_ONLY,
  },
  // Story 5.3 (FR33/FR34): activated -- mirrors Money History's identical
  // Story 5.1 rationale immediately below: not Project-scoped (spans every
  // Project a viewer is linked to), so it links straight to its own page
  // rather than to `/projects`. `SidebarNav.isActive` highlights it on that
  // exact route. Reachable via THIS shell only for Owner/Admin today
  // (`requireOwnerAdminSession()` below, unchanged) -- the API itself is
  // already correctly scoped for all three roles (spec-5-3's Decisions #3);
  // a Partner/Sub-partner's own reachable path to it is a later story's job.
  {
    key: "adjustNextTime",
    label: "Adjust Next Time",
    icon: <RotateCcw size={ICON_SIZE} />,
    href: "/adjust-next-time",
    roles: OWNER_ADMIN_OR_PARTNER_OR_SUB_PARTNER,
  },
  // Story 5.1 (FR31): activated -- unlike Partner Shares/Add Money/Withdraw
  // Money/Available Balance's own "no current Project to jump into yet"
  // rationale above, Money History is deliberately NOT Project-scoped (it
  // spans every Project a viewer is linked to), so it links straight to its
  // own page rather than to `/projects`. `SidebarNav.isActive` highlights it
  // on that exact route. Reachable via THIS shell only for Owner/Admin today
  // (`requireOwnerAdminSession()` below, unchanged) -- the API itself is
  // already correctly scoped for all three roles (spec-5-1's Decisions #1);
  // a Partner/Sub-partner's own reachable path to it is Story 5.4-5.6's job.
  {
    key: "moneyHistory",
    label: "Money History",
    icon: <History size={ICON_SIZE} />,
    href: "/money-history",
    roles: OWNER_ADMIN_OR_PARTNER_OR_SUB_PARTNER,
  },
  // Story 5.7 (FR38/FR39): activated -- widened from Owner/Admin-only
  // (inert, no `href`) to all three roles, mirroring Money History/Adjust
  // Next Time's identical "not Project-scoped, links straight to its own
  // page" rationale immediately above: Reports spans every Project a viewer
  // is linked to, and every report type's own permission scoping is now
  // enforced at the API layer (`GET /api/reports/[type]`'s `authorizeScope()`
  // call, `authorize.ts`'s 10 new `reports:*` actions) -- a role not granted
  // a given report type simply never sees that tile (`reports/page.tsx`),
  // matching EXPERIENCE.md's "never a visible-but-blocked nav item" rule
  // extended from nav items to report tiles.
  {
    key: "reports",
    label: "Reports",
    icon: <BarChart3 size={ICON_SIZE} />,
    href: "/reports",
    roles: OWNER_ADMIN_OR_PARTNER_OR_SUB_PARTNER,
  },
  // Story 5.9 (FR41/FR42): a genuinely NEW item -- no inert placeholder
  // existed before this story (unlike Reports, which had one since Epic 5's
  // shell was first widened). Owner/Admin-only (this story's Decision #3 --
  // `EXPERIENCE.md`'s IA table, and the precedent Stories 5.5/5.6 already set
  // by listing "Audit History" among items staying hidden for
  // `partner`/`sub_partner`). A transaction's own Partner/Sub-partner instead
  // gets a "View Audit History" action next to their own `money_added`/
  // `money_withdrawn` rows on the Money History page (`money-history/page.tsx`)
  // -- never this nav item, never this page. (Post-review fix, spec-5-9's
  // Spec Change Log: this action originally lived on the Add Money/Withdraw
  // Money pages, but that entire `/projects/**` subtree is Owner/Admin-only
  // at the layout level, `projects/layout.tsx`'s `requireOwnerAdminSession()`
  // -- unreachable by the very role this needed to serve. Money History is
  // reachable by all three roles, per its own `roles` entry above.)
  {
    key: "auditHistory",
    label: "Audit History",
    icon: <ShieldCheck size={ICON_SIZE} />,
    href: "/audit-history",
    roles: OWNER_ADMIN_ONLY,
  },
];

/**
 * The authenticated app shell (Story 2.1, widened by Story 5.5, widened
 * further by Story 5.6): fixed sidebar + content area. Every route under
 * `app/(dashboard)` renders behind `requireOwnerAdminOrPartnerOrSubPartnerSession()`
 * — an unauthenticated request, or one from any role other than
 * `owner_admin`/`partner`/`sub_partner`, never reaches a page in this group;
 * both are redirected to the login page first.
 *
 * A second, independent `findUserById()` call (Story 5.5) resolves the
 * actor's own role — mirroring this codebase's established "each layer
 * independently re-verifies" pattern (e.g. `money-trail/route.ts`'s own
 * identical double-read, spec-5-2's Implementation Notes) rather than
 * having `requireOwnerAdminOrPartnerOrSubPartnerSession()` hand back the role
 * alongside the `Session` it already returns (that guard's own contract
 * stays role-agnostic on its return type, matching `requireSession()`'s).
 * `NAV_ITEMS` is filtered against this resolved role before ever reaching
 * `SidebarShell` — a missing/unresolvable actor fails closed (redirects to
 * `/`) rather than silently defaulting to the broader Owner/Admin item set.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireOwnerAdminOrPartnerOrSubPartnerSession();
  const actor = await createUserPort().findUserById(session.userId);
  if (!actor) {
    redirect("/");
  }

  const { appName } = getClientConfig().branding;
  const visibleNavItems = NAV_ITEMS.filter((item) =>
    item.roles?.includes(actor.role as "owner_admin" | "partner" | "sub_partner"),
  );

  return (
    <div className="grid min-h-screen grid-cols-[236px_1fr] max-[860px]:grid-cols-1">
      <aside className="flex flex-col gap-5 border-r border-border bg-surface p-4 max-[860px]:border-b max-[860px]:border-r-0">
        <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
          <Logo />
          <span className="text-[15px] font-bold tracking-tight text-ink">{appName}</span>
        </div>
        <SidebarShell items={visibleNavItems} />
      </aside>
      <main className="max-w-[1020px] px-9 py-7 pb-16 max-[860px]:px-4 max-[860px]:py-5">
        {children}
      </main>
    </div>
  );
}

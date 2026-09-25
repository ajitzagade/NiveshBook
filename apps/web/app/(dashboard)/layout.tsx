import type { ReactNode } from "react";
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
} from "lucide-react";
import { requireOwnerAdminSession } from "@/lib/session-guard";
import { getClientConfig } from "@/lib/client-config";
import { SidebarNav, type SidebarNavItem } from "./SidebarNav";

// Guards every route in this group with a live, owner_admin session (via
// `requireOwnerAdminSession()`) on every request — never statically cached.
export const dynamic = "force-dynamic";

const ICON_SIZE = 14;

/**
 * The fixed sidebar's 9 items, per NFR18 (`EXPERIENCE.md`'s Information
 * Architecture table) and `DESIGN.md`'s nav-badge mapping. All 9 render
 * (Owner/Admin is authorized for all of them — rendering isn't the
 * "unauthorized item" case EXPERIENCE.md forbids, that's about role, not
 * build-completeness).
 *
 * Partner Shares, Add Money, Withdraw Money, and Available Balance's own
 * screens are Project-scoped (`/projects/[id]/shares`,
 * `/projects/[id]/add-money`, `/projects/[id]/withdraw-money`,
 * `/projects/[id]/available-balance`) and each already works, but there's no
 * "current project" concept yet for the sidebar to jump straight into one --
 * so all four link to the Projects list (2026-09-24 decision, extended
 * 2026-09-25 to Withdraw Money, then again to Available Balance once it was
 * reachable/working, ahead of Epic 4's formal "done" -- edit/cancel
 * withdrawal is still backlog, but that doesn't block linking the part that
 * already works) rather than staying permanently inert. `SidebarNav` still
 * highlights each correctly when you're actually on a Project's own
 * Shares/Add Money/Withdraw Money/Available Balance page, independent of
 * this link target. The rest render icon+label with no destination (inert,
 * not a dead link) until their stories land.
 */
const NAV_ITEMS: readonly SidebarNavItem[] = [
  { key: "home", label: "Home", icon: <Home size={ICON_SIZE} />, href: "/home" },
  { key: "projects", label: "Projects", icon: <LayoutGrid size={ICON_SIZE} />, href: "/projects" },
  { key: "partnerShares", label: "Partner Shares", icon: <Percent size={ICON_SIZE} />, href: "/projects" },
  { key: "addMoney", label: "Add Money", icon: <Plus size={ICON_SIZE} />, href: "/projects" },
  { key: "withdrawMoney", label: "Withdraw Money", icon: <Minus size={ICON_SIZE} />, href: "/projects" },
  { key: "availableBalance", label: "Available Balance", icon: <Wallet size={ICON_SIZE} />, href: "/projects" },
  { key: "adjustNextTime", label: "Adjust Next Time", icon: <RotateCcw size={ICON_SIZE} /> },
  { key: "moneyHistory", label: "Money History", icon: <History size={ICON_SIZE} /> },
  { key: "reports", label: "Reports", icon: <BarChart3 size={ICON_SIZE} /> },
];

/**
 * The authenticated app shell (Story 2.1): fixed sidebar + content area.
 * Every route under `app/(dashboard)` renders behind `requireOwnerAdminSession()`
 * — an unauthenticated request, or one from any role other than
 * `owner_admin`, never reaches a page in this group; both are redirected to
 * the login page first. Every `projects:*` action (the only thing currently
 * behind this shell) is Owner/Admin-only, so this keeps the sidebar's
 * "Projects" link from ever being shown to a role that would 403 on it.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireOwnerAdminSession();
  const { appName } = getClientConfig().branding;

  return (
    <div className="grid min-h-screen grid-cols-[236px_1fr] max-[860px]:grid-cols-1">
      <aside className="flex flex-col gap-5 border-r border-border bg-surface p-4 max-[860px]:border-b max-[860px]:border-r-0">
        <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
          <Logo />
          <span className="text-[15px] font-bold tracking-tight text-ink">{appName}</span>
        </div>
        <SidebarNav items={NAV_ITEMS} />
      </aside>
      <main className="max-w-[1020px] px-9 py-7 pb-16 max-[860px]:px-4 max-[860px]:py-5">
        {children}
      </main>
    </div>
  );
}

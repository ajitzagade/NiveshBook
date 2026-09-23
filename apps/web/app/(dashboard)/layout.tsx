import type { ReactNode } from "react";
import { NavItem, NAV_BADGE_COLOR } from "@niveshbook/ui";
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

// Guards every route in this group with a live, owner_admin session (via
// `requireOwnerAdminSession()`) on every request — never statically cached.
export const dynamic = "force-dynamic";

const ICON_SIZE = 12;

/**
 * The fixed sidebar's 9 items, per NFR18 (`EXPERIENCE.md`'s Information
 * Architecture table) and `DESIGN.md`'s nav-badge mapping. This story
 * builds the full shell: all 9 render (Owner/Admin is authorized for all of
 * them — rendering isn't the "unauthorized item" case EXPERIENCE.md
 * forbids, that's about role, not build-completeness). Only Home and
 * Projects get a real `href` — the rest render icon+label with no
 * destination (inert, not a dead link) until their epics land.
 */
const NAV_ITEMS: ReadonlyArray<{
  key: keyof typeof NAV_BADGE_COLOR;
  label: string;
  icon: ReactNode;
  href?: string;
}> = [
  { key: "home", label: "Home", icon: <Home size={ICON_SIZE} />, href: "/home" },
  { key: "projects", label: "Projects", icon: <LayoutGrid size={ICON_SIZE} />, href: "/projects" },
  { key: "partnerShares", label: "Partner Shares", icon: <Percent size={ICON_SIZE} /> },
  { key: "addMoney", label: "Add Money", icon: <Plus size={ICON_SIZE} /> },
  { key: "withdrawMoney", label: "Withdraw Money", icon: <Minus size={ICON_SIZE} /> },
  { key: "availableBalance", label: "Available Balance", icon: <Wallet size={ICON_SIZE} /> },
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
      <aside className="flex flex-col gap-5 border-r border-border bg-surface p-4">
        <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
          <span className="text-[15px] font-bold tracking-tight text-ink">{appName}</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.key}
              icon={item.icon}
              badgeColor={NAV_BADGE_COLOR[item.key]}
              label={item.label}
              href={item.href}
            />
          ))}
        </nav>
      </aside>
      <main className="max-w-[1020px] p-7 pb-16 max-[860px]:p-4">{children}</main>
    </div>
  );
}

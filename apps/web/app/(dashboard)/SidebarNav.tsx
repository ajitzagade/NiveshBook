"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NavItem, NAV_BADGE_COLOR } from "@niveshbook/ui";

export interface SidebarNavItem {
  key: keyof typeof NAV_BADGE_COLOR;
  label: string;
  icon: ReactNode;
  href?: string;
}

/**
 * Matches a nav item to the current route independently of the `href` it
 * links to. Partner Shares and Add Money currently link to `/projects`
 * (there's no "current project" concept to jump straight into yet), but
 * should still highlight when the user is actually on that Project's own
 * `/projects/[id]/shares` or `/projects/[id]/add-money` page -- reflecting
 * where you conceptually are, not just what the sidebar's own link points
 * to. Projects covers its list, its "new" form, and a Project's "edit" page.
 */
function isActive(key: SidebarNavItem["key"], pathname: string): boolean {
  switch (key) {
    case "home":
      return pathname === "/home";
    case "projects":
      return (
        pathname === "/projects" ||
        pathname === "/projects/new" ||
        /^\/projects\/[^/]+\/edit$/.test(pathname)
      );
    case "partnerShares":
      return /^\/projects\/[^/]+\/shares$/.test(pathname);
    case "addMoney":
      return /^\/projects\/[^/]+\/add-money$/.test(pathname);
    case "withdrawMoney":
      return /^\/projects\/[^/]+\/withdraw-money$/.test(pathname);
    default:
      return false;
  }
}

export function SidebarNav({ items }: { items: readonly SidebarNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavItem
          key={item.key}
          icon={item.icon}
          badgeColor={NAV_BADGE_COLOR[item.key]}
          label={item.label}
          href={item.href}
          active={isActive(item.key, pathname)}
        />
      ))}
    </nav>
  );
}

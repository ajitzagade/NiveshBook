import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Badge colors per DESIGN.md -- only 5 of 9 nav items are semantically
 * colored, the rest are neutral slate. Exported so apps/web's nav list stays
 * in sync with the one source of truth instead of re-guessing colors.
 */
export const NAV_BADGE_COLOR = {
  home: "var(--color-nav-neutral)",
  projects: "var(--color-accent)",
  partnerShares: "var(--color-info)",
  addMoney: "var(--color-success)",
  withdrawMoney: "var(--color-danger)",
  availableBalance: "var(--color-violet)",
  adjustNextTime: "var(--color-nav-neutral)",
  moneyHistory: "var(--color-nav-neutral)",
  reports: "var(--color-nav-neutral)",
} as const;

export interface NavItemProps {
  icon: ReactNode;
  badgeColor: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
  href?: string;
}

/**
 * A nav item must only ever be rendered for a role/scope that's actually
 * authorized (FR-7/FR-8, AD-1) -- never rendered-but-disabled. That
 * filtering happens in the consuming app, driven by server-verified role,
 * not here.
 */
export function NavItem({ icon, badgeColor, label, active, onClick, href }: NavItemProps) {
  const content = (
    <>
      <span
        className="flex shrink-0 items-center justify-center rounded-el text-white"
        style={{ background: badgeColor, width: 22, height: 22 }}
      >
        {icon}
      </span>
      {label}
    </>
  );

  const className = cn(
    "flex w-full items-center gap-3 rounded-el px-[9px] py-3 text-left text-[13.6px] font-semibold",
    active ? "bg-accent-soft text-accent-strong" : "text-ink hover:bg-surface-alt",
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }

  // No `href`/`onClick` — this item has no destination yet (its epic
  // hasn't landed). Render it visibly inert rather than indistinguishable
  // from a working control: unfocusable, marked `aria-disabled`, and muted.
  if (!onClick) {
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-disabled="true"
        className={cn(className, "cursor-default text-ink-soft/50 hover:bg-transparent")}
      >
        {content}
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

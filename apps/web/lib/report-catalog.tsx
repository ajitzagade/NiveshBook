import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  Building2,
  CreditCard,
  History,
  Minus,
  Plus,
  RotateCcw,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";

/**
 * Story 5.7 (FR38/FR39, Epic 5): the 10 report types' shared presentation
 * metadata -- one place both `reports/page.tsx` (the tile grid, a server
 * component) and `reports/[type]/page.tsx` (the viewer, `"use client"`) read
 * from, so the name/description/icon/color a report is known by never drifts
 * between the two screens. Plain data + `lucide-react` JSX only (no
 * `@niveshbook/core` runtime import) -- safe for both a server and a client
 * component to import.
 *
 * `roles` mirrors `authorize.ts`'s own `PERMISSIONS` grants for each
 * `reports:*` action -- a separately-maintained local copy, not a live call
 * into `authorizeScope()`, mirroring `(dashboard)/layout.tsx`'s own
 * `NAV_ITEMS.roles` field's identical established convention (that file's
 * own `moneyHistory`/`adjustNextTime` items hardcode their role list rather
 * than querying `authorize.ts` at render time too). The real, enforced gate
 * is always `GET /api/reports/[type]`'s own `authorizeScope()` call -- this
 * list only controls which tile/page a role is offered, never what data it
 * can actually reach (EXPERIENCE.md's "never a visible-but-blocked nav item"
 * rule, extended from nav items to report tiles, this story's Decisions #9).
 *
 * Icon colors (implementer judgment call, this story's Code Map explicitly
 * leaves this open -- see this story's Implementation Notes for the full
 * rationale): `"adjustment"` is amber (`#E8A317`), DESIGN.md's own frozen,
 * explicitly-named choice ("the Adjustment Report tile"). The other 9 are
 * picked from the same existing token palette (`packages/ui/src/styles/
 * tokens.css`) -- reusing a nav badge's own color where a direct thematic
 * match exists (Money Added -> success, matching Add Money's nav badge;
 * Withdrawal -> danger, matching Withdraw Money's; Available Balance ->
 * violet, matching Available Balance's; Money History -> the neutral slate
 * already used for its own nav item). Only 6 non-neutral hues plus neutral
 * exist in this palette, and there are 10 tiles -- a few reuses are
 * unavoidable and are documented per-row below, not attempts at 10 unique
 * colors.
 */
export type ReportSlug =
  | "project-money"
  | "partner"
  | "sub-partner"
  | "money-added"
  | "withdrawal"
  | "available-balance"
  | "money-movement"
  | "payment-mode"
  | "adjustment"
  | "money-history";

export type ReportRole = "owner_admin" | "partner" | "sub_partner";

export interface ReportDefinition {
  slug: ReportSlug;
  name: string;
  description: string;
  icon: ReactNode;
  iconColor: string;
  roles: readonly ReportRole[];
  /** The 6 `MoneyHistoryEntry`-based types (Decision #3) support `dateFrom`/`dateTo`; the 4 aggregate types (Decision #4) don't -- a documented scope decision (Decision #8), not an oversight. */
  supportsDateFilter: boolean;
}

const OWNER_ADMIN_ONLY: readonly ReportRole[] = ["owner_admin"];
const ALL_THREE_ROLES: readonly ReportRole[] = ["owner_admin", "partner", "sub_partner"];
const ICON_SIZE = 14;

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    slug: "project-money",
    name: "Project Money",
    description: "Every Project's Money Added, Withdrawn, and Available Balance, one row per Project.",
    icon: <Building2 size={ICON_SIZE} />,
    iconColor: "#2F6FED",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: false,
  },
  {
    slug: "partner",
    name: "Partner",
    description: "Every current Partner Share's own Money Added, Withdrawn, and Available Balance.",
    icon: <Users size={ICON_SIZE} />,
    iconColor: "#0EA5A5",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: false,
  },
  {
    slug: "sub-partner",
    name: "Sub-partner",
    description: "Every current Sub-partner Share's own money, tracked separately from their Partner.",
    icon: <UserRound size={ICON_SIZE} />,
    iconColor: "#475569",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: false,
  },
  {
    slug: "money-added",
    name: "Money Added",
    description: "Every Add Money payment recorded, in one filterable list.",
    icon: <Plus size={ICON_SIZE} />,
    iconColor: "#17A566",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: true,
  },
  {
    slug: "withdrawal",
    name: "Withdrawal",
    description: "Every Withdraw Money payment recorded, in one filterable list.",
    icon: <Minus size={ICON_SIZE} />,
    iconColor: "#E5484D",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: true,
  },
  {
    slug: "available-balance",
    name: "Available Balance",
    description: "Every current Available Balance, Project by Project.",
    icon: <Wallet size={ICON_SIZE} />,
    iconColor: "#8B5CF6",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: false,
  },
  {
    slug: "money-movement",
    name: "Money Movement",
    description: "Money moved between Projects -- Owner/Admin only.",
    icon: <ArrowLeftRight size={ICON_SIZE} />,
    iconColor: "#2F6FED",
    roles: OWNER_ADMIN_ONLY,
    supportsDateFilter: true,
  },
  {
    slug: "payment-mode",
    name: "Payment Mode",
    description: "Money Added and Withdrawn, grouped by how it was paid.",
    icon: <CreditCard size={ICON_SIZE} />,
    iconColor: "#475569",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: true,
  },
  {
    slug: "adjustment",
    name: "Adjustment",
    description: "Every recorded Adjust Next Time netting.",
    icon: <RotateCcw size={ICON_SIZE} />,
    iconColor: "#E8A317",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: true,
  },
  {
    slug: "money-history",
    name: "Money History",
    description: "The full, unified Money History feed -- every event, unfiltered by type.",
    icon: <History size={ICON_SIZE} />,
    iconColor: "#475569",
    roles: ALL_THREE_ROLES,
    supportsDateFilter: true,
  },
];

export function getReportDefinition(slug: string): ReportDefinition | undefined {
  return REPORT_DEFINITIONS.find((definition) => definition.slug === slug);
}

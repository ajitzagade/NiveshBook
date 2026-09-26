import Link from "next/link";
import { redirect } from "next/navigation";
import { createUserPort } from "@niveshbook/db";
import { PageHeader, ReportTile } from "@niveshbook/ui";
import { requireSession } from "@/lib/session-guard";
import { REPORT_DEFINITIONS, type ReportRole } from "@/lib/report-catalog";

// This page's own tile set depends on the actor's live role -- never
// statically cached (mirrors every other `(dashboard)` page's identical
// `force-dynamic` convention).
export const dynamic = "force-dynamic";

/**
 * Reports tile grid (Story 5.7, FR38/FR39) -- one `ReportTile` per report
 * type the actor's role is granted (`REPORT_DEFINITIONS`'s own `roles`
 * field, mirroring `authorize.ts`'s `reports:*` grants), each wrapped in a
 * `<Link>` to `/reports/[type]` (Decision #10 -- `ReportTile` itself is
 * reused completely unchanged, it has no `href`/`onClick` of its own).
 * `EXPERIENCE.md`'s "never a visible-but-blocked nav item" rule extended to
 * report tiles (Decision #6/#9): `reports:money_movement` is `owner_admin`-
 * only, so the Money Movement tile simply never appears in this array for
 * `partner`/`sub_partner` -- not rendered-then-hidden, not rendered
 * disabled.
 *
 * Resolves the actor's own role via `requireSession()` +
 * `createUserPort().findUserById()`, mirroring `home/page.tsx`'s/
 * `layout.tsx`'s own identical "each layer independently re-verifies"
 * pattern -- purely to pick which tiles to offer, not to gate (the
 * `(dashboard)` layout's own `requireOwnerAdminOrPartnerOrSubPartnerSession()`
 * already did that). A null/unresolvable actor, or any role that's neither
 * `owner_admin`, `partner`, nor `sub_partner`, redirects to `/` defensively.
 */
export default async function ReportsPage() {
  const session = await requireSession();
  const actor = await createUserPort().findUserById(session.userId);

  if (!actor || (actor.role !== "owner_admin" && actor.role !== "partner" && actor.role !== "sub_partner")) {
    redirect("/");
  }

  // Cast, not narrowed -- mirrors `layout.tsx`'s own identical
  // `actor.role as "owner_admin" | "partner" | "sub_partner"` precedent
  // (this codebase's established convention here): the guard above already
  // redirected away every other role, so this is safe, not a widening.
  const visibleReports = REPORT_DEFINITIONS.filter((report) => report.roles.includes(actor.role as ReportRole));

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Permission-scoped reports — each one only ever shows what you're allowed to see."
      />

      {/*
        spec-mobile-responsive-phase1-nav-foundation (Decision #3): this
        grid already collapsed to 1 column at 760px (below `home/page.tsx`'s
        own 2-column floor) -- `max-[480px]:grid-cols-1` is added anyway for
        an explicit, breakpoint-independent guarantee (matches `home/page.tsx`'s
        3 stat grids byte-for-byte), rather than relying on it being an
        incidental consequence of the 760px rule above.
      */}
      <div className="grid grid-cols-3 gap-3.5 max-[860px]:grid-cols-2 max-[760px]:grid-cols-1 max-[480px]:grid-cols-1">
        {visibleReports.map((report) => (
          <Link key={report.slug} href={`/reports/${report.slug}`} className="no-underline">
            <ReportTile
              icon={report.icon}
              iconColor={report.iconColor}
              name={report.name}
              description={report.description}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

import { LayoutGrid, Users } from "lucide-react";
import { redirect } from "next/navigation";
import {
  assembleOwnerAdminDashboard,
  assemblePartnerDashboard,
  assembleSubPartnerDashboard,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  type PartnerOverviewRow,
} from "@niveshbook/core";
import {
  createAvailableBalancePort,
  createInvestmentAdjustmentPort,
  createInvestmentTransactionPort,
  createPartnerSharePort,
  createProjectPort,
  createSubPartnerSharePort,
  createUserPort,
  createWithdrawalAdjustmentPort,
  createWithdrawalTransactionPort,
} from "@niveshbook/db";
import {
  AdjustPersonCard,
  Amount,
  Card,
  EmptyState,
  PageHeader,
  ShareList,
  ShareRow,
  StatCard,
} from "@niveshbook/ui";
import { requireSession } from "@/lib/session-guard";
import { LogoutButton } from "../../LogoutButton";

/**
 * Postgres's `numeric(7,4)` column always round-trips at its full declared
 * scale (a stored `"33.33"` reads back as `"33.3300"` -- exact, no
 * precision lost, just padded). Trims trailing fractional zeros for
 * display only, via plain string manipulation (no `parseFloat`/`Number()`)
 * -- the stored value itself is untouched. Duplicated locally rather than
 * shared, mirroring `apps/web`'s own established per-module local-helper
 * convention for this exact function (`shares/page.tsx`, `add-money/page.tsx`,
 * `withdraw-money/page.tsx` each already have their own copy).
 *
 * Exported for `page.test.tsx`'s own direct unit coverage (review finding,
 * 2026-09-25: the Partner Dashboard's "My Share %" -- one of the frozen
 * AC's 9 named data points -- previously had zero assertions on its actual
 * rendered/formatted output, only on unrelated `ShareRow` props; mirrors
 * `PartnerOverviewCard`'s identical "exported for test" precedent already
 * in this file) -- not otherwise used outside this module.
 */
export function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

// This page's own data depends on every Project's live money state --
// never statically cached (mirrors every other `(dashboard)` page's
// identical `force-dynamic` convention).
export const dynamic = "force-dynamic";

/**
 * A partner-wise overview row's own `resolution` slot content (Story 5.4's
 * Code Map left this to implementer judgment) -- "Net Position"
 * (`row.netPosition`), the per-Partner analog of the headline Total Project
 * Money stat card one row down, rather than the three `lines` values
 * repeated in a different shape -- see this story's Implementation Notes.
 * Review finding (2026-09-25): the clamp-to-`"0"` calculation itself now
 * lives in `assembleOwnerAdminDashboard()` (`packages/core`), covered by
 * that module's own pure-function tests -- this page only ever reads the
 * already-computed `row.netPosition`, never recomputes it.
 */
/** Exported for `page.test.tsx`'s own tree-walking assertions (mirrors `app/page.test.tsx`'s identical "find the child component, assert its props" pattern) -- not otherwise used outside this module. */
export function PartnerOverviewCard({ row }: { row: PartnerOverviewRow }) {
  return (
    <AdjustPersonCard
      name={`${row.name} — ${row.projectName}`}
      lines={[
        { label: "Invested", value: <Amount value={row.invested} size="sm" /> },
        { label: "Withdrawn", value: <Amount value={row.withdrawn} size="sm" /> },
        { label: "Available Balance", value: <Amount value={row.availableBalance} size="sm" /> },
      ]}
      resolution={
        <>
          <span className="text-ink-soft">Net Position</span>
          <Amount value={row.netPosition} size="sm" />
        </>
      }
    />
  );
}

/**
 * The Partner Dashboard's own "My Projects" / "My Sub-partners" row `input`
 * content (Story 5.5) -- a plain JSX-returning function, not a component,
 * so every list row still renders `ShareRow` (`packages/ui`) DIRECTLY,
 * rather than through an intermediate wrapper component -- `ShareRow`'s
 * `action` slot is never used here (unlike `shares/page.tsx`'s own
 * Edit/Sub-partners buttons; this page has no edit affordance, matching
 * this story's Boundaries: no new `authorize.ts` action).
 */
function sharePercentBadge(sharePercent: string) {
  return (
    <span className="justify-self-end font-mono text-[13.4px] tabular-nums">
      {formatSharePercent(sharePercent)}%
    </span>
  );
}

/**
 * Partner Dashboard (Story 5.5, FR36) -- a Partner's own scoped view: My
 * Projects (per-Project Share %), 6 aggregate money totals across all of
 * their own Projects, and My Sub-partners. Mirrors the Owner/Admin
 * Dashboard's own server-component shape one level down (every port
 * constructed and read directly, `Promise.all`, no client-side fetch
 * helper, no new `authorize.ts` action -- the page-level role gate in
 * `DashboardHomePage` below, plus `layout.tsx`'s own guard, is what protects
 * this data).
 *
 * Renders exactly the 9 data points this story's frozen AC names (My
 * Projects, My Share % -- folded into the same "My Projects" list per row;
 * Money Added, Money Withdrawn, Available Balance, Pending, Extra Paid,
 * Withdrawal Keep for Later; My Sub-partners) -- `assemblePartnerDashboard()`
 * also computes `totalExtraTaken` (AD-4 completeness, mirroring
 * `totalKeepForLater`'s own three-way `adjustmentType` split), but that
 * figure isn't one of the AC's 9 named data points, so it's deliberately
 * not rendered here (see this story's Implementation Notes).
 */
async function PartnerDashboard({ actorUserId }: { actorUserId: string }) {
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const availableBalancePort = createAvailableBalancePort();
  const investmentAdjustmentPort = createInvestmentAdjustmentPort();
  const withdrawalAdjustmentPort = createWithdrawalAdjustmentPort();
  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const projectPort = createProjectPort();

  const [
    investmentTransactions,
    withdrawalTransactions,
    availableBalances,
    investmentAdjustments,
    withdrawalAdjustments,
    currentPartnerShares,
    currentSubPartnerShares,
    projects,
  ] = await Promise.all([
    investmentTransactionPort.listAll(),
    withdrawalTransactionPort.listAll(),
    availableBalancePort.listAll(),
    investmentAdjustmentPort.listAll(),
    withdrawalAdjustmentPort.listAll(),
    listAllCurrentPartnerShares({ partnerShares: partnerSharePort }),
    listAllCurrentSubPartnerShares({ subPartnerShares: subPartnerSharePort }),
    projectPort.listProjects(),
  ]);

  const projectNamesById = Object.fromEntries(projects.map((project) => [project.id, project.name]));

  const summary = assemblePartnerDashboard(actorUserId, {
    investmentTransactions,
    withdrawalTransactions,
    availableBalances,
    investmentAdjustments,
    withdrawalAdjustments,
    currentPartnerShares,
    currentSubPartnerShares,
    projectNamesById,
  });

  return (
    <div>
      <PageHeader
        title="Home"
        description="Your own Projects, Share %, and money — scoped to you only."
        action={<LogoutButton />}
      />

      <div className="mb-5 grid grid-cols-3 gap-3 max-[760px]:grid-cols-2">
        <StatCard label="Money Added" value={summary.totalMoneyAdded} format="money" />
        <StatCard label="Money Withdrawn" value={summary.totalMoneyWithdrawn} format="money" />
        <StatCard label="Available Balance" value={summary.totalAvailableBalance} format="money" tone="success" />
        <StatCard label="Pending" value={summary.totalPending} format="money" />
        <StatCard label="Extra Paid" value={summary.totalExtraPaid} format="money" />
        <StatCard label="Withdrawal Keep for Later" value={summary.totalKeepForLater} format="money" />
      </div>

      <Card className="mb-5">
        <h2 className="mb-3.5 text-[15px] font-bold">My Projects</h2>
        {summary.myProjects.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid size={22} />}
            title="Not linked to any Project yet"
            description="Once an Owner/Admin links you to a Project's Partner Share, it'll show up here."
          />
        ) : (
          <ShareList>
            {summary.myProjects.map((row) => (
              <ShareRow key={row.partnerId} name={row.projectName} input={sharePercentBadge(row.sharePercent)} />
            ))}
          </ShareList>
        )}
      </Card>

      <Card>
        <h2 className="mb-3.5 text-[15px] font-bold">My Sub-partners</h2>
        {summary.mySubPartners.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title="No Sub-partners yet"
            description="Sub-partners you add under your own Partner Share will show up here."
          />
        ) : (
          <ShareList>
            {summary.mySubPartners.map((row) => (
              <ShareRow
                key={row.subPartnerId}
                name={`${row.name} — ${row.projectName}`}
                input={sharePercentBadge(row.sharePercent)}
              />
            ))}
          </ShareList>
        )}
      </Card>
    </div>
  );
}

/**
 * Sub-partner Dashboard (Story 5.6, FR37) -- a Sub-partner's own scoped
 * view: My Projects (per-Project Share %) and 6 aggregate money totals
 * across all of their own Projects. Mirrors `PartnerDashboard`'s exact
 * shape one role over -- no `partnerSharePort` (this dashboard has no
 * reason to touch the Partner Shares table at all, this story's frozen
 * Decisions #7), and no "My Sub-partners" section (that category doesn't
 * exist for this role, Decisions #3): a Sub-partner has no sub-partners of
 * their own, so this isn't a data gap to work around with an `EmptyState`,
 * it's a section that structurally doesn't render.
 *
 * Renders exactly the 8 data points this story's frozen AC/I-O matrix names
 * (My Projects, My Share % -- folded into the same "My Projects" list per
 * row; Money Added, Money Withdrawn, Available Balance, Pending, Extra
 * Paid, Withdrawal Keep for Later) -- `assembleSubPartnerDashboard()` also
 * computes `totalExtraTaken` (AD-4 completeness, mirroring
 * `totalKeepForLater`'s own three-way `adjustmentType` split), but that
 * figure isn't one of the named data points, so it's deliberately not
 * rendered here, mirroring `PartnerDashboard`'s own identical precedent.
 */
async function SubPartnerDashboard({ actorUserId }: { actorUserId: string }) {
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const availableBalancePort = createAvailableBalancePort();
  const investmentAdjustmentPort = createInvestmentAdjustmentPort();
  const withdrawalAdjustmentPort = createWithdrawalAdjustmentPort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const projectPort = createProjectPort();

  const [
    investmentTransactions,
    withdrawalTransactions,
    availableBalances,
    investmentAdjustments,
    withdrawalAdjustments,
    currentSubPartnerShares,
    projects,
  ] = await Promise.all([
    investmentTransactionPort.listAll(),
    withdrawalTransactionPort.listAll(),
    availableBalancePort.listAll(),
    investmentAdjustmentPort.listAll(),
    withdrawalAdjustmentPort.listAll(),
    listAllCurrentSubPartnerShares({ subPartnerShares: subPartnerSharePort }),
    projectPort.listProjects(),
  ]);

  const projectNamesById = Object.fromEntries(projects.map((project) => [project.id, project.name]));

  const summary = assembleSubPartnerDashboard(actorUserId, {
    investmentTransactions,
    withdrawalTransactions,
    availableBalances,
    investmentAdjustments,
    withdrawalAdjustments,
    currentSubPartnerShares,
    projectNamesById,
  });

  return (
    <div>
      <PageHeader
        title="Home"
        description="Your own Projects, Share %, and money — scoped to you only."
        action={<LogoutButton />}
      />

      <div className="mb-5 grid grid-cols-3 gap-3 max-[760px]:grid-cols-2">
        <StatCard label="Money Added" value={summary.totalMoneyAdded} format="money" />
        <StatCard label="Money Withdrawn" value={summary.totalMoneyWithdrawn} format="money" />
        <StatCard label="Available Balance" value={summary.totalAvailableBalance} format="money" tone="success" />
        <StatCard label="Pending" value={summary.totalPending} format="money" />
        <StatCard label="Extra Paid" value={summary.totalExtraPaid} format="money" />
        <StatCard label="Withdrawal Keep for Later" value={summary.totalKeepForLater} format="money" />
      </div>

      <Card>
        <h2 className="mb-3.5 text-[15px] font-bold">My Projects</h2>
        {summary.myProjects.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid size={22} />}
            title="Not linked to any Project yet"
            description="Once a Partner adds you as a Sub-partner on a Project, it'll show up here."
          />
        ) : (
          <ShareList>
            {summary.myProjects.map((row) => (
              <ShareRow key={row.subPartnerId} name={row.projectName} input={sharePercentBadge(row.sharePercent)} />
            ))}
          </ShareList>
        )}
      </Card>
    </div>
  );
}

/**
 * Owner/Admin Dashboard (Story 5.4, FR35) -- replaces the Epic 5 placeholder.
 * A server component behind the `(dashboard)` layout's already-live
 * `requireOwnerAdminOrPartnerOrSubPartnerSession()` gate (widened by Story
 * 5.5, widened further by Story 5.6; this story's own Decisions #3): no new
 * `authorize.ts` action, no new API
 * route -- every port is constructed and read directly, server-side,
 * mirroring `apps/web/app/page.tsx`'s own "async server component, ports
 * constructed inline, data fetched via `Promise.all`, no client-side fetch
 * helper" precedent (there is no true server-component precedent left
 * inside `(dashboard)/**` itself -- every other page there is `"use client"`
 * against a REST API, a shape this story's Decisions #3 explicitly opts
 * out of).
 *
 * Fetches every `listAll()` source once (`investmentTransactions`/
 * `withdrawalTransactions`/`availableBalances`, plus current Partner/
 * Sub-partner Shares and every Project's name), hands it all to
 * `assembleOwnerAdminDashboard()` (pure, `packages/core`) in a single pass,
 * then renders: a 4-up `StatCard` row (Total Project Money, Total Added,
 * Total Withdrawn, Available Balance -- `WalletHero` is never used here,
 * this story's Decisions #5) followed by the partner-wise overview as one
 * `AdjustPersonCard` per current Partner Share, or `EmptyState` when there
 * are none.
 *
 * Role branching (Story 5.5, widened by Story 5.6): resolves the actor's
 * own role via `requireSession()` + `createUserPort().findUserById()` --
 * mirroring `layout.tsx`'s own new resolution one layer up (this codebase's
 * established "each layer independently re-verifies" pattern) -- purely to
 * pick a render branch, not to gate (the `(dashboard)` layout's own
 * `requireOwnerAdminOrPartnerOrSubPartnerSession()` already did that).
 * `partner` renders `PartnerDashboard`; `sub_partner` renders
 * `SubPartnerDashboard` (Story 5.6); every other resolvable role falls
 * through to this SAME Owner/Admin rendering, completely unchanged from
 * Story 5.4 -- byte-for-byte identical behavior for that role. A
 * null/unresolvable actor, or any role that's neither `owner_admin`,
 * `partner`, nor `sub_partner` (shouldn't be reachable -- the layout's own
 * guard already excludes it), redirects to `/` defensively rather than
 * silently rendering the wrong dashboard.
 */
export default async function DashboardHomePage() {
  const session = await requireSession();
  const actor = await createUserPort().findUserById(session.userId);

  if (actor?.role === "partner") {
    // Awaited and returned directly (not `<PartnerDashboard .../>`) --
    // `PartnerDashboard` is itself an async function; returning an
    // un-invoked element here would defer its execution to React's real
    // render pass (fine in production, but this codebase's own test
    // convention calls page functions directly and walks the RESOLVED
    // tree, mirroring `DashboardHomePage()`'s own "await, then inspect"
    // shape -- an unexecuted nested async component would be structurally
    // invisible to that approach).
    return await PartnerDashboard({ actorUserId: session.userId });
  }
  if (actor?.role === "sub_partner") {
    // Same "await, return the resolved tree" requirement as `PartnerDashboard`
    // above (Story 5.6, mirrors that story's own test-harness gotcha).
    return await SubPartnerDashboard({ actorUserId: session.userId });
  }
  if (!actor || actor.role !== "owner_admin") {
    redirect("/");
  }

  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const availableBalancePort = createAvailableBalancePort();
  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const projectPort = createProjectPort();

  const [
    investmentTransactions,
    withdrawalTransactions,
    availableBalances,
    currentPartnerShares,
    currentSubPartnerShares,
    projects,
  ] = await Promise.all([
    investmentTransactionPort.listAll(),
    withdrawalTransactionPort.listAll(),
    availableBalancePort.listAll(),
    listAllCurrentPartnerShares({ partnerShares: partnerSharePort }),
    listAllCurrentSubPartnerShares({ subPartnerShares: subPartnerSharePort }),
    projectPort.listProjects(),
  ]);

  // Mirrors `GET /api/money-history`'s identical `projectNamesById`-building
  // convention verbatim.
  const projectNamesById = Object.fromEntries(projects.map((project) => [project.id, project.name]));

  const summary = assembleOwnerAdminDashboard({
    investmentTransactions,
    withdrawalTransactions,
    availableBalances,
    currentPartnerShares,
    currentSubPartnerShares,
    projectNamesById,
  });

  return (
    <div>
      <PageHeader
        title="Home"
        description="A quick overview across every Project — a handful of numbers, not a data dump."
        action={<LogoutButton />}
      />

      <div className="mb-5 grid grid-cols-4 gap-3 max-[760px]:grid-cols-2">
        <StatCard label="Total Project Money" value={summary.totalProjectMoney} format="money" />
        <StatCard label="Total Added" value={summary.totalAdded} format="money" />
        <StatCard label="Total Withdrawn" value={summary.totalWithdrawn} format="money" />
        <StatCard label="Available Balance" value={summary.totalAvailableBalance} format="money" tone="success" />
      </div>

      <Card>
        <h2 className="mb-3.5 text-[15px] font-bold">Partner-wise Overview</h2>
        {summary.partnerOverview.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title="No Partner Shares yet"
            description="Once a Project has current Partner Shares, each Partner's Invested, Withdrawn, and Available Balance totals will show up here."
          />
        ) : (
          summary.partnerOverview.map((row) => <PartnerOverviewCard key={row.partnerId} row={row} />)
        )}
      </Card>
    </div>
  );
}

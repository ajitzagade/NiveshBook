import { Users } from "lucide-react";
import {
  assembleOwnerAdminDashboard,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  type PartnerOverviewRow,
} from "@niveshbook/core";
import {
  createAvailableBalancePort,
  createInvestmentTransactionPort,
  createPartnerSharePort,
  createProjectPort,
  createSubPartnerSharePort,
  createWithdrawalTransactionPort,
} from "@niveshbook/db";
import { AdjustPersonCard, Amount, Card, EmptyState, PageHeader, StatCard } from "@niveshbook/ui";
import { LogoutButton } from "../../LogoutButton";

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
 * Owner/Admin Dashboard (Story 5.4, FR35) -- replaces the Epic 5 placeholder.
 * A server component behind the `(dashboard)` layout's already-live
 * `requireOwnerAdminSession()` gate (this story's Decisions #3): no new
 * `authorize.ts` action, no new API route -- every port is constructed and
 * read directly, server-side, mirroring `apps/web/app/page.tsx`'s own
 * "async server component, ports constructed inline, data fetched via
 * `Promise.all`, no client-side fetch helper" precedent (there is no true
 * server-component precedent left inside `(dashboard)/**` itself -- every
 * other page there is `"use client"` against a REST API, a shape this
 * story's Decisions #3 explicitly opts out of).
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
 */
export default async function DashboardHomePage() {
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

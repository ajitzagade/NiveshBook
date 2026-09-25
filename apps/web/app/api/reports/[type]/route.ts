import { NextResponse, type NextRequest } from "next/server";
import type { MoneyHistoryEntryType, User } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  resolveMoneyHistoryScope,
  assembleMoneyHistory,
  moneyHistoryPersonNameKey,
  assemblePaymentModeReport,
  assembleProjectMoneyReport,
  assemblePartnerReport,
  assembleSubPartnerReport,
  assembleAvailableBalanceReport,
  type Action,
  type MoneyHistoryFilters,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
  createWithdrawalDestinationAllocationPort,
  createMoneyMovementPort,
  createAvailableBalancePort,
  createAvailableBalanceSpendPort,
  createAdjustmentNettingPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

export const UNKNOWN_REPORT_TYPE_MESSAGE = "That report type doesn't exist.";

interface RouteContext {
  params: Promise<{ type: string }>;
}

/**
 * Story 5.7 (FR38/FR39, Epic 5): the 10 report type slugs `GET
 * /api/reports/[type]` recognizes -- kebab-case, distinct from the
 * colon-namespaced `authorize.ts` action strings (spec-5-7's Decisions #7).
 * Also doubles as the "is this a real report type" check: a slug not
 * present here (or present with no matching branch below) is a `404`, never
 * a crash or a silently-empty `200` (this story's I/O matrix). One shared
 * dynamic route, not 10 separate route files (Decisions #7) -- this table
 * plus the two dispatch functions below are the "internal per-type dispatch
 * table" the Code Map calls for.
 *
 * `Object.create(null)`-based (review finding, Low/real bug) -- a plain
 * `{}` object literal here would still resolve `ACTION_BY_SLUG["constructor"]`/
 * `["toString"]`/`["hasOwnProperty"]`/etc. to `Object.prototype`'s own
 * member via the prototype chain (a truthy value), bypassing the `if
 * (!action)` 404 guard below and letting a malformed `TypeError` propagate
 * out of `authorizeScope()` as an unhandled 500 instead of the intended
 * 404. No data leak either way (this happens before any report-data read,
 * still requires an authenticated session) -- but a real robustness gap. A
 * null-prototype object has no such chain to fall through to, so an unknown
 * key is always genuinely `undefined`, never a borrowed `Object.prototype`
 * method.
 */
const ACTION_BY_SLUG: Readonly<Record<string, Action>> = Object.assign(Object.create(null), {
  "project-money": "reports:project_money",
  partner: "reports:partner",
  "sub-partner": "reports:sub_partner",
  "money-added": "reports:money_added",
  withdrawal: "reports:withdrawal",
  "available-balance": "reports:available_balance",
  "money-movement": "reports:money_movement",
  "payment-mode": "reports:payment_mode",
  adjustment: "reports:adjustment",
  "money-history": "reports:money_history",
}) as Record<string, Action>;

/** The 6 report types built by filtering `assembleMoneyHistory()`'s output by `MoneyHistoryEntry.type` (Decision #3) -- `"money-history"`/`"payment-mode"` are handled separately below (no filter / a grouping, respectively), so they're deliberately absent from this map. `Object.create(null)`-based -- mirrors `ACTION_BY_SLUG`'s identical prototype-pollution-safety rationale immediately above, even though this table is only ever indexed with an already-validated slug (defense in depth, not a currently-reachable gap). */
const ENTRY_TYPE_BY_SLUG: Readonly<Partial<Record<string, MoneyHistoryEntryType>>> = Object.assign(
  Object.create(null),
  {
    "money-added": "money_added",
    withdrawal: "money_withdrawn",
    "money-movement": "moved_to_project",
    adjustment: "adjustment",
  },
) as Partial<Record<string, MoneyHistoryEntryType>>;

const AGGREGATE_SLUGS = new Set(["project-money", "partner", "sub-partner", "available-balance"]);

/** Every filter `GET /api/reports/[type]` accepts -- an empty/whitespace-only value is treated as absent, mirroring `GET /api/money-history`'s identical convention. */
interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  projectId?: string;
  personName?: string;
}

function parseReportFilters(searchParams: URLSearchParams): ReportFilters {
  const filters: ReportFilters = {};
  const dateFrom = searchParams.get("dateFrom")?.trim();
  if (dateFrom) filters.dateFrom = dateFrom;
  const dateTo = searchParams.get("dateTo")?.trim();
  if (dateTo) filters.dateTo = dateTo;
  const projectId = searchParams.get("projectId")?.trim();
  if (projectId) filters.projectId = projectId;
  const personName = searchParams.get("personName")?.trim();
  if (personName) filters.personName = personName;
  return filters;
}

/**
 * The 6 `MoneyHistoryEntry`-based report types (Decision #3): fetches the
 * identical raw data `GET /api/money-history` fetches, resolves the actor's
 * scope via `resolveMoneyHistoryScope()` (unchanged), assembles via
 * `assembleMoneyHistory()` (unchanged) with the entry-based filters
 * (`dateFrom`/`dateTo`/`projectId`/`personName`), then narrows by `type`
 * (`"money-history"` itself gets every entry, unfiltered) or, for
 * `"payment-mode"`, groups the assembled entries via
 * `assemblePaymentModeReport()`.
 */
async function loadMoneyHistoryBasedReport(slug: string, actor: User, filters: ReportFilters) {
  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const projectPort = createProjectPort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const withdrawalDestinationAllocationPort = createWithdrawalDestinationAllocationPort();
  const moneyMovementPort = createMoneyMovementPort();
  const availableBalanceSpendPort = createAvailableBalanceSpendPort();
  const adjustmentNettingPort = createAdjustmentNettingPort();

  const [
    allPartnerShares,
    allSubPartnerShares,
    projects,
    investmentTransactions,
    withdrawalTransactions,
    withdrawalDestinationAllocations,
    moneyMovements,
    availableBalanceSpends,
    adjustmentNettings,
  ] = await Promise.all([
    listAllCurrentPartnerShares({ partnerShares: partnerSharePort }),
    listAllCurrentSubPartnerShares({ subPartnerShares: subPartnerSharePort }),
    projectPort.listProjects(),
    investmentTransactionPort.listAll(),
    withdrawalTransactionPort.listAll(),
    withdrawalDestinationAllocationPort.listAll(),
    moneyMovementPort.listAll(),
    availableBalanceSpendPort.listAll(),
    adjustmentNettingPort.listAll(),
  ]);

  const scope = resolveMoneyHistoryScope(actor.role, actor.id, allPartnerShares, allSubPartnerShares);

  const projectNamesById = Object.fromEntries(projects.map((project) => [project.id, project.name]));
  const partnerNamesById = Object.fromEntries(
    allPartnerShares.map((share) => [moneyHistoryPersonNameKey(share.partnerId, share.projectId), share.name]),
  );
  const subPartnerNamesById = Object.fromEntries(
    allSubPartnerShares.map((share) => [
      moneyHistoryPersonNameKey(share.subPartnerId, share.projectId),
      share.name,
    ]),
  );

  const moneyHistoryFilters: MoneyHistoryFilters = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    projectId: filters.projectId,
    personName: filters.personName,
  };

  const entries = assembleMoneyHistory(
    {
      investmentTransactions,
      withdrawalTransactions,
      withdrawalDestinationAllocations,
      moneyMovements,
      availableBalanceSpends,
      adjustmentNettings,
      projectNamesById,
      partnerNamesById,
      subPartnerNamesById,
    },
    scope,
    moneyHistoryFilters,
  );

  if (slug === "payment-mode") {
    return assemblePaymentModeReport(entries);
  }

  const entryType = ENTRY_TYPE_BY_SLUG[slug];
  if (!entryType) {
    // "money-history" itself -- every entry, unfiltered by type.
    return entries;
  }
  return entries.filter((entry) => entry.type === entryType);
}

/** Post-assembly narrowing for the 4 aggregate report types (Decision #8) -- `projectId`/`personName` only, no date filter (a documented scope decision: a Share/Project rollup has no dated-event concept of its own). `personName` only narrows rows that actually carry a `name` field (Partner/Sub-partner/Available Balance) -- a no-op for Project Money, which has none. */
function applyAggregateFilters<T extends { projectId: string; name?: string }>(
  rows: T[],
  filters: ReportFilters,
): T[] {
  let result = rows;
  if (filters.projectId) {
    result = result.filter((row) => row.projectId === filters.projectId);
  }
  if (filters.personName) {
    const needle = filters.personName.toLowerCase();
    result = result.filter((row) => typeof row.name !== "string" || row.name.toLowerCase().includes(needle));
  }
  return result;
}

/**
 * The 4 genuinely-new aggregate report types (Decision #4) --
 * `packages/core/src/reports.ts`'s own assemble functions, each reusing the
 * established "filter current Shares by `userId === actorUserId` -> set of
 * own share ids -> filter" self-access pattern.
 */
async function loadAggregateReport(slug: string, actor: User, filters: ReportFilters) {
  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const projectPort = createProjectPort();

  const [currentPartnerShares, currentSubPartnerShares, projects] = await Promise.all([
    listAllCurrentPartnerShares({ partnerShares: partnerSharePort }),
    listAllCurrentSubPartnerShares({ subPartnerShares: subPartnerSharePort }),
    projectPort.listProjects(),
  ]);
  const projectNamesById = Object.fromEntries(projects.map((project) => [project.id, project.name]));

  if (slug === "project-money") {
    const investmentTransactionPort = createInvestmentTransactionPort();
    const withdrawalTransactionPort = createWithdrawalTransactionPort();
    const availableBalancePort = createAvailableBalancePort();
    const [investmentTransactions, withdrawalTransactions, availableBalances] = await Promise.all([
      investmentTransactionPort.listAll(),
      withdrawalTransactionPort.listAll(),
      availableBalancePort.listAll(),
    ]);
    const rows = assembleProjectMoneyReport(actor.role, actor.id, {
      investmentTransactions,
      withdrawalTransactions,
      availableBalances,
      currentPartnerShares,
      currentSubPartnerShares,
      projects,
    });
    return applyAggregateFilters(rows, filters);
  }

  if (slug === "partner") {
    const investmentTransactionPort = createInvestmentTransactionPort();
    const withdrawalTransactionPort = createWithdrawalTransactionPort();
    const availableBalancePort = createAvailableBalancePort();
    const [investmentTransactions, withdrawalTransactions, availableBalances] = await Promise.all([
      investmentTransactionPort.listAll(),
      withdrawalTransactionPort.listAll(),
      availableBalancePort.listAll(),
    ]);
    const rows = assemblePartnerReport(actor.role, actor.id, {
      investmentTransactions,
      withdrawalTransactions,
      availableBalances,
      currentPartnerShares,
      projectNamesById,
    });
    return applyAggregateFilters(rows, filters);
  }

  if (slug === "sub-partner") {
    const investmentTransactionPort = createInvestmentTransactionPort();
    const withdrawalTransactionPort = createWithdrawalTransactionPort();
    const availableBalancePort = createAvailableBalancePort();
    const [investmentTransactions, withdrawalTransactions, availableBalances] = await Promise.all([
      investmentTransactionPort.listAll(),
      withdrawalTransactionPort.listAll(),
      availableBalancePort.listAll(),
    ]);
    const rows = assembleSubPartnerReport(actor.role, actor.id, {
      investmentTransactions,
      withdrawalTransactions,
      availableBalances,
      currentPartnerShares,
      currentSubPartnerShares,
      projectNamesById,
    });
    return applyAggregateFilters(rows, filters);
  }

  // "available-balance"
  const availableBalancePort = createAvailableBalancePort();
  const availableBalances = await availableBalancePort.listAll();
  const partnerNamesById = Object.fromEntries(
    currentPartnerShares.map((share) => [moneyHistoryPersonNameKey(share.partnerId, share.projectId), share.name]),
  );
  const subPartnerNamesById = Object.fromEntries(
    currentSubPartnerShares.map((share) => [
      moneyHistoryPersonNameKey(share.subPartnerId, share.projectId),
      share.name,
    ]),
  );
  const rows = assembleAvailableBalanceReport(actor.role, actor.id, {
    availableBalances,
    currentPartnerShares,
    currentSubPartnerShares,
    projectNamesById,
    partnerNamesById,
    subPartnerNamesById,
  });
  return applyAggregateFilters(rows, filters);
}

/**
 * Story 5.7 (FR38/FR39, Epic 5): the single shared, permission-scoped
 * Reports API -- one dynamic route dispatching across all 10 report types
 * (Decision #7) rather than 10 near-duplicate route files.
 *
 * Ordering (AD-1): session (401) -> slug validity (404 -- a plain object
 * lookup, not a data read, so checking it before `authorizeScope()` doesn't
 * violate AD-1's "before any DB read" rule) -> `authorizeScope()` (403) ->
 * every port read. Every one of the 10 branches goes through this exact
 * same sequence -- there is no branch that reads data before its own
 * `authorizeScope()` call.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const { type } = await params;
  const action = ACTION_BY_SLUG[type];
  if (!action) {
    return NextResponse.json(
      { code: "not_found", message: UNKNOWN_REPORT_TYPE_MESSAGE },
      { status: 404 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, action, { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  // Mirrors `GET /api/money-history`'s identical two-step
  // authorize-then-re-read pattern -- `authorizeScope` already confirmed
  // this user exists in a granted role; this second, cheap call learns
  // WHICH role, needed by `resolveMoneyHistoryScope`/the aggregate
  // functions' own role branching below.
  const actor = await userPort.findUserById(session.userId);
  if (!actor) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const filters = parseReportFilters(request.nextUrl.searchParams);

  const rows = AGGREGATE_SLUGS.has(type)
    ? await loadAggregateReport(type, actor, filters)
    : await loadMoneyHistoryBasedReport(type, actor, filters);

  return NextResponse.json({ rows });
}

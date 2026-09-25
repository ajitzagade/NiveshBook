import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  resolveMoneyHistoryScope,
  assembleMoneyHistory,
  moneyHistoryPersonNameKey,
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
  createAvailableBalanceSpendPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";

export const INVALID_PARTY_TYPE_MESSAGE = "`partyType` must be `partner` or `sub_partner`.";

/**
 * Parses/validates the optional query params `GET /api/money-history`
 * accepts (Story 5.1, FR31) into `MoneyHistoryFilters` -- every param is
 * optional; an empty/whitespace-only value is treated the same as absent
 * (mirrors this codebase's established "empty string means unset" query-param
 * convention). Returns `null` only for a `partyType` value that isn't one of
 * the two valid members -- every other param accepts any string (date
 * shape/project existence are enforced downstream: an unparseable date or
 * nonexistent `projectId` simply narrows the result to `[]`, never a 400 --
 * this is a read-only filter, not a write validated against a schema).
 */
function parseFilters(searchParams: URLSearchParams): MoneyHistoryFilters | null {
  const filters: MoneyHistoryFilters = {};

  const dateFrom = searchParams.get("dateFrom")?.trim();
  if (dateFrom) filters.dateFrom = dateFrom;

  const dateTo = searchParams.get("dateTo")?.trim();
  if (dateTo) filters.dateTo = dateTo;

  const projectId = searchParams.get("projectId")?.trim();
  if (projectId) filters.projectId = projectId;

  const partyType = searchParams.get("partyType")?.trim();
  if (partyType) {
    if (partyType !== "partner" && partyType !== "sub_partner") {
      return null;
    }
    filters.partyType = partyType;
  }

  const shareId = searchParams.get("shareId")?.trim();
  if (shareId) filters.shareId = shareId;

  const personName = searchParams.get("personName")?.trim();
  if (personName) filters.personName = personName;

  return filters;
}

/**
 * Story 5.1 (FR31): the unified, plain-language Money History list --
 * deliberately NOT Project-scoped (mirrors `/api/money-trail`'s precedent,
 * spec-5-1's Code Map) since a Partner/Sub-partner's own Money History spans
 * every Project they're linked to, not just one.
 *
 * `authorizeScope("money_history:list", ...)` runs before any data fetch
 * (AD-1) -- all three roles are granted at the permission-table level
 * (`authorize.ts`'s Decisions), with the actual per-row scoping computed
 * separately by `resolveMoneyHistoryScope()` below, never by
 * `authorizeScope()` itself (spec-5-1's Decisions #1).
 *
 * `listAllCurrentPartnerShares()`/`listAllCurrentSubPartnerShares()` are
 * always fetched, regardless of the actor's role -- not just for
 * `partner`/`sub_partner` scoping, but also to resolve every entry's
 * `personName` display field (an intentional widening beyond spec-5-1's
 * original Code Map; see `money-history.ts`'s own `MoneyHistoryRawData` doc
 * comment and this story's Implementation Notes).
 */
export async function GET(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "money_history:list", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const filters = parseFilters(request.nextUrl.searchParams);
  if (!filters) {
    return NextResponse.json(
      { code: "validation_error", message: INVALID_PARTY_TYPE_MESSAGE },
      { status: 400 },
    );
  }

  // `authorizeScope` already confirmed this user exists in a granted role
  // above -- re-fetched here (a second, cheap `findUserById` call, mirroring
  // e.g. `my-investment-status/route.ts`'s own two-step
  // authorize-then-read-more pattern) purely to learn WHICH role, needed by
  // `resolveMoneyHistoryScope` below.
  const actor = await userPort.findUserById(session.userId);
  if (!actor) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const projectPort = createProjectPort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const withdrawalDestinationAllocationPort = createWithdrawalDestinationAllocationPort();
  const moneyMovementPort = createMoneyMovementPort();
  const availableBalanceSpendPort = createAvailableBalanceSpendPort();

  const [
    allPartnerShares,
    allSubPartnerShares,
    projects,
    investmentTransactions,
    withdrawalTransactions,
    withdrawalDestinationAllocations,
    moneyMovements,
    availableBalanceSpends,
  ] = await Promise.all([
    listAllCurrentPartnerShares({ partnerShares: partnerSharePort }),
    listAllCurrentSubPartnerShares({ subPartnerShares: subPartnerSharePort }),
    projectPort.listProjects(),
    investmentTransactionPort.listAll(),
    withdrawalTransactionPort.listAll(),
    withdrawalDestinationAllocationPort.listAll(),
    moneyMovementPort.listAll(),
    availableBalanceSpendPort.listAll(),
  ]);

  const scope = resolveMoneyHistoryScope(actor.role, actor.id, allPartnerShares, allSubPartnerShares);

  const projectNamesById = Object.fromEntries(projects.map((project) => [project.id, project.name]));
  // Keyed by `(shareId, projectId)`, NOT `shareId` alone (review round 2) --
  // `PartnerShare.name`/`SubPartnerShare.name` are stored per-row (per
  // Project), so the same `partnerId`/`subPartnerId` can legitimately carry
  // a different name on a different Project's Share row. A `shareId`-only
  // key would silently collapse to whichever row this `.map()` happened to
  // iterate last, showing that one name for every entry regardless of which
  // Project it actually came from. `moneyHistoryPersonNameKey` is the exact
  // same key-builder `money-history.ts`'s own `resolvePersonName` reads with.
  const partnerNamesById = Object.fromEntries(
    allPartnerShares.map((share) => [moneyHistoryPersonNameKey(share.partnerId, share.projectId), share.name]),
  );
  const subPartnerNamesById = Object.fromEntries(
    allSubPartnerShares.map((share) => [
      moneyHistoryPersonNameKey(share.subPartnerId, share.projectId),
      share.name,
    ]),
  );

  const entries = assembleMoneyHistory(
    {
      investmentTransactions,
      withdrawalTransactions,
      withdrawalDestinationAllocations,
      moneyMovements,
      availableBalanceSpends,
      projectNamesById,
      partnerNamesById,
      subPartnerNamesById,
    },
    scope,
    filters,
  );

  return NextResponse.json({ entries });
}

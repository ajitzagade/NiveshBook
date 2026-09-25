import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  assembleMoneyTrail,
  reconcileMoneyTrail,
  listAllCurrentPartnerShares,
  listAllCurrentSubPartnerShares,
  MoneyTrailEntityNotFoundError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
  createWithdrawalDestinationAllocationPort,
  createMoneyMovementPort,
  createAvailableBalancePort,
  createAvailableBalanceSpendPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * The 4 `MoneyTrailNodeType` members with a genuine single-id lookup in this
 * system -- `"money_movement"` has no `findById`-by-its-own-id equivalent
 * (only ever reached via a neighboring entity's FK, `money-trail.ts`'s own
 * `MoneyTrailDeps` doc comment explains why), and the two pool-reference
 * types (`"project_investment_pool"`/`"available_balance_pool"`) are derived
 * facts, not addressable rows -- so none of those three are ever a valid
 * trail *starting point*, even though all 7 are valid `MoneyTrailNode.type`
 * values once the tree is assembled. A `type` of one of those three is
 * rejected the same as any other unrecognized string (400
 * `validation_error`), never a 404 -- there is no "id" shape that would ever
 * make one valid here.
 */
const STARTABLE_TYPES = [
  "investment_transaction",
  "withdrawal_transaction",
  "withdrawal_destination_allocation",
  "available_balance_spend",
] as const;

/** One of the 4 genuinely-startable `MoneyTrailNodeType` members -- see `STARTABLE_TYPES`'s own doc comment. */
type StartableMoneyTrailNodeType = (typeof STARTABLE_TYPES)[number];

export const INVALID_TYPE_MESSAGE = `\`type\` must be one of: ${STARTABLE_TYPES.join(", ")}.`;
export const MONEY_TRAIL_NOT_FOUND_MESSAGE = "No matching transaction was found.";

function isStartableType(value: string | null): value is StartableMoneyTrailNodeType {
  return value !== null && (STARTABLE_TYPES as readonly string[]).includes(value);
}

interface TrailStartResolutionDeps {
  investmentTransactions: { findById: ReturnType<typeof createInvestmentTransactionPort>["findById"] };
  withdrawalTransactions: { findById: ReturnType<typeof createWithdrawalTransactionPort>["findById"] };
  withdrawalDestinationAllocations: {
    findById: ReturnType<typeof createWithdrawalDestinationAllocationPort>["findById"];
  };
  availableBalanceSpends: { findById: ReturnType<typeof createAvailableBalanceSpendPort>["findById"] };
}

/**
 * Resolves the owning `userId` for a startable trail node's self-access
 * check only (Story 5.2/FR32, spec-5-2's Decisions #4) -- mirrors Story
 * 5.1's `listAllCurrentPartnerShares()`/`listAllCurrentSubPartnerShares()`
 * lookup exactly (`apps/web/app/api/money-history/route.ts`), narrowed to
 * whichever one list the resolved `partyType` actually needs, not both.
 * `"withdrawal_destination_allocation"` (a leg) carries no `partyType`/
 * `shareId`/`projectId` of its own -- it inherits them from its PARENT
 * `withdrawal_transactions` row (via `withdrawalTransactionId`), mirroring
 * `apps/web/lib/money-history.ts`'s `buildWithdrawalDestinationAllocationEntries`'s
 * identical "a leg inherits identity from its parent" precedent.
 *
 * Returns `{ found: false }` only when the starting entity itself doesn't
 * exist -- the route returns 404 for that, exactly as it did before this
 * story, leaking no more than existence (mirrors the accepted
 * `destination-allocations/route.ts` existence-vs-authorization ordering
 * tradeoff, `deferred-work.md`). Returns `{ found: true, ownerId: null }`
 * when the entity exists but no *current* Partner/Sub-partner Share links a
 * user to it (an unlinked/legacy Share, or -- for a leg whose parent
 * withdrawal can't be found, a data-integrity edge case outside this
 * story's scope -- an unresolvable parent) -- self-access is simply not
 * granted in that case, never treated as a fabricated 404.
 */
async function resolveTrailStartOwner(
  type: StartableMoneyTrailNodeType,
  id: string,
  deps: TrailStartResolutionDeps,
): Promise<{ found: false } | { found: true; ownerId: string | null }> {
  let partyType: "partner" | "sub_partner";
  let shareId: string;
  let projectId: string;

  switch (type) {
    case "investment_transaction": {
      const row = await deps.investmentTransactions.findById(id);
      if (!row) return { found: false };
      ({ partyType, shareId, projectId } = row);
      break;
    }
    case "withdrawal_transaction": {
      const row = await deps.withdrawalTransactions.findById(id);
      if (!row) return { found: false };
      ({ partyType, shareId, projectId } = row);
      break;
    }
    case "withdrawal_destination_allocation": {
      const leg = await deps.withdrawalDestinationAllocations.findById(id);
      if (!leg) return { found: false };
      const parent = await deps.withdrawalTransactions.findById(leg.withdrawalTransactionId);
      if (!parent) return { found: true, ownerId: null };
      ({ partyType, shareId, projectId } = parent);
      break;
    }
    case "available_balance_spend": {
      const row = await deps.availableBalanceSpends.findById(id);
      if (!row) return { found: false };
      partyType = row.partyType;
      shareId = row.shareId;
      projectId = row.sourceProjectId;
      break;
    }
  }

  if (partyType === "partner") {
    const shares = await listAllCurrentPartnerShares({ partnerShares: createPartnerSharePort() });
    const match = shares.find((share) => share.partnerId === shareId && share.projectId === projectId);
    return { found: true, ownerId: match?.userId ?? null };
  }

  const shares = await listAllCurrentSubPartnerShares({ subPartnerShares: createSubPartnerSharePort() });
  const match = shares.find((share) => share.subPartnerId === shareId && share.projectId === projectId);
  return { found: true, ownerId: match?.userId ?? null };
}

/**
 * Story 4.10 (FR30): the End-to-End Money Trail -- a data/API capability
 * only, no dedicated UI that story (spec-4-10's Decisions #1; the
 * Trail/TraceBanner visual component is this story's job). Deliberately NOT
 * Project-scoped -- a trail spans Projects (Story 4.10's first genuinely
 * cross-Project read), so `?type=...&id=...` query params replace the usual
 * nested `/api/projects/[id]/...` path.
 *
 * Story 5.2 (FR32) opened this from Owner/Admin-only to include self-access
 * (spec-5-2's Decisions #3/#4): `type`/`id` are now validated (400
 * `validation_error` for an unrecognized/missing `type`, or an `id` that
 * isn't even UUID-shaped -- mirrors `apps/web/lib/ids.ts`'s "malformed id
 * looks like 404" convention -- 404 `not_found`) BEFORE authorization, since
 * the self-access check itself needs `type`/`id` to resolve a `scopeOwnerIds`
 * candidate. For a non-`owner_admin` actor, the starting entity's owning
 * `userId` is then resolved via `resolveTrailStartOwner()` (skipped entirely
 * for `owner_admin` -- the role check alone suffices, avoiding the extra
 * reads) -- this narrow identity-resolution read is the same accepted shape
 * `partner_shares:list` already uses before calling `authorizeScope()`, not a
 * new AD-1 violation (spec-5-2's Boundaries). `authorizeScope()` for
 * `"money_trail:view"` is then checked, with `scopeOwnerIds` set to that
 * resolved owner (or `[]`), still strictly BEFORE `assembleMoneyTrail()`
 * itself ever runs. Once authorized, `assembleMoneyTrail()` walks the full
 * chain both directions, then `reconcileMoneyTrail()` verifies every sum
 * invariant it implies -- neither changed by this story.
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

  const type = request.nextUrl.searchParams.get("type");
  const id = request.nextUrl.searchParams.get("id");

  if (!isStartableType(type) || !id) {
    return NextResponse.json(
      { code: "validation_error", message: INVALID_TYPE_MESSAGE },
      { status: 400 },
    );
  }

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { code: "not_found", message: MONEY_TRAIL_NOT_FOUND_MESSAGE },
      { status: 404 },
    );
  }

  const userPort = createUserPort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const withdrawalDestinationAllocationPort = createWithdrawalDestinationAllocationPort();
  const moneyMovementPort = createMoneyMovementPort();
  const availableBalancePort = createAvailableBalancePort();
  const availableBalanceSpendPort = createAvailableBalanceSpendPort();

  // Learn the actor's role first -- purely to decide whether the starting-
  // entity resolution below is needed at all (skipped for `owner_admin`).
  // `authorizeScope()` re-reads the actor's role itself right after (never
  // cached, AD-1) -- the same harmless double-read `money-history/route.ts`
  // already establishes.
  const actor = await userPort.findUserById(session.userId);

  let scopeOwnerIds: readonly string[] = [];

  if (actor && actor.role !== "owner_admin") {
    const resolved = await resolveTrailStartOwner(type, id, {
      investmentTransactions: investmentTransactionPort,
      withdrawalTransactions: withdrawalTransactionPort,
      withdrawalDestinationAllocations: withdrawalDestinationAllocationPort,
      availableBalanceSpends: availableBalanceSpendPort,
    });

    if (!resolved.found) {
      return NextResponse.json(
        { code: "not_found", message: MONEY_TRAIL_NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }

    scopeOwnerIds = resolved.ownerId ? [resolved.ownerId] : [];
  }

  const { allowed } = await authorizeScope(
    session.userId,
    "money_trail:view",
    { users: userPort },
    scopeOwnerIds,
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const deps = {
    investmentTransactions: investmentTransactionPort,
    withdrawalTransactions: withdrawalTransactionPort,
    withdrawalDestinationAllocations: withdrawalDestinationAllocationPort,
    moneyMovements: moneyMovementPort,
    availableBalances: availableBalancePort,
    availableBalanceSpends: availableBalanceSpendPort,
  };

  try {
    const trail = await assembleMoneyTrail({ type, id }, deps);
    const reconciliation = reconcileMoneyTrail(trail);
    return NextResponse.json({ trail, reconciliation });
  } catch (error) {
    if (error instanceof MoneyTrailEntityNotFoundError) {
      return NextResponse.json(
        { code: "not_found", message: MONEY_TRAIL_NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }
    throw error;
  }
}

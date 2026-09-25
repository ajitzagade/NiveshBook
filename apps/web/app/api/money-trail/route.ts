import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  assembleMoneyTrail,
  reconcileMoneyTrail,
  MoneyTrailEntityNotFoundError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
  createWithdrawalDestinationAllocationPort,
  createMoneyMovementPort,
  createAvailableBalancePort,
  createAvailableBalanceSpendPort,
} from "@niveshbook/db";
import type { MoneyTrailNodeType } from "@niveshbook/types";
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
const STARTABLE_TYPES: readonly MoneyTrailNodeType[] = [
  "investment_transaction",
  "withdrawal_transaction",
  "withdrawal_destination_allocation",
  "available_balance_spend",
];

export const INVALID_TYPE_MESSAGE = `\`type\` must be one of: ${STARTABLE_TYPES.join(", ")}.`;
export const MONEY_TRAIL_NOT_FOUND_MESSAGE = "No matching transaction was found.";

function isStartableType(value: string | null): value is MoneyTrailNodeType {
  return value !== null && (STARTABLE_TYPES as readonly string[]).includes(value);
}

/**
 * Story 4.10 (FR30): the End-to-End Money Trail -- a data/API capability
 * only, no dedicated UI this story (spec-4-10's Decisions #1; the
 * Trail/TraceBanner visual component is Story 5.2's job). Deliberately NOT
 * Project-scoped -- a trail spans Projects (this story's first genuinely
 * cross-Project read), so `?type=...&id=...` query params replace the usual
 * nested `/api/projects/[id]/...` path.
 *
 * Owner/Admin-only, no self-access (spec-4-10's Decisions #2, matching every
 * table this reads) -- gated by `authorizeScope()` for `"money_trail:view"`
 * with no `scopeOwnerIds`, checked BEFORE any data read (AD-1). `type`/`id`
 * are validated next (400 `validation_error` for an unrecognized/missing
 * `type`, or an `id` that isn't even UUID-shaped -- mirrors
 * `apps/web/lib/ids.ts`'s "malformed id looks like 404" convention for the
 * shape-valid-but-nonexistent case instead, exactly like every other
 * `[id]`-shaped route in this app), then `assembleMoneyTrail()` walks the
 * full chain both directions, then `reconcileMoneyTrail()` verifies every
 * sum invariant it implies.
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
  const { allowed } = await authorizeScope(session.userId, "money_trail:view", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
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

  const deps = {
    investmentTransactions: createInvestmentTransactionPort(),
    withdrawalTransactions: createWithdrawalTransactionPort(),
    withdrawalDestinationAllocations: createWithdrawalDestinationAllocationPort(),
    moneyMovements: createMoneyMovementPort(),
    availableBalances: createAvailableBalancePort(),
    availableBalanceSpends: createAvailableBalanceSpendPort(),
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

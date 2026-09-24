import { NextResponse, type NextRequest } from "next/server";
import type { Money, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorize,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeCanTake,
  recordWithdrawalTransaction,
  listWithdrawalTransactions,
  toMoney,
  InvalidMoneyError,
  InvalidWithdrawalAmountError,
  InvalidWithdrawalDateError,
  InvalidWithdrawalPaymentModeError,
  MissingWithdrawalIdempotencyKeyError,
  WithdrawalShareNotFoundError,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
  WithdrawalIdempotencyKeyConflictError,
  assertExtraWithdrawalAuthorized,
  OwnerAdminRequiredForExtraWithdrawalError,
  ExtraWithdrawalAuthorizationRequiredError,
  type PartnerCanTake,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, isValidWithdrawalTransactionBody, shareNotFoundResponse } from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `computeCanTake` (via `recordWithdrawalTransaction`'s
 * `buildWithdrawalSnapshot`) expects. Mirrors `can-take/route.ts`'s local
 * helper of the same name -- kept local to each route rather than shared,
 * matching that file's own precedent.
 */
function groupByPartnerId(shares: readonly SubPartnerShare[]): Record<string, SubPartnerShare[]> {
  const byPartnerId: Record<string, SubPartnerShare[]> = {};
  for (const share of shares) {
    const bucket = byPartnerId[share.partnerId];
    if (bucket) {
      bucket.push(share);
    } else {
      byPartnerId[share.partnerId] = [share];
    }
  }
  return byPartnerId;
}

/**
 * Finds one target's *live* Can Take (Story 4.1) within `computeCanTake`'s
 * result tree, by `partyType`+`shareId` -- Story 4.5's extra-withdrawal gate
 * needs this figure independently of `recordWithdrawalTransaction`'s own
 * internal snapshot build (`buildWithdrawalSnapshot`), since the gate must
 * run *before* that function is ever called (this story's Boundaries).
 * Mirrors `withdrawal-transaction.ts`'s own `buildWithdrawalSnapshot` lookup
 * shape, but kept local to this route rather than exported/shared -- this
 * story's Code Map calls for the route to recompute via `computeCanTake`
 * directly, not to thread a new value through `recordWithdrawalTransaction`'s
 * stable signature. Returns `undefined` only if `shareId` doesn't match any
 * current Partner/Sub-partner -- can't happen in normal operation, since
 * `target` above was already resolved against these same fetched shares
 * before this ever runs; defense in depth only.
 */
function findLiveCanTake(
  partners: readonly PartnerCanTake[],
  partyType: "partner" | "sub_partner",
  shareId: string,
): Money | undefined {
  if (partyType === "partner") {
    return partners.find((partner) => partner.partnerId === shareId)?.canTake;
  }
  for (const partner of partners) {
    const match = partner.subPartners.find((sub) => sub.subPartnerId === shareId);
    if (match) {
      return match.canTake;
    }
  }
  return undefined;
}

/**
 * Records a "Take Now" withdrawal against one Project's Can Take (Story 4.1)
 * for a specific Partner/Sub-partner (Story 4.2) -- self-access allowed (a
 * Partner/Sub-partner may record their own withdrawal), alongside
 * unconditional Owner/Admin access, gated by `authorize()` for
 * `"withdrawal_transactions:create"`.
 *
 * Exact ordering per this story's Boundaries: session (401) -> project
 * existence (404) -> request body parsed and shape-checked (400
 * `invalid_request` -- needed this early since `partyType`/`shareId` drive
 * the very next step) -> current Partner/Sub-partner Shares plus the
 * Project's available-to-withdraw amount fetched -> target-share resolved by
 * `partyType`+`shareId` against those *current* shares (404 `not_found` if
 * no match) -> `authorize()` with `resourceRef.ownerId` set to the target
 * share's `userId` (403 `forbidden`) -> Story 4.5's Extra Withdrawal gate,
 * in this exact sub-order: (1) `computeCanTake` recomputed (409
 * `shares_not_fully_allocated`/`sub_partner_shares_over_allocated` if that
 * precondition fails), (2) `amount` re-validated via `toMoney` (400
 * `validation_error` if malformed), (3) `assertExtraWithdrawalAuthorized`
 * itself (FR25, 403 `forbidden`/400 `extra_withdrawal_authorization_required`)
 * -> only once all of that passes does `recordWithdrawalTransaction` run,
 * whose own internal field validation of amount/date/paymentMode/
 * idempotencyKey (400 `validation_error`) and Can Take preconditions (409)
 * execute a *second* time as part of that call. In other words: this
 * story's gate-related checks (recomputed Can Take, amount format) now run
 * *before* `recordWithdrawalTransaction`'s own field validation, not after
 * it as an earlier draft of this comment stated -- whichever check fails
 * first wins (e.g. Partner Shares not totalling 100% is caught by (1)
 * before a simultaneously-malformed `amount` ever reaches (2) or
 * `recordWithdrawalTransaction`'s own validation; see `route.test.ts`'s
 * dedicated test for this).
 *
 * A repeated `POST` with the same `idempotencyKey` and matching content
 * returns the *original* row with `200` (not `201`) --
 * `recordWithdrawalTransaction`'s `created` flag (threaded from the port,
 * AD-5) tells this route which status to use; the returned transaction body
 * is otherwise identical either way.
 *
 * Story 4.5 (FR25): a Take Now amount that exceeds the target's live Can
 * Take is rejected unless the request also carries
 * `extraWithdrawalAuthorized: true` *and* the acting user is Owner/Admin
 * with the `canApproveExtraWithdrawal` grant (Story 1.7) -- self-access
 * alone (the `authorize()` call above) never covers the excess by itself.
 * `assertExtraWithdrawalAuthorized` is a no-op for any amount that doesn't
 * exceed Can Take, so this correction changes nothing about a normal,
 * within-entitlement withdrawal.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const { id: projectId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (!isValidWithdrawalTransactionBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const [partnerShares, subPartnerShares, availableToWithdraw] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
    investmentTransactionPort.sumActiveAmountByProjectId(projectId),
  ]);

  const target =
    body.partyType === "partner"
      ? partnerShares.find((share) => share.partnerId === body.shareId)
      : subPartnerShares.find((share) => share.subPartnerId === body.shareId);

  if (!target) {
    return shareNotFoundResponse();
  }

  const userPort = createUserPort();
  const { allowed } = await authorize(
    session.userId,
    "withdrawal_transactions:create",
    { ownerId: target.userId ?? "" },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const subPartnerSharesByPartnerId = groupByPartnerId(subPartnerShares);
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  try {
    // Story 4.5's Extra Withdrawal gate (FR25) -- runs after the self-access
    // `authorize()` call above, before `recordWithdrawalTransaction` is ever
    // called (this story's Boundaries). `computeCanTake` is a cheap, pure,
    // no-I/O function -- recomputed here rather than threading a value
    // through `recordWithdrawalTransaction`'s stable signature (this story's
    // Code Map), mirroring this route's own existing "call pure functions
    // freely" pattern. `toMoney` is likewise re-run here (ahead of
    // `recordWithdrawalTransaction`'s own internal normalization) since the
    // gate needs a validated `Money` amount before it can even be evaluated,
    // never after the write -- an invalid amount still maps to the same 400
    // `validation_error` response either way (`InvalidMoneyError` caught
    // below, mirroring `InvalidWithdrawalAmountError`'s exact message).
    const canTakeTree = computeCanTake(availableToWithdraw, partnerShares, subPartnerSharesByPartnerId);
    const liveCanTake = findLiveCanTake(canTakeTree, body.partyType, body.shareId) ?? ("0" as Money);
    const requestedAmount = toMoney(body.amount);

    // The *acting* user's current role/grant -- always re-read live, never
    // cached off the session row (mirrors `authorize()`'s own precedent). A
    // missing row can't happen in normal operation (a valid session implies
    // an existing `users` row via the schema's foreign key) -- the `"partner"`/
    // `false` fallback is defense in depth only, and is never `"owner_admin"`,
    // so it can only ever make this gate *stricter*, never bypass it.
    const actor = await userPort.findUserById(session.userId);
    assertExtraWithdrawalAuthorized({
      requestedAmount,
      canTake: liveCanTake,
      actorRole: actor?.role ?? "partner",
      actorCanApproveExtraWithdrawal: actor?.canApproveExtraWithdrawal ?? false,
      extraWithdrawalAuthorized: body.extraWithdrawalAuthorized ?? false,
    });

    const result = await recordWithdrawalTransaction(
      projectId,
      availableToWithdraw,
      partnerShares,
      subPartnerSharesByPartnerId,
      {
        partyType: body.partyType,
        shareId: body.shareId,
        amount: body.amount,
        transactionDate: body.transactionDate,
        paymentMode: body.paymentMode,
        referenceNumber: body.referenceNumber ?? null,
        notes: body.notes ?? null,
        idempotencyKey: body.idempotencyKey,
      },
      session.userId,
      { withdrawalTransactions: withdrawalTransactionPort },
    );
    return NextResponse.json(result.transaction, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      // Thrown by this handler's own early `toMoney(body.amount)` call (run
      // ahead of `recordWithdrawalTransaction`'s internal normalization, so
      // Story 4.5's gate has a validated `Money` amount to compare) --
      // mapped to the exact same 400 shape `InvalidWithdrawalAmountError`
      // (`recordWithdrawalTransaction`'s own amount-validation error) uses,
      // so an invalid amount reads identically to a client either way.
      return NextResponse.json(
        { code: "validation_error", message: new InvalidWithdrawalAmountError().message },
        { status: 400 },
      );
    }
    if (error instanceof OwnerAdminRequiredForExtraWithdrawalError) {
      // Deliberately the same uninformative `FORBIDDEN_MESSAGE` every other
      // 403 in this codebase uses (FR8) -- not this error's own `.message`
      // (this story's Decisions: "two failure modes, two status codes").
      return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
    }
    if (error instanceof ExtraWithdrawalAuthorizationRequiredError) {
      return NextResponse.json(
        { code: "extra_withdrawal_authorization_required", message: error.message },
        { status: 400 },
      );
    }
    if (
      error instanceof InvalidWithdrawalAmountError ||
      error instanceof InvalidWithdrawalDateError ||
      error instanceof InvalidWithdrawalPaymentModeError ||
      error instanceof MissingWithdrawalIdempotencyKeyError
    ) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof PartnerSharesNotFullyAllocatedError) {
      return NextResponse.json(
        { code: "shares_not_fully_allocated", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof CanTakeSubPartnerSharesOverAllocatedError) {
      return NextResponse.json(
        { code: "sub_partner_shares_over_allocated", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof WithdrawalIdempotencyKeyConflictError) {
      // A genuine key collision between two unrelated requests (see
      // `packages/db`'s `matchesWithdrawalRequest`/
      // `WithdrawalIdempotencyKeyConflictError` doc comments) -- never
      // silently return the mismatched row.
      return NextResponse.json(
        { code: "idempotency_key_conflict", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof WithdrawalShareNotFoundError) {
      // Defense in depth only -- the target share's existence was already
      // confirmed above, against the same fetched Partner/Sub-partner
      // Shares, before `authorize()` ever ran.
      return shareNotFoundResponse();
    }
    throw error;
  }
}

/**
 * Lists every withdrawal recorded against one Project (Story 4.2, closing
 * Review Triage Log row 1 -- new this round) -- Owner/Admin-only (listing is
 * oversight functionality, mirroring `investment_transactions:list`'s
 * identical precedent), gated by `authorizeScope()` for
 * `"withdrawal_transactions:list"` with no `scopeOwnerIds`. Mirrors
 * `investment-requirements/[requirementId]/transactions/route.ts`'s `GET`
 * ordering: authorization is checked before any DB read, then project
 * existence.
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

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "withdrawal_transactions:list", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const { id: projectId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const transactions = await listWithdrawalTransactions(projectId, {
    withdrawalTransactions: withdrawalTransactionPort,
  });

  return NextResponse.json({ transactions });
}

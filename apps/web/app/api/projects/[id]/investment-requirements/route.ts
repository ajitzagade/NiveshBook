import { NextResponse, type NextRequest } from "next/server";
import type { InvestmentAdjustment, InvestmentTransaction, Money, SubPartnerShare } from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  createInvestmentRequirement,
  listInvestmentRequirements,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  listInvestmentTransactions,
  computeInvestmentAdjustment,
  filterActiveTransactions,
  snapshotRecommendedAmounts,
  shareKey,
  InvalidRequirementAmountError,
  InvalidRequirementDateError,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createInvestmentRequirementPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createInvestmentAdjustmentPort,
  createRecommendedAmountPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";
import { INVALID_REQUEST_MESSAGE, isValidInvestmentRequirementBody } from "./shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Groups a Project's *current* Sub-partner Shares by their parent
 * `partnerId` -- the shape `snapshotRecommendedAmounts` (via
 * `computeShouldPay`) expects. Duplicated per-route rather than shared --
 * mirrors `should-pay/route.ts`'s/`adjustments/route.ts`'s established
 * precedent of a local helper of the same name in each route file.
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
 * Groups one funding requirement's transactions by `(partyType, shareId)` --
 * the shape `computeInvestmentAdjustment` expects, via `shareKey`. Mirrors
 * `adjustments/route.ts`'s identical local helper (kept local to each route
 * rather than shared, matching that established precedent).
 */
function groupTransactionsByShareKey(
  transactions: readonly InvestmentTransaction[],
): Record<string, Money[]> {
  const byShareKey: Record<string, Money[]> = {};
  for (const transaction of transactions) {
    const key = shareKey(transaction.partyType, transaction.shareId);
    const bucket = byShareKey[key];
    if (bucket) {
      bucket.push(transaction.amount);
    } else {
      byShareKey[key] = [transaction.amount];
    }
  }
  return byShareKey;
}

/**
 * Groups a Project's current `investment_adjustments` rows (fetched exactly
 * once, via `investmentAdjustmentPort.listByProjectId`) by `(partyType,
 * shareId)` -- the shape `snapshotRecommendedAmounts` expects, via
 * `shareKey`. Each key holds at most one row, since `investment_adjustments`
 * is already single-current-row-per-share by design (unlike
 * `groupTransactionsByShareKey` above, which buckets multiple transactions
 * per share).
 */
function groupAdjustmentsByShareKey(
  adjustments: readonly InvestmentAdjustment[],
): Record<string, InvestmentAdjustment> {
  const byShareKey: Record<string, InvestmentAdjustment> = {};
  for (const adjustment of adjustments) {
    byShareKey[shareKey(adjustment.partyType, adjustment.shareId)] = adjustment;
  }
  return byShareKey;
}

/**
 * Lists every funding requirement for a Project (Story 3.1) --
 * Owner/Admin-only, gated by `authorizeScope()` for
 * `"investment_requirements:list"` with no `scopeOwnerIds` (this story's
 * Decisions: unlike `partner_shares:list`, there is no Partner/Sub-partner
 * scoped access yet). The 403 for a non-Owner/Admin is checked before the
 * Project-existence lookup even runs -- mirrors `partner-shares/route.ts`'s
 * `POST` ordering, simplified here since `GET` needs no pre-fetched data to
 * compute a scope from.
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
  const { allowed } = await authorizeScope(session.userId, "investment_requirements:list", {
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

  const investmentRequirementPort = createInvestmentRequirementPort();
  const requirements = await listInvestmentRequirements(projectId, {
    investmentRequirements: investmentRequirementPort,
  });

  return NextResponse.json({ requirements });
}

/**
 * Creates a new funding requirement for a Project (this story's core flow).
 * Gated by `authorizeScope()` for `"investment_requirements:create"`
 * (Owner/Admin-only), checked immediately after the session check and
 * before the body is parsed/validated -- so a non-Owner/Admin always gets a
 * uniform 403, never a 400 from a malformed body leaking ahead of the
 * authorization check (mirrors `partner-shares/route.ts`'s `POST`). 404s
 * for a nonexistent (or malformed) project `id` before ever calling
 * `createInvestmentRequirement`, rather than letting the insert fail
 * uncaught against the `investment_requirements_project_id_projects_id_fk`
 * foreign key. `amount`/`requirementDate` validation (`toMoney` + `> 0`,
 * and the `YYYY-MM-DD` format check) happens inside `createInvestmentRequirement`
 * itself -- this route only catches the resulting domain errors and maps
 * them to a 400 `validation_error`.
 *
 * Story 3.5 adds one further step *after* `createInvestmentRequirement`
 * succeeds: snapshotting Recommended Amount for every current Partner/
 * Sub-partner (see the inline comment at that call site). That step's
 * `catch` swallows **every** error, not just the two known precondition
 * ones -- the requirement is already committed in Postgres by that point,
 * this endpoint has no idempotency key (unlike Story 3.3's transactions),
 * and re-throwing would turn an already-successful creation into a client-
 * visible 500 that invites a retry that creates a genuine duplicate
 * requirement (Review Triage Log row 2). If the snapshot step fails for any
 * reason, `GET .../should-pay` for this requirement will simply show no
 * Recommended Amount -- the same outcome as the legitimate first-ever-
 * requirement case -- rather than corrupting or blocking the response here.
 * `packages/db`'s `RecommendedAmountPort.snapshotAll` writes the whole batch
 * inside one `database.transaction(...)` (Review Triage Log row 1), so a
 * failure here is guaranteed all-or-nothing, never a partial snapshot.
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

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "investment_requirements:create", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
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

  if (!isValidInvestmentRequirementBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
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

  const investmentRequirementPort = createInvestmentRequirementPort();
  let requirement;
  try {
    requirement = await createInvestmentRequirement(
      projectId,
      { amount: body.amount, requirementDate: body.requirementDate },
      { investmentRequirements: investmentRequirementPort },
    );
  } catch (error) {
    if (error instanceof InvalidRequirementAmountError || error instanceof InvalidRequirementDateError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }

  // Story 3.5: snapshot Recommended Amount for every current Partner/
  // Sub-partner, in the *same* successful call that created `requirement`
  // (this story's Boundaries) -- a side effect, never part of this
  // response body. `investmentAdjustmentPort.listByProjectId` is read here,
  // at the one moment guaranteed race-free: the new requirement didn't
  // exist until the `createInvestmentRequirement` call above created it, so
  // nothing could have queried/overwritten `investment_adjustments` for it
  // via `GET .../adjustments` yet.
  try {
    const partnerSharePort = createPartnerSharePort();
    const subPartnerSharePort = createSubPartnerSharePort();
    const investmentAdjustmentPort = createInvestmentAdjustmentPort();
    const [partnerShares, subPartnerShares, allRequirements] = await Promise.all([
      listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
      listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
      listInvestmentRequirements(projectId, { investmentRequirements: investmentRequirementPort }),
    ]);

    // Bug fix (2026-09-25, found during a live production scenario-validation
    // exercise): the immediately-prior requirement's `investment_adjustments`
    // row is otherwise only kept current lazily, as a side effect of a human
    // viewing `GET .../adjustments` (or `.../my-investment-status`) for that
    // round. If a payment there was recorded, edited, or cancelled-and-
    // replaced after the last such view, `listByProjectId` below would read a
    // stale row and this new requirement's carry-forward snapshot would
    // freeze that staleness in permanently -- there is no way to revise a
    // `RecommendedAmount` snapshot after the fact. Force a fresh recompute of
    // the single most recent OTHER requirement (`allRequirements` is already
    // ordered `desc(requirementDate, createdAt)`, so the first entry left
    // after excluding the one just created above is exactly that round)
    // before reading the ledger, so the snapshot below always reflects
    // reality rather than whatever was last viewed.
    const priorRequirement = allRequirements.find((candidate) => candidate.id !== requirement.id);
    if (priorRequirement) {
      const investmentTransactionPort = createInvestmentTransactionPort();
      const priorTransactions = await listInvestmentTransactions(priorRequirement.id, {
        investmentTransactions: investmentTransactionPort,
      });
      await computeInvestmentAdjustment(
        priorRequirement,
        partnerShares,
        groupByPartnerId(subPartnerShares),
        groupTransactionsByShareKey(filterActiveTransactions(priorTransactions)),
        { investmentAdjustments: investmentAdjustmentPort },
      );
    }

    const previousAdjustments = await investmentAdjustmentPort.listByProjectId(projectId);

    const recommendedAmountPort = createRecommendedAmountPort();
    await snapshotRecommendedAmounts(
      requirement,
      partnerShares,
      groupByPartnerId(subPartnerShares),
      groupAdjustmentsByShareKey(previousAdjustments),
      { recommendedAmounts: recommendedAmountPort },
    );
  } catch {
    // Best-effort, swallow ALL errors -- not just `computeShouldPay`'s two
    // known precondition errors (a Project with Partner Shares not yet
    // fully allocated, or a Partner's Sub-partner Shares over-allocated),
    // but also any genuinely unexpected failure (e.g. a transient DB
    // connection error). `requirement` is already committed above, this
    // endpoint has no idempotency key (unlike Story 3.3's transactions),
    // and re-throwing here would turn an already-successful creation into a
    // client-visible 500 that invites a duplicate-creating retry (Review
    // Triage Log row 2) -- mirrors this codebase's existing best-effort-
    // refresh-never-blocks-the-primary-operation philosophy (e.g.
    // `add-money/page.tsx`'s `handleSubmit`, Story 3.1). The snapshot is
    // skipped for this call; `GET .../should-pay` simply finds no
    // `recommendedAmount` to merge later, same as this story's
    // pre-existing-requirement fallback case. Fix #1 (`snapshotAll`'s
    // wrapping DB transaction) guarantees this is genuinely all-or-nothing,
    // never a silent partial snapshot.
  }

  return NextResponse.json(requirement, { status: 201 });
}

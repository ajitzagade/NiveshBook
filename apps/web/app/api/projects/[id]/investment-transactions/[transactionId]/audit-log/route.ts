import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorize,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  listAuditLogForTransaction,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import { isValidTransactionId, transactionNotFoundResponse } from "../shared";

interface RouteContext {
  params: Promise<{ id: string; transactionId: string }>;
}

/**
 * Every `audit_log` entry for one investment transaction (Story 5.9's
 * post-review fix, spec-5-9's Spec Change Log) -- a flat, `requirementId`-free
 * sibling of the original nested
 * `.../investment-requirements/[requirementId]/transactions/[transactionId]/audit-log`
 * route (Story 3.7), mirroring the withdrawal side's own already-flat
 * `.../withdrawal-transactions/[transactionId]/audit-log` shape (Story 5.9)
 * exactly, one ledger over: `investmentTransactionPort.findById(transactionId)`
 * alone is enough to resolve and validate the transaction (it already carries
 * its own `requirementId` internally; nothing here needs the caller to
 * supply it), so there's no separate requirement-existence step, matching the
 * withdrawal route's identical shallower shape.
 *
 * Why this route exists (post-review fix, not part of the original Code
 * Map): the frozen spec's Decision #3 placed the Partner/Sub-partner
 * self-access "View Audit History" entry point on the Add Money page, but
 * that page (and the entire `/projects/[id]/**` subtree) is Owner/Admin-only
 * at the layout level (`projects/layout.tsx`'s `requireOwnerAdminSession()`,
 * Story 5.5) -- a Partner/Sub-partner can never reach it, making AC clause 3
 * undeliverable through the shipped UI. The self-access entry point moved to
 * the Money History page instead (genuinely reachable by all three roles),
 * whose `MoneyHistoryEntry` rows carry a `money_added` entry's own investment
 * transaction id and `projectId`, but never a `requirementId` -- hence this
 * flat route. The original nested route is left unchanged and still fully
 * functional/tested (Owner/Admin-facing, e.g. a future per-requirement
 * drill-down UI), just no longer called by any page after this fix -- see
 * `apps/web/lib/investment-transactions.ts`'s `getAuditLog`'s own doc comment.
 *
 * Exact ordering per this story's Boundaries (AD-1): session (401) -> project
 * existence (404) -> transaction existence, incl. cross-project mismatch
 * (404) -> current Partner/Sub-partner Shares fetched -> the transaction's
 * own target share resolved by its `partyType`+`shareId` against those
 * *current* shares -> `authorize()` with `resourceRef.ownerId` set to the
 * target share's `userId` (403 `forbidden`) for
 * `"investment_transactions:view_audit"` -> `listAuditLogForTransaction` ->
 * resolve the linked cancel/reversal pair (identical mechanism to the nested
 * route and the withdrawal route) -> 200.
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

  const { id: projectId, transactionId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  if (!isValidTransactionId(transactionId)) {
    return transactionNotFoundResponse();
  }

  const investmentTransactionPort = createInvestmentTransactionPort();
  const transaction = await investmentTransactionPort.findById(transactionId);
  if (!transaction || transaction.projectId !== projectId) {
    return transactionNotFoundResponse();
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const [partnerShares, subPartnerShares] = await Promise.all([
    listCurrentPartnerShares(projectId, { partnerShares: partnerSharePort }),
    listCurrentSubPartnerSharesForProject(projectId, { subPartnerShares: subPartnerSharePort }),
  ]);

  const target =
    transaction.partyType === "partner"
      ? partnerShares.find((share) => share.partnerId === transaction.shareId)
      : subPartnerShares.find((share) => share.subPartnerId === transaction.shareId);

  const userPort = createUserPort();
  const { allowed } = await authorize(
    session.userId,
    "investment_transactions:view_audit",
    { ownerId: target?.userId ?? "" },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const entries = await listAuditLogForTransaction(transactionId, {
    investmentTransactions: investmentTransactionPort,
  });

  let linkedTransactionId: string | null = null;
  if (transaction.reversalOfTransactionId) {
    linkedTransactionId = transaction.reversalOfTransactionId;
  } else {
    const reversal = await investmentTransactionPort.findByReversalOfTransactionId(transactionId);
    linkedTransactionId = reversal?.id ?? null;
  }

  const linkedEntries = linkedTransactionId
    ? await listAuditLogForTransaction(linkedTransactionId, {
        investmentTransactions: investmentTransactionPort,
      })
    : [];

  return NextResponse.json({ entries, linkedTransactionId, linkedEntries });
}

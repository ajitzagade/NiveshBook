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
  createInvestmentRequirementPort,
  createInvestmentTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../../../shared";
import { isValidRequirementId, requirementNotFoundResponse } from "../../../../shared";
import { isValidTransactionId, transactionNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string; requirementId: string; transactionId: string }>;
}

/**
 * Every `audit_log` entry for one transaction (Story 3.7, FR41) -- visible
 * to Owner/Admin and to the transaction's own linked Partner/Sub-partner
 * (self-access, resolved from the transaction's `partyType`/`shareId`
 * against *current* Partner/Sub-partner Shares), gated by `authorize()` for
 * `"investment_transactions:view_audit"` -- mirrors
 * `my-investment-status/route.ts`'s Story 3.6 self-access-resolution shape
 * exactly, one resource over.
 *
 * Exact ordering per this story's Boundaries: session (401) -> project
 * existence (404) -> requirement existence, incl. cross-project mismatch
 * (404) -> transaction existence, incl. cross-requirement/cross-project
 * mismatch (404) -> current Partner/Sub-partner Shares fetched -> the
 * transaction's own target share resolved by its `partyType`+`shareId`
 * against those *current* shares -> `authorize()` with `resourceRef.ownerId`
 * set to the target share's `userId` (403 `forbidden`) ->
 * `listAuditLogForTransaction` -> 200. Returns every entry -- the original
 * `"create"` plus any `"edit"`s -- not filtered to only edits (this story's
 * Decisions: "the audit trail" naturally includes the transaction's origin
 * too).
 *
 * Story 5.9 extends the response additively (never a breaking reshape, per
 * that story's Boundaries): `linkedTransactionId`/`linkedEntries` resolve
 * this transaction's linked cancel/reversal pair via
 * `reversalOfTransactionId` -- if `transaction` IS a reversal, the linked
 * transaction is the original it reverses; otherwise, if some OTHER
 * transaction's `reversalOfTransactionId` points back at this one, that's
 * the linked reversal. `linkedEntries` is that linked transaction's own
 * audit entries (empty for a reversal row, which never gets its own
 * `audit_log` rows -- `cancelTransaction`'s atomicity contract only ever
 * writes one `"cancel"` entry, against the ORIGINAL transaction's id). Both
 * are `null`/`[]` when there's no linked transaction at all (never cancelled
 * -- this story's I/O matrix row 7).
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

  const { id: projectId, requirementId, transactionId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  if (!isValidRequirementId(requirementId)) {
    return requirementNotFoundResponse();
  }

  const investmentRequirementPort = createInvestmentRequirementPort();
  const requirement = await investmentRequirementPort.findById(requirementId);
  if (!requirement || requirement.projectId !== projectId) {
    return requirementNotFoundResponse();
  }

  if (!isValidTransactionId(transactionId)) {
    return transactionNotFoundResponse();
  }

  const investmentTransactionPort = createInvestmentTransactionPort();
  const transaction = await investmentTransactionPort.findById(transactionId);
  if (
    !transaction ||
    transaction.requirementId !== requirementId ||
    transaction.projectId !== projectId
  ) {
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

  // Story 5.9: resolve this transaction's linked cancel/reversal pair (if
  // any), via `reversalOfTransactionId` (both directions) -- see this
  // function's own doc comment above for the exact resolution logic.
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

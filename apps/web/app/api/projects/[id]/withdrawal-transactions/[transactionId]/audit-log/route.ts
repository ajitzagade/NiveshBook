import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorize,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  listAuditLogForWithdrawalTransaction,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createWithdrawalTransactionPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import { isValidTransactionId, transactionNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string; transactionId: string }>;
}

/**
 * Every `audit_log` entry for one withdrawal (Story 5.9, FR41/FR42) --
 * mirrors the investment side's `.../transactions/[transactionId]/audit-log/route.ts`
 * (Story 3.7) structurally, one level shallower: a withdrawal transaction is
 * Project-scoped, not nested under a funding requirement, so there's no
 * requirement-existence step here (mirrors
 * `withdrawal-transactions/[transactionId]/route.ts`'s own shallower
 * existence-check shape, Story 4.11).
 *
 * Exact ordering per this story's Boundaries (AD-1): session (401) ->
 * project existence (404) -> withdrawal existence, incl. cross-project
 * mismatch (404) -> current Partner/Sub-partner Shares fetched -> the
 * withdrawal's own target share resolved by its `partyType`+`shareId`
 * against those *current* shares -> `authorize()` with `resourceRef.ownerId`
 * set to the target share's `userId` (403 `forbidden`) for
 * `"withdrawal_transactions:view_audit"` -> `listAuditLogForWithdrawalTransaction`
 * -> resolve the linked cancel/reversal pair (Decision #5, identical
 * mechanism to the investment side) -> 200. Returns every entry -- the
 * original `"create"` plus any `"edit"`/`"cancel"` (Story 4.11) entries --
 * not filtered to only edits, mirroring the investment side's identical
 * convention.
 *
 * `linkedTransactionId`/`linkedEntries`: if `transaction` IS a reversal, the
 * linked transaction is the original it reverses; otherwise, if some OTHER
 * withdrawal's `reversalOfTransactionId` points back at this one, that's the
 * linked reversal. `linkedEntries` is that linked withdrawal's own audit
 * entries (empty for a reversal row, which never gets its own `audit_log`
 * rows). Both are `null`/`[]` when there's no linked withdrawal at all.
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

  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const transaction = await withdrawalTransactionPort.findById(transactionId);
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
    "withdrawal_transactions:view_audit",
    { ownerId: target?.userId ?? "" },
    { users: userPort },
  );

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const entries = await listAuditLogForWithdrawalTransaction(transactionId, {
    withdrawalTransactions: withdrawalTransactionPort,
  });

  let linkedTransactionId: string | null = null;
  if (transaction.reversalOfTransactionId) {
    linkedTransactionId = transaction.reversalOfTransactionId;
  } else {
    const reversal = await withdrawalTransactionPort.findByReversalOfTransactionId(transactionId);
    linkedTransactionId = reversal?.id ?? null;
  }

  const linkedEntries = linkedTransactionId
    ? await listAuditLogForWithdrawalTransaction(linkedTransactionId, {
        withdrawalTransactions: withdrawalTransactionPort,
      })
    : [];

  return NextResponse.json({ entries, linkedTransactionId, linkedEntries });
}

import { ShieldCheck } from "lucide-react";
import { assembleAuditHistory, type AuditHistoryRow } from "@niveshbook/core";
import {
  createAuditLogPort,
  createInvestmentTransactionPort,
  createUserPort,
  createWithdrawalTransactionPort,
} from "@niveshbook/db";
import { Card, EmptyState, PageHeader, StatusChip, Table, TableHead, TableBody, TableRow, Th, Td } from "@niveshbook/ui";
import { requireOwnerAdminSession } from "@/lib/session-guard";

// This page's own data depends on every transaction's live audit trail --
// never statically cached (mirrors every other `(dashboard)` page's
// identical `force-dynamic` convention, e.g. `home/page.tsx`).
export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  edit: "Edited",
  cancel: "Cancelled",
};

const ENTITY_LABEL: Record<AuditHistoryRow["entityType"], string> = {
  investment_transaction: "Add Money",
  withdrawal_transaction: "Withdraw Money",
};

/** Best-effort `amount` extraction from a row's `newValue` (falling back to `oldValue`) -- both are untyped JSON (`AuditLogEntry`'s own doc comment: this table is reused unchanged across every entity type Epic 3/4 audits, so this type can't assume any one entity's row shape). Renders "—" if neither carries a recognizable `amount` field. */
function extractAmount(row: AuditHistoryRow): string {
  const value = (row.newValue ?? row.oldValue) as { amount?: unknown } | null;
  return typeof value?.amount === "string" ? value.amount : "—";
}

/**
 * The global Audit History page (Story 5.9, FR41/FR42) -- Owner/Admin-only
 * (Decision #3), a server component mirroring the Epic 5 dashboard pattern
 * (`home/page.tsx`): every port constructed and read directly, `Promise.all`,
 * no client-side fetch layer -- this story's own AC needs no interactive
 * filtering (Decision #7), so there's nothing a client component would add.
 *
 * `requireOwnerAdminSession()` is independent, defense-in-depth gating --
 * the `(dashboard)` layout's own shell already excludes `partner`/
 * `sub_partner` from ever reaching this route via the nav (Story 5.9's
 * `NAV_ITEMS` entry, Owner/Admin-only), but this page rejects them on its
 * own too, never trusting the nav's hiding alone (a non-Owner/Admin session
 * hitting `/audit-history` directly redirects to `/`, mirroring every other
 * Owner/Admin-only page's identical `requireOwnerAdminSession()` guard).
 *
 * Filters to `investment_transaction`/`withdrawal_transaction` rows only
 * (Decision #6) -- entirely `assembleAuditHistory()`'s job (`packages/core`),
 * never this page's own filtering logic.
 */
export default async function AuditHistoryPage() {
  await requireOwnerAdminSession();

  const auditLogPort = createAuditLogPort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const userPort = createUserPort();

  const [auditLogEntries, investmentTransactions, withdrawalTransactions, users] = await Promise.all([
    auditLogPort.listAll(),
    investmentTransactionPort.listAll(),
    withdrawalTransactionPort.listAll(),
    userPort.listAllUsers(),
  ]);

  const usersById = Object.fromEntries(users.map((user) => [user.id, { email: user.email }]));

  const rows = assembleAuditHistory({
    auditLog: auditLogEntries,
    investmentTransactions,
    withdrawalTransactions,
    usersById,
  });

  return (
    <div>
      <PageHeader
        title="Audit History"
        description="Who edited or cancelled what, and when -- every Add Money and Withdraw Money transaction's own audit trail, system-wide."
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={22} />}
            title="No audit history yet"
            description="Editing or cancelling a recorded payment or withdrawal will show up here."
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th className="!text-left">Date</Th>
                <Th className="!text-left">Type</Th>
                <Th className="!text-left">Action</Th>
                <Th className="!text-left">Actor</Th>
                <Th>Amount</Th>
                <Th className="!text-left">Reason</Th>
                <Th className="!text-left">Linked</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <Td className="!text-left text-ink-soft">{new Date(row.createdAt).toLocaleString()}</Td>
                  <Td className="!text-left">{ENTITY_LABEL[row.entityType]}</Td>
                  <Td className="!text-left">{ACTION_LABEL[row.action] ?? row.action}</Td>
                  <Td className="!text-left">{row.actorName}</Td>
                  <Td className="font-mono tabular-nums">{extractAmount(row)}</Td>
                  <Td className="!text-left text-ink-soft">{row.reason ?? "—"}</Td>
                  <Td className="!text-left">
                    {row.linkedTransactionId ? (
                      <StatusChip variant="danger">Reversed</StatusChip>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

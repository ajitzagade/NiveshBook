import type { ReactNode } from "react";
import type { MoneyHistoryEntry } from "@niveshbook/types";
import { Amount, StatusChip, type RowCardField } from "@niveshbook/ui";
import { ENTRY_TYPE_LABELS } from "@/lib/money-trail-view";

/**
 * Shared across every screen that renders a `MoneyHistoryEntry` in a
 * "Payment Mode" column (Money History and Reports' entry-based report
 * types) -- moved here (spec-mobile-responsive-phase2, Decision #2) so the
 * label map exists in exactly one place; `money-history/page.tsx`'s and
 * `reports/[type]/page.tsx`'s own Table cells import it from here rather
 * than each keeping their own copy.
 */
export const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  neft: "NEFT",
  rtgs: "RTGS",
  imps: "IMPS",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

export interface EntryRowCardContent {
  title: ReactNode;
  badge: ReactNode;
  fields: RowCardField[];
}

/**
 * Money History's 10-column table and Reports' `EntryRowsTable` (9 columns,
 * the same shape minus Money History's own "Audit" action column) share 9
 * columns' worth of field structure (spec-mobile-responsive-phase2-table-
 * cards, Decision #2) -- this is that one shared row->`RowCard` mapping,
 * consumed by both `money-history/page.tsx`'s and `reports/[type]/page.tsx`'s
 * below-860px card stacks, so the mapping exists exactly once. "What
 * Happened" becomes the card's `title` (mirrors the table's own left-most,
 * most-identifying column); the cancelled/reversal `StatusChip` -- identical
 * to the table cell's own -- becomes the card's `badge`; every other column
 * becomes a stacked field, in the table's own left-to-right order. Money
 * History's own "Audit" action button is NOT included here -- it isn't a
 * shared column, and money-history/page.tsx wires it onto `RowCard`'s
 * `action` slot itself.
 */
export function mapMoneyHistoryEntryToRowCard(entry: MoneyHistoryEntry): EntryRowCardContent {
  return {
    title: ENTRY_TYPE_LABELS[entry.type],
    badge:
      entry.status === "cancelled" ? (
        <StatusChip variant="danger">
          Cancelled{entry.reversalOfTransactionId ? " (reversal)" : ""}
        </StatusChip>
      ) : null,
    fields: [
      { label: "Date", value: entry.date },
      { label: "Project", value: entry.projectName },
      { label: "Person", value: entry.personName ?? "—" },
      { label: "Amount", value: <Amount value={entry.amount} size="sm" /> },
      {
        label: "Payment Mode",
        value: entry.paymentMode ? (PAYMENT_MODE_LABELS[entry.paymentMode] ?? entry.paymentMode) : "—",
      },
      { label: "From", value: entry.from ?? "—" },
      { label: "To", value: entry.to ?? "—" },
      { label: "Notes", value: entry.notes ?? "—" },
    ],
  };
}

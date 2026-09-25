import type { MoneyHistoryEntry } from "@niveshbook/types";
import type {
  AvailableBalanceReportRow,
  PartnerReportRow,
  PaymentModeReportRow,
  ProjectMoneyReportRow,
  SubPartnerReportRow,
} from "@niveshbook/core";
import { formatAmount } from "@niveshbook/ui";
import { getReportDefinition, type ReportSlug } from "./report-catalog";
import { ENTRY_TYPE_LABELS } from "./money-trail-view";
import type { ReportRow } from "./reports";

/**
 * Report Export (Story 5.8, FR40) -- client-side Excel/PDF export of a
 * report's already-fetched, already-filtered rows. Pure client-side module
 * (`Blob`/`URL.createObjectURL`/`document.createElement("a")` browser
 * APIs) -- never a new fetch, never a new `authorize.ts` action, never a
 * new `app/api/**` route (spec-5-8's Decisions #1/#2: the rows exported
 * here already passed `GET /api/reports/[type]`'s own `authorizeScope()`
 * check, Story 5.7, before ever reaching the browser).
 *
 * `exceljs`/`jspdf`/`jspdf-autotable` are dynamically imported inside
 * `exportReportToExcel`/`exportReportToPdf` below, never at module top
 * level (Decision #4) -- this keeps their JS weight out of the initial
 * `reports/[type]/page.tsx` bundle, only loading the moment a user
 * actually clicks Export.
 *
 * Every field type-only imported from `@niveshbook/core` -- this file
 * itself has no runtime `@niveshbook/core` import, mirroring `reports.ts`'s
 * own established pattern for this codebase's documented client-bundle
 * gotcha (AGENTS.md): a runtime import from `@niveshbook/core` breaks
 * `next build` for a `"use client"`-adjacent module.
 */

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  neft: "NEFT",
  rtgs: "RTGS",
  imps: "IMPS",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

/**
 * Postgres's `numeric(7,4)` `sharePercent` column round-trips padded
 * (`"33.33"` reads back `"33.3300"`) -- trims trailing fractional zeros for
 * display only. Duplicated from `reports/[type]/page.tsx`'s identical
 * local helper (which itself duplicates `home/page.tsx`'s own
 * `formatSharePercent`) -- this codebase's established per-module
 * local-helper convention for this exact function (spec-5-8 Decision #6).
 */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

/** One exported table's shape -- shared by both the Excel and the PDF generator, so the two formats can never drift onto different column content (spec-5-8's own "matches exactly what was shown on screen" AC, both formats). */
interface ExportTable {
  headers: string[];
  body: string[][];
}

/**
 * Builds the exported header row + body cells for `slug`'s row family --
 * the EXACT SAME 6 column layouts as `reports/[type]/page.tsx`'s own 6
 * table components (spec-5-8's frozen Decision #6, cited by that file's own
 * line numbers as of this story). Mirrors `ReportTable`'s own slug-to-family
 * dispatch (`reports/[type]/page.tsx:275-290`) -- every entry-based slug
 * (`money-history`/`money-added`/`withdrawal`/`money-movement`/`adjustment`)
 * falls into the same `default` branch there, and does here too.
 */
function buildExportTable(slug: ReportSlug, rows: readonly ReportRow[]): ExportTable {
  switch (slug) {
    case "payment-mode": {
      const typed = rows as PaymentModeReportRow[];
      return {
        headers: ["Payment Mode", "Total Amount", "Entries"],
        body: typed.map((row) => [
          PAYMENT_MODE_LABELS[row.paymentMode] ?? row.paymentMode,
          formatAmount(row.totalAmount),
          String(row.entryCount),
        ]),
      };
    }
    case "project-money": {
      const typed = rows as ProjectMoneyReportRow[];
      return {
        headers: ["Project", "Money Added", "Money Withdrawn", "Available Balance"],
        body: typed.map((row) => [
          row.projectName,
          formatAmount(row.totalAdded),
          formatAmount(row.totalWithdrawn),
          formatAmount(row.totalAvailableBalance),
        ]),
      };
    }
    case "partner": {
      const typed = rows as PartnerReportRow[];
      return {
        headers: ["Partner", "Project", "Share %", "Money Added", "Money Withdrawn", "Available Balance"],
        body: typed.map((row) => [
          row.name,
          row.projectName,
          `${formatSharePercent(row.sharePercent)}%`,
          formatAmount(row.totalAdded),
          formatAmount(row.totalWithdrawn),
          formatAmount(row.totalAvailableBalance),
        ]),
      };
    }
    case "sub-partner": {
      const typed = rows as SubPartnerReportRow[];
      return {
        headers: ["Sub-partner", "Project", "Share %", "Money Added", "Money Withdrawn", "Available Balance"],
        body: typed.map((row) => [
          row.name,
          row.projectName,
          `${formatSharePercent(row.sharePercent)}%`,
          formatAmount(row.totalAdded),
          formatAmount(row.totalWithdrawn),
          formatAmount(row.totalAvailableBalance),
        ]),
      };
    }
    case "available-balance": {
      const typed = rows as AvailableBalanceReportRow[];
      return {
        headers: ["Name", "Project", "Balance"],
        body: typed.map((row) => [row.name, row.projectName, formatAmount(row.balance)]),
      };
    }
    // "money-history" | "money-added" | "withdrawal" | "money-movement" | "adjustment"
    default: {
      const typed = rows as MoneyHistoryEntry[];
      return {
        headers: ["Date", "What Happened", "Project", "Person", "Amount", "Payment Mode", "From", "To", "Notes"],
        body: typed.map((entry) => [
          entry.date,
          entryWhatHappened(entry),
          entry.projectName,
          entry.personName ?? "—",
          formatAmount(entry.amount),
          entry.paymentMode ? (PAYMENT_MODE_LABELS[entry.paymentMode] ?? entry.paymentMode) : "—",
          entry.from ?? "—",
          entry.to ?? "—",
          entry.notes ?? "—",
        ]),
      };
    }
  }
}

/**
 * The "What Happened" cell for an entry-based row: `ENTRY_TYPE_LABELS`
 * (`@/lib/money-trail-view`, reused not duplicated) plus a cancellation/
 * reversal suffix when `entry.status === "cancelled"` -- the on-screen
 * `StatusChip` badge (`reports/[type]/page.tsx:98-102`) has no export
 * equivalent, so its text content is appended inline instead (spec-5-8
 * Decision #6).
 */
function entryWhatHappened(entry: MoneyHistoryEntry): string {
  const label = ENTRY_TYPE_LABELS[entry.type];
  if (entry.status !== "cancelled") {
    return label;
  }
  return `${label} — Cancelled${entry.reversalOfTransactionId ? " (reversal)" : ""}`;
}

/** `{report name}-{YYYY-MM-DD}.{extension}` (spec-5-8 Decision #7), using `getReportDefinition(slug).name` for the human-readable report name. */
function buildFilename(slug: ReportSlug, extension: "xlsx" | "pdf"): string {
  const name = getReportDefinition(slug)?.name ?? slug;
  const date = new Date().toISOString().slice(0, 10);
  return `${name}-${date}.${extension}`;
}

/** Triggers a browser download of `blob` named `filename` via a temporary `<a download>` element, revoking the object URL afterward (spec-5-8's Code Map). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Exports `rows` (the CURRENTLY loaded, CURRENTLY filtered `state.rows` --
 * never a fresh/unfiltered fetch, spec-5-8 Decisions #1/#8) to a real
 * downloadable `.xlsx` file, one worksheet, header row + one row per
 * `rows` entry, in `buildExportTable`'s column order for `slug`.
 */
export async function exportReportToExcel(slug: ReportSlug, rows: readonly ReportRow[]): Promise<void> {
  const { headers, body } = buildExportTable(slug, rows);
  // `exceljs`'s CJS entry (`module.exports = ExcelJS`) isn't statically
  // analyzable for named exports under Node/bundler CJS-interop -- only
  // `default` (the whole `module.exports` object) is reliably populated;
  // a named `import { Workbook } from "exceljs"` resolves to `undefined`.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Report");
  worksheet.addRow(headers);
  for (const row of body) {
    worksheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildFilename(slug, "xlsx"),
  );
}

const PDF_FONT_NAME = "NotoSans";

/**
 * Exports `rows` to a real downloadable `.pdf` file -- a single table
 * (via `jspdf-autotable`) with the SAME header/body content
 * `exportReportToExcel` builds from the same `buildExportTable` call, so
 * the two formats can never show different data for the same `rows`.
 *
 * Embeds `./fonts/noto-sans-subset.ts`'s font (dynamically imported here,
 * alongside `jspdf`/`jspdf-autotable`, never at module top level) instead
 * of using jsPDF's default "standard 14" font -- those fonts' WinAnsi
 * encoding cannot represent "₹" (see that file's own doc comment for the
 * full story: a real, visually-confirmed rendering defect found during this
 * story's live verification, not a theoretical concern).
 */
export async function exportReportToPdf(slug: ReportSlug, rows: readonly ReportRow[]): Promise<void> {
  const { headers, body } = buildExportTable(slug, rows);
  const [{ jsPDF }, { default: autoTable }, { NOTO_SANS_SUBSET_BASE64 }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("./fonts/noto-sans-subset"),
  ]);
  const doc = new jsPDF({ orientation: "landscape" });
  doc.addFileToVFS(`${PDF_FONT_NAME}.ttf`, NOTO_SANS_SUBSET_BASE64);
  doc.addFont(`${PDF_FONT_NAME}.ttf`, PDF_FONT_NAME, "normal");
  // No separate bold weight is bundled -- registering "bold" under the same
  // regular-weight file avoids jspdf-autotable's header row silently
  // falling back to jsPDF's default (₹-incapable) font, at the cost of the
  // header row not being visually bolder. Disclosed tradeoff, not an oversight.
  doc.addFont(`${PDF_FONT_NAME}.ttf`, PDF_FONT_NAME, "bold");
  doc.setFont(PDF_FONT_NAME);
  autoTable(doc, { head: [headers], body, styles: { font: PDF_FONT_NAME } });
  downloadBlob(doc.output("blob"), buildFilename(slug, "pdf"));
}

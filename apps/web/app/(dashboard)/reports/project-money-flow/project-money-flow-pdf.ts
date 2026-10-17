import type { MoneyHistoryEntry } from "@niveshbook/types";
import { formatAmount, formatDate } from "@niveshbook/ui";
import type {
  PartnerCanTakeWithEffective,
  PartnerShouldPay,
  ProjectMoneyFlowReportProject,
} from "@/lib/project-money-flow-report";
import { ENTRY_TYPE_LABELS } from "@/lib/money-trail-view";
import type { CapturedFlowDiagrams } from "./capture-flow-diagram";

/**
 * Project Money Flow Report PDF generator. Mirrors `apps/web/lib/report-export.ts`'s
 * exact font-embedding pattern (same `PDF_FONT_NAME`, same `NOTO_SANS_SUBSET_BASE64`
 * import -- not duplicated) rather than reusing `exportReportToPdf` itself,
 * which is hardcoded to that module's single-table-per-`ReportSlug` shape.
 * This document is multi-section, multi-project instead.
 *
 * Data-shaping (`buildProjectTables` below) is kept pure and separate from
 * the actual `jsPDF`/`jspdf-autotable` calls in `generateProjectMoneyFlowPdf`
 * -- the shaping logic is unit-testable even though the rendering itself
 * (real `jsPDF` output, a real browser download) isn't.
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

/** Duplicated from `apps/web/lib/report-export.ts`'s identical local helper -- this codebase's established per-module local-helper convention (that file's own Decision #6), not shared. */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

function entryWhatHappened(entry: MoneyHistoryEntry): string {
  const label = ENTRY_TYPE_LABELS[entry.type];
  if (entry.status !== "cancelled") {
    return label;
  }
  return `${label} — Cancelled${entry.reversalOfTransactionId ? " (reversal)" : ""}`;
}

export interface PdfTable {
  title: string;
  headers: string[];
  body: string[][];
}

export interface ProjectTables {
  projectName: string;
  transactions: PdfTable;
  shouldPayByRequirement: PdfTable[];
  canTake: PdfTable | { unavailable: true; reason: string };
}

function buildTransactionsTable(entries: readonly MoneyHistoryEntry[]): PdfTable {
  return {
    title: "Transactions",
    headers: ["Date", "What Happened", "Person", "Amount", "Payment Mode", "From", "To", "Notes"],
    body: entries.map((entry) => [
      formatDate(entry.date),
      entryWhatHappened(entry),
      entry.personName ?? "—",
      formatAmount(entry.amount),
      entry.paymentMode ? (PAYMENT_MODE_LABELS[entry.paymentMode] ?? entry.paymentMode) : "—",
      entry.from ?? "—",
      entry.to ?? "—",
      entry.notes ?? "—",
    ]),
  };
}

function shouldPayRows(partners: readonly PartnerShouldPay[]): string[][] {
  const rows: string[][] = [];
  for (const partner of partners) {
    rows.push([partner.name, `${formatSharePercent(partner.sharePercent)}%`, formatAmount(partner.shouldPay)]);
    for (const sub of partner.subPartners) {
      rows.push([`↳ ${sub.name}`, `${formatSharePercent(sub.sharePercent)}%`, formatAmount(sub.shouldPay)]);
    }
  }
  return rows;
}

function canTakeRows(partners: readonly PartnerCanTakeWithEffective[]): string[][] {
  const rows: string[][] = [];
  for (const partner of partners) {
    rows.push([
      partner.name,
      `${formatSharePercent(partner.sharePercent)}%`,
      formatAmount(partner.canTake),
      formatAmount(partner.effectiveCanTake),
    ]);
    for (const sub of partner.subPartners) {
      rows.push([
        `↳ ${sub.name}`,
        `${formatSharePercent(sub.sharePercent)}%`,
        formatAmount(sub.canTake),
        formatAmount(sub.effectiveCanTake),
      ]);
    }
  }
  return rows;
}

function shareBreakdownRows(project: ProjectMoneyFlowReportProject): string[][] {
  const rows: string[][] = [];
  for (const partner of project.tree.partners) {
    rows.push([
      partner.name,
      `${formatSharePercent(partner.sharePercent)}%`,
      formatAmount(partner.actualAmount),
      formatAmount(partner.totalIn),
      formatAmount(partner.totalOut),
    ]);
    for (const sub of partner.subPartners) {
      rows.push([
        `↳ ${sub.name}`,
        `${formatSharePercent(sub.sharePercent)}%`,
        formatAmount(sub.actualAmount),
        formatAmount(sub.totalIn),
        formatAmount(sub.totalOut),
      ]);
    }
  }
  return rows;
}

/** Pure data-shaping: which sections/rows this one Project's PDF pages need. No `jsPDF` call here -- unit-testable without a real PDF/DOM. */
export function buildProjectTables(project: ProjectMoneyFlowReportProject): {
  transactions: PdfTable;
  shouldPayByRequirement: PdfTable[] | { unavailable: true; reason: string };
  canTake: PdfTable | { unavailable: true; reason: string };
  shares: PdfTable;
} {
  const transactions = buildTransactionsTable(project.entries);

  const shares: PdfTable = {
    title: "Ownership Share Breakdown",
    headers: ["Partner / Sub-partner", "Share %", "Actual Amount", "Total In", "Total Out"],
    body: shareBreakdownRows(project),
  };

  if (!project.status.available) {
    return {
      transactions,
      shouldPayByRequirement: { unavailable: true, reason: project.status.reason },
      canTake: { unavailable: true, reason: project.status.reason },
      shares,
    };
  }

  const shouldPayByRequirement: PdfTable[] =
    project.status.shouldPayByRequirement.length === 0
      ? []
      : project.status.shouldPayByRequirement.map(({ requirement, shouldPay }) => ({
          title: `Should Pay — ${formatAmount(requirement.amount)} funding requirement (${formatDate(requirement.requirementDate)})`,
          headers: ["Partner / Sub-partner", "Share %", "Should Pay"],
          body: shouldPayRows(shouldPay),
        }));

  const canTake: PdfTable = {
    title: `Can Take — Available to Withdraw: ${formatAmount(project.status.canTake.availableToWithdraw)}`,
    headers: ["Partner / Sub-partner", "Share %", "Can Take", "Effective Can Take"],
    body: canTakeRows(project.status.canTake.partners),
  };

  return { transactions, shouldPayByRequirement, canTake, shares };
}

/** `{Report name}-{YYYY-MM-DD}.pdf`, matching `report-export.ts`'s identical filename convention. */
function buildFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Project Money Flow Report-${date}.pdf`;
}

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

const PDF_FONT_NAME = "NotoSans";

/**
 * Builds and downloads the full multi-project PDF. One `jsPDF` document for
 * every selected Project, each getting: transactions, Should Pay (one table
 * per funding requirement, or an explicit "no requirements" / "not
 * available" line), Can Take, ownership share breakdown, then the 3 captured
 * diagram images (Percentage / Actual Amount / Money Flow), each on its own
 * page -- per project, immediately after that project's other sections (this
 * feature's confirmed Decisions), not once for the whole document.
 */
export async function generateProjectMoneyFlowPdf(
  projects: readonly ProjectMoneyFlowReportProject[],
  diagramsByProjectId: ReadonlyMap<string, CapturedFlowDiagrams>,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { NOTO_SANS_SUBSET_BASE64 }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("@/lib/fonts/noto-sans-subset"),
  ]);

  const doc = new jsPDF({ orientation: "landscape" });
  doc.addFileToVFS(`${PDF_FONT_NAME}.ttf`, NOTO_SANS_SUBSET_BASE64);
  doc.addFont(`${PDF_FONT_NAME}.ttf`, PDF_FONT_NAME, "normal");
  doc.addFont(`${PDF_FONT_NAME}.ttf`, PDF_FONT_NAME, "bold");
  doc.setFont(PDF_FONT_NAME);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  projects.forEach((project, index) => {
    if (index > 0) {
      doc.addPage();
    }

    doc.setFontSize(16);
    doc.text(project.projectName, 14, 18);
    doc.setFontSize(10);

    let cursorY = 26;

    const tables = buildProjectTables(project);
    const sections: PdfTable[] = [tables.transactions];
    if (Array.isArray(tables.shouldPayByRequirement)) {
      if (tables.shouldPayByRequirement.length === 0) {
        sections.push({
          title: "Should Pay",
          headers: [],
          body: [["No funding requirements recorded for this Project."]],
        });
      } else {
        sections.push(...tables.shouldPayByRequirement);
      }
    } else {
      sections.push({
        title: "Should Pay",
        headers: [],
        body: [[`Not available — ${tables.shouldPayByRequirement.reason}`]],
      });
    }
    if ("unavailable" in tables.canTake) {
      sections.push({ title: "Can Take", headers: [], body: [[`Not available — ${tables.canTake.reason}`]] });
    } else {
      sections.push(tables.canTake);
    }
    sections.push(tables.shares);

    for (const section of sections) {
      doc.setFont(PDF_FONT_NAME, "bold");
      doc.text(section.title, 14, cursorY);
      doc.setFont(PDF_FONT_NAME, "normal");
      autoTable(doc, {
        startY: cursorY + 3,
        head: section.headers.length > 0 ? [section.headers] : undefined,
        body: section.body,
        styles: { font: PDF_FONT_NAME },
        margin: { left: 14, right: 14 },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    }

    const diagrams = diagramsByProjectId.get(project.projectId);
    if (diagrams) {
      const diagramPages: Array<{ label: string; src: string }> = [
        { label: "Percentage View", src: diagrams.percentage },
        { label: "Actual Amount View", src: diagrams.actual },
        { label: "Money Flow View", src: diagrams.moneyFlow },
      ];
      for (const { label, src } of diagramPages) {
        doc.addPage();
        doc.setFontSize(14);
        doc.setFont(PDF_FONT_NAME, "bold");
        doc.text(`${project.projectName} — ${label}`, 14, 18);
        doc.setFont(PDF_FONT_NAME, "normal");
        const margin = 14;
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - 30;
        doc.addImage(src, "PNG", margin, 26, maxWidth, maxHeight, undefined, "FAST");
      }
    }
  });

  downloadBlob(doc.output("blob"), buildFilename());
}

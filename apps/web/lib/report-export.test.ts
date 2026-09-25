// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Money, MoneyHistoryEntry, Percent } from "@niveshbook/types";
import type {
  AvailableBalanceReportRow,
  PartnerReportRow,
  PaymentModeReportRow,
  ProjectMoneyReportRow,
  SubPartnerReportRow,
} from "@niveshbook/core";
import ExcelJS from "exceljs";
import type { UserOptions } from "jspdf-autotable";
import { exportReportToExcel, exportReportToPdf } from "./report-export";

/**
 * The real `jspdf-autotable` default export's arguments, captured via a
 * pass-through mock that still delegates to the REAL implementation (so
 * `exportReportToPdf` still produces a real, genuine PDF -- this only
 * additionally records what it was called with). Lets the PDF tests below
 * assert directly on the `head`/`body` arrays and `styles` config actually
 * handed to the table-rendering call -- the exact call site a
 * column-reordering/truncation/font-scoping regression would live in --
 * more precise than scanning the rendered PDF's raw bytes, which (now that
 * a custom CID-encoded TrueType font is embedded, `Identity-H`) no longer
 * contain literal, greppable ASCII cell text the way the old default
 * WinAnsi-encoded standard fonts did (confirmed empirically: the generated
 * PDF's raw bytes contain the literal font resource name "NotoSans" but
 * NOT literal cell text like "Money Added", since CID encoding maps each
 * glyph to a 2-byte code, not its ASCII value). A plain `vi.spyOn` on the
 * module's `default` export doesn't work here -- ESM module namespace
 * objects aren't configurable, so Vitest requires a `vi.mock` factory
 * instead (see https://vitest.dev/guide/mocking/modules).
 */
let lastAutoTableCall: { options: UserOptions } | undefined;

vi.mock("jspdf-autotable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf-autotable")>();
  return {
    ...actual,
    default: (doc: Parameters<typeof actual.default>[0], options: UserOptions) => {
      lastAutoTableCall = { options };
      return actual.default(doc, options);
    },
  };
});

/**
 * Story 5.8 (FR40): every one of the 6 report families' exact exported
 * column content, asserted twice over -- once against a REAL `exceljs`
 * round-trip (the workbook `exportReportToExcel` produces is re-loaded via
 * a fresh `ExcelJS.Workbook` and its cells read back), and once against the
 * exact `head`/`body` arguments the real `jspdf-autotable` call receives
 * (captured via the `vi.mock` pass-through above -- `exportReportToPdf`
 * still produces a real, genuine PDF). Both generators are ALSO proven to
 * build from the identical shared `buildExportTable` implementation (there
 * is exactly one column-mapping implementation, not two that could drift),
 * so this is belt-and-suspenders: per-family content is verified at both
 * generators' own actual call sites, not inferred from one format alone.
 */

function makeEntry(overrides: Partial<MoneyHistoryEntry> = {}): MoneyHistoryEntry {
  return {
    id: "entry-1",
    type: "money_added",
    date: "2026-09-10",
    projectId: "project-a",
    projectName: "Project A",
    partyType: "partner",
    shareId: "share-1",
    personName: "Someone",
    amount: "100000" as Money,
    paymentMode: "neft",
    from: null,
    to: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    ...overrides,
  };
}

let capturedBlobs: { blob: Blob; filename: string }[];

beforeEach(() => {
  capturedBlobs = [];
  lastAutoTableCall = undefined;
  // Spy on the real `URL`'s static methods rather than replacing the
  // global `URL` constructor entirely -- jsPDF's dynamic font-module
  // import internally constructs `new URL(...)`, which breaks if `URL`
  // itself is stubbed out with a plain object.
  vi.spyOn(URL, "createObjectURL").mockImplementation((obj: Blob | MediaSource) => {
    capturedBlobs.push({ blob: obj as Blob, filename: "" });
    return "blob:mock-url";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  // `downloadBlob` sets `anchor.download` before appending/clicking it --
  // capture that alongside the Blob captured by the `createObjectURL` spy
  // above (same call order every time: `createObjectURL` runs first).
  // jsdom doesn't implement the `download` attribute's special behavior --
  // a real `.click()` on an `<a href="blob:...">` just attempts an actual
  // (unsupported) navigation. Stub `.click()` to capture the filename
  // without ever invoking jsdom's real navigation path.
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = originalCreateElement(tag);
    if (tag === "a") {
      el.click = vi.fn(() => {
        const last = capturedBlobs.at(-1);
        if (last) {
          last.filename = (el as HTMLAnchorElement).download;
        }
      });
    }
    return el;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function excelRowsOf(blob: Blob): Promise<string[][]> {
  const buffer = await blob.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  const rows: string[][] = [];
  worksheet.eachRow((row) => {
    const values = row.values as unknown[];
    // `Row.values` is 1-indexed (index 0 is always empty) -- drop it.
    rows.push(values.slice(1).map((value) => (value === null || value === undefined ? "" : String(value))));
  });
  return rows;
}

describe("exportReportToExcel (Story 5.8, FR40)", () => {
  it("entry-based report: matches reports/[type]/page.tsx's EntryRowsTable column layout exactly, incl. cancelled/reversal suffix and null fallbacks", async () => {
    const rows: MoneyHistoryEntry[] = [
      makeEntry({
        id: "e1",
        date: "2026-09-10",
        type: "money_added",
        projectName: "Project Alpha",
        personName: "Partner A",
        amount: "100000" as Money,
        paymentMode: "neft",
        from: null,
        to: null,
        notes: "First tranche",
        status: "active",
      }),
      makeEntry({
        id: "e2",
        date: "2026-09-12",
        type: "money_withdrawn",
        projectName: "Project Alpha",
        personName: null,
        amount: "20000" as Money,
        paymentMode: null,
        from: "Project Alpha",
        to: null,
        notes: null,
        status: "cancelled",
        reversalOfTransactionId: null,
      }),
      makeEntry({
        id: "e3",
        date: "2026-09-13",
        type: "moved_to_project",
        projectName: "Project Beta",
        personName: null,
        amount: "5000" as Money,
        paymentMode: null,
        from: "Project Alpha",
        to: "Project Beta",
        notes: null,
        status: "cancelled",
        reversalOfTransactionId: "orig-tx-1",
      }),
    ];

    await exportReportToExcel("money-history", rows);

    const table = await excelRowsOf(capturedBlobs[0].blob);
    expect(table[0]).toEqual([
      "Date",
      "What Happened",
      "Project",
      "Person",
      "Amount",
      "Payment Mode",
      "From",
      "To",
      "Notes",
    ]);
    expect(table[1]).toEqual([
      "2026-09-10",
      "Money Added",
      "Project Alpha",
      "Partner A",
      "₹1,00,000",
      "NEFT",
      "—",
      "—",
      "First tranche",
    ]);
    expect(table[2]).toEqual([
      "2026-09-12",
      "Money Withdrawn — Cancelled",
      "Project Alpha",
      "—",
      "₹20,000",
      "—",
      "Project Alpha",
      "—",
      "—",
    ]);
    expect(table[3]).toEqual([
      "2026-09-13",
      "Moved to Project — Cancelled (reversal)",
      "Project Beta",
      "—",
      "₹5,000",
      "—",
      "Project Alpha",
      "Project Beta",
      "—",
    ]);
  });

  it("payment-mode report: matches PaymentModeTable's 3-column layout exactly", async () => {
    const rows: PaymentModeReportRow[] = [
      { paymentMode: "upi", totalAmount: "150000" as Money, entryCount: 3 },
      { paymentMode: "other", totalAmount: "500" as Money, entryCount: 1 },
    ];

    await exportReportToExcel("payment-mode", rows);

    const table = await excelRowsOf(capturedBlobs[0].blob);
    expect(table[0]).toEqual(["Payment Mode", "Total Amount", "Entries"]);
    expect(table[1]).toEqual(["UPI", "₹1,50,000", "3"]);
    expect(table[2]).toEqual(["Other", "₹500", "1"]);
  });

  it("project-money report: matches ProjectMoneyTable's 4-column layout exactly", async () => {
    const rows: ProjectMoneyReportRow[] = [
      {
        projectId: "p1",
        projectName: "Project Alpha",
        totalAdded: "1000000" as Money,
        totalWithdrawn: "200000" as Money,
        totalAvailableBalance: "50000" as Money,
      },
    ];

    await exportReportToExcel("project-money", rows);

    const table = await excelRowsOf(capturedBlobs[0].blob);
    expect(table[0]).toEqual(["Project", "Money Added", "Money Withdrawn", "Available Balance"]);
    expect(table[1]).toEqual(["Project Alpha", "₹10,00,000", "₹2,00,000", "₹50,000"]);
  });

  it("partner report: matches PartnerTable's 6-column layout exactly, incl. Postgres numeric(7,4) share-percent padding trim", async () => {
    const rows: PartnerReportRow[] = [
      {
        partnerId: "partner-1",
        name: "Partner A",
        projectId: "p1",
        projectName: "Project Alpha",
        sharePercent: "33.3300" as Percent,
        totalAdded: "100000" as Money,
        totalWithdrawn: "20000" as Money,
        totalAvailableBalance: "5000" as Money,
      },
    ];

    await exportReportToExcel("partner", rows);

    const table = await excelRowsOf(capturedBlobs[0].blob);
    expect(table[0]).toEqual(["Partner", "Project", "Share %", "Money Added", "Money Withdrawn", "Available Balance"]);
    expect(table[1]).toEqual(["Partner A", "Project Alpha", "33.33%", "₹1,00,000", "₹20,000", "₹5,000"]);
  });

  it("sub-partner report: matches SubPartnerTable's 6-column layout exactly (relabeled first column only), incl. Postgres numeric(7,4) share-percent padding trim", async () => {
    const rows: SubPartnerReportRow[] = [
      {
        subPartnerId: "sub-1",
        name: "Sub A",
        partnerId: "partner-1",
        projectId: "p1",
        projectName: "Project Alpha",
        // Padded exactly as Postgres's numeric(7,4) column round-trips it
        // (mirrors the "partner" test above) -- a plain "20" (no decimal
        // point) would take report-export.ts's own formatSharePercent's
        // early-return no-op path and never actually exercise its trim
        // regex, leaving that call site's own copy of the function
        // unverified (Review Triage Log row 1).
        sharePercent: "20.0000" as Percent,
        totalAdded: "30000" as Money,
        totalWithdrawn: "0" as Money,
        totalAvailableBalance: "0" as Money,
      },
    ];

    await exportReportToExcel("sub-partner", rows);

    const table = await excelRowsOf(capturedBlobs[0].blob);
    expect(table[0]).toEqual([
      "Sub-partner",
      "Project",
      "Share %",
      "Money Added",
      "Money Withdrawn",
      "Available Balance",
    ]);
    expect(table[1]).toEqual(["Sub A", "Project Alpha", "20%", "₹30,000", "₹0", "₹0"]);
  });

  it("available-balance report: matches AvailableBalanceTable's 3-column layout exactly", async () => {
    const rows: AvailableBalanceReportRow[] = [
      {
        partyType: "partner",
        shareId: "partner-1",
        name: "Partner A",
        projectId: "p1",
        projectName: "Project Alpha",
        balance: "5000" as Money,
      },
    ];

    await exportReportToExcel("available-balance", rows);

    const table = await excelRowsOf(capturedBlobs[0].blob);
    expect(table[0]).toEqual(["Name", "Project", "Balance"]);
    expect(table[1]).toEqual(["Partner A", "Project Alpha", "₹5,000"]);
  });

  it("filename: '{report name}-{YYYY-MM-DD}.xlsx' via getReportDefinition(slug).name", async () => {
    const today = new Date().toISOString().slice(0, 10);

    await exportReportToExcel("money-added", [makeEntry()]);

    expect(capturedBlobs[0].filename).toBe(`Money Added-${today}.xlsx`);
  });

  it("a filtered subset exports ONLY the rows it was given -- never re-fetches or widens", async () => {
    const rows: MoneyHistoryEntry[] = [makeEntry({ id: "only-this-one", projectName: "Project Alpha" })];

    await exportReportToExcel("money-added", rows);

    const table = await excelRowsOf(capturedBlobs[0].blob);
    expect(table).toHaveLength(2); // header + exactly 1 data row
    expect(table[1][2]).toBe("Project Alpha");
  });
});

/**
 * Every PDF test below asserts against `lastAutoTableCall.options` (the
 * REAL `jspdf-autotable` default export's actual arguments, captured by
 * the `vi.mock` factory above, which still delegates to the real
 * implementation) rather than trying to grep the rendered PDF's raw bytes
 * for cell text -- see that mock's own doc comment for why: the embedded
 * NotoSans font uses `Identity-H` CID encoding, so literal cell text no
 * longer appears as greppable ASCII in the content stream the way it did
 * before this story's font fix. Asserting on `head`/`body` directly proves
 * exactly what a column-reordering/truncation/font-scoping bug at the
 * `autoTable()` call site would break, for every one of the 6 report
 * families, not just the 2 that had a "well-formed blob" test before this
 * round of review.
 */
describe("exportReportToPdf (Story 5.8, FR40)", () => {
  it("entry-based report: passes buildExportTable's exact 9-column head/body to autoTable, produces a real well-formed PDF", async () => {
    const rows: MoneyHistoryEntry[] = [
      makeEntry({ id: "e1", personName: "Partner A", amount: "100000" as Money, notes: "First tranche" }),
    ];

    await exportReportToPdf("money-history", rows);

    expect(capturedBlobs).toHaveLength(1);
    const { blob, filename } = capturedBlobs[0];
    expect(blob.type).toBe("application/pdf");
    expect(filename).toMatch(/^Money History-\d{4}-\d{2}-\d{2}\.pdf$/);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(500);

    expect(lastAutoTableCall?.options.head).toEqual([
      ["Date", "What Happened", "Project", "Person", "Amount", "Payment Mode", "From", "To", "Notes"],
    ]);
    expect(lastAutoTableCall?.options.body).toEqual([
      ["2026-09-10", "Money Added", "Project A", "Partner A", "₹1,00,000", "NEFT", "—", "—", "First tranche"],
    ]);
  });

  it("payment-mode report: passes buildExportTable's exact 3-column head/body to autoTable", async () => {
    const rows: PaymentModeReportRow[] = [{ paymentMode: "upi", totalAmount: "150000" as Money, entryCount: 3 }];

    await exportReportToPdf("payment-mode", rows);

    expect(lastAutoTableCall?.options.head).toEqual([["Payment Mode", "Total Amount", "Entries"]]);
    expect(lastAutoTableCall?.options.body).toEqual([["UPI", "₹1,50,000", "3"]]);
  });

  it("project-money (aggregate) report: passes buildExportTable's exact 4-column head/body to autoTable, produces a real well-formed PDF", async () => {
    const rows: ProjectMoneyReportRow[] = [
      {
        projectId: "p1",
        projectName: "Project Alpha",
        totalAdded: "1000000" as Money,
        totalWithdrawn: "200000" as Money,
        totalAvailableBalance: "50000" as Money,
      },
    ];

    await exportReportToPdf("project-money", rows);

    const { blob, filename } = capturedBlobs[0];
    expect(blob.type).toBe("application/pdf");
    expect(filename).toMatch(/^Project Money-\d{4}-\d{2}-\d{2}\.pdf$/);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    expect(lastAutoTableCall?.options.head).toEqual([["Project", "Money Added", "Money Withdrawn", "Available Balance"]]);
    expect(lastAutoTableCall?.options.body).toEqual([["Project Alpha", "₹10,00,000", "₹2,00,000", "₹50,000"]]);
  });

  it("partner report: passes buildExportTable's exact 6-column head/body to autoTable, incl. share-percent trim", async () => {
    const rows: PartnerReportRow[] = [
      {
        partnerId: "partner-1",
        name: "Partner A",
        projectId: "p1",
        projectName: "Project Alpha",
        sharePercent: "33.3300" as Percent,
        totalAdded: "100000" as Money,
        totalWithdrawn: "20000" as Money,
        totalAvailableBalance: "5000" as Money,
      },
    ];

    await exportReportToPdf("partner", rows);

    expect(lastAutoTableCall?.options.head).toEqual([
      ["Partner", "Project", "Share %", "Money Added", "Money Withdrawn", "Available Balance"],
    ]);
    expect(lastAutoTableCall?.options.body).toEqual([
      ["Partner A", "Project Alpha", "33.33%", "₹1,00,000", "₹20,000", "₹5,000"],
    ]);
  });

  it("sub-partner report: passes buildExportTable's exact 6-column head/body to autoTable, incl. share-percent trim", async () => {
    const rows: SubPartnerReportRow[] = [
      {
        subPartnerId: "sub-1",
        name: "Sub A",
        partnerId: "partner-1",
        projectId: "p1",
        projectName: "Project Alpha",
        sharePercent: "20.0000" as Percent,
        totalAdded: "30000" as Money,
        totalWithdrawn: "0" as Money,
        totalAvailableBalance: "0" as Money,
      },
    ];

    await exportReportToPdf("sub-partner", rows);

    expect(lastAutoTableCall?.options.head).toEqual([
      ["Sub-partner", "Project", "Share %", "Money Added", "Money Withdrawn", "Available Balance"],
    ]);
    expect(lastAutoTableCall?.options.body).toEqual([["Sub A", "Project Alpha", "20%", "₹30,000", "₹0", "₹0"]]);
  });

  it("available-balance report: passes buildExportTable's exact 3-column head/body to autoTable", async () => {
    const rows: AvailableBalanceReportRow[] = [
      {
        partyType: "partner",
        shareId: "partner-1",
        name: "Partner A",
        projectId: "p1",
        projectName: "Project Alpha",
        balance: "5000" as Money,
      },
    ];

    await exportReportToPdf("available-balance", rows);

    expect(lastAutoTableCall?.options.head).toEqual([["Name", "Project", "Balance"]]);
    expect(lastAutoTableCall?.options.body).toEqual([["Partner A", "Project Alpha", "₹5,000"]]);
  });

  /**
   * Regression test for a REAL defect found during this story's live
   * verification: without a custom embedded font, jsPDF's default
   * "standard 14" fonts (WinAnsiEncoding, which predates Unicode 6.0/2010)
   * cannot represent "₹" -- every Amount cell silently mis-rendered as a
   * stray "¹" glyph (confirmed by rendering a real generated PDF to a PNG
   * and visually inspecting it). Fixed by embedding a subsetted Noto Sans
   * font (`./fonts/noto-sans-subset.ts`). Asserts on the PDF's own raw byte
   * structure -- the embedded font's PostScript name ("NotoSans") must
   * appear in the generated PDF's object stream, and that object stream
   * must contain a real embedded TrueType font reference (`CIDFontType2`/
   * `Type0`), proving the custom font was actually registered and
   * embedded, not silently skipped/falling back to a ₹-incapable default.
   * This only proves the font is embedded SOMEWHERE in the document --
   * the companion test below proves it's specifically applied to body/data
   * cells too, not just the header row.
   */
  it("embeds the NotoSans font (CIDFontType2/Type0, not jsPDF's default ₹-incapable WinAnsi standard fonts) in the generated PDF", async () => {
    await exportReportToPdf("money-added", [makeEntry({ amount: "100000" as Money })]);

    const text = Buffer.from(await capturedBlobs[0].blob.arrayBuffer()).toString("latin1");
    expect(text).toContain("NotoSans");
    // A real embedded TrueType font subset shows up as a CIDFontType2 (or
    // Type0 composite font referencing one) in the PDF's own object
    // stream -- jsPDF's un-embedded standard-14 fonts never do.
    expect(text).toMatch(/\/Subtype\s*\/(CIDFontType2|Type0)/);
  });

  /**
   * Regression test for the SPECIFIC failure mode a font fix like this one
   * can silently reintroduce: registering the custom font but scoping it
   * only to `headStyles` (or leaving `body`/`styles` unset), which would
   * still make "NotoSans" appear somewhere in the PDF's object stream (so
   * the test above alone would still pass) while data/Amount cells quietly
   * fall back to jsPDF's default ₹-incapable font -- i.e. a reintroduction
   * of the exact bug this story fixed, just scoped to data cells instead of
   * the whole document. Confirmed this actually catches that regression by
   * constructing it against the real code (temporarily moving the font onto
   * `headStyles.font` only) and observing this test fail while the
   * embedding-only test above kept passing.
   *
   * `report-export.ts` sets `styles.font` (not `headStyles.font`) on the
   * `autoTable()` call, which `jspdf-autotable` cascades to head/body/foot
   * uniformly (its own documented behavior) -- asserting directly on that
   * call's actual options proves the font applies to the WHOLE table,
   * including the Amount column's data cells, not just the header row.
   */
  it("applies NotoSans via the table-wide styles.font (not headStyles-only), so body/Amount cells use it too, not jsPDF's default font", async () => {
    await exportReportToPdf("money-added", [makeEntry({ amount: "100000" as Money })]);

    expect(lastAutoTableCall?.options.styles?.font).toBe("NotoSans");
    // If a future change adds a `headStyles` override, it must not
    // re-point the header away from NotoSans either -- but the table-wide
    // `styles.font` assertion above is what actually protects the body
    // cells regardless of whatever `headStyles` does.
    if (lastAutoTableCall?.options.headStyles?.font) {
      expect(lastAutoTableCall.options.headStyles.font).toBe("NotoSans");
    }
  });

  it("a filtered subset exports ONLY the rows it was given -- never re-fetches or widens", async () => {
    const rows: MoneyHistoryEntry[] = [makeEntry({ id: "only-this-one", projectName: "Project Alpha" })];

    await exportReportToPdf("money-added", rows);

    const body = lastAutoTableCall?.options.body as string[][] | undefined;
    expect(body).toHaveLength(1);
    expect(body?.[0][2]).toBe("Project Alpha");
  });
});

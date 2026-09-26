// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportViewerPage from "./page";

const getReport = vi.fn();
vi.mock("@/lib/reports", () => ({
  getReport: (...args: unknown[]) => getReport(...args),
}));

const listProjects = vi.fn();
vi.mock("@/lib/projects", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
}));

const exportReportToExcel = vi.fn();
const exportReportToPdf = vi.fn();
vi.mock("@/lib/report-export", () => ({
  exportReportToExcel: (...args: unknown[]) => exportReportToExcel(...args),
  exportReportToPdf: (...args: unknown[]) => exportReportToPdf(...args),
}));

let mockType = "money-history";
vi.mock("next/navigation", () => ({
  useParams: () => ({ type: mockType }),
}));

const MONEY_ADDED_ENTRY = {
  id: "entry-1",
  type: "money_added",
  date: "2026-09-01",
  projectId: "project-a",
  projectName: "Project A",
  partyType: "partner",
  shareId: "partner-1",
  personName: "Asha",
  amount: "100000",
  paymentMode: "neft",
  from: null,
  to: null,
  notes: null,
  status: "active",
  reversalOfTransactionId: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockType = "money-history";
});

beforeEach(() => {
  listProjects.mockResolvedValue([]);
});

describe("ReportViewerPage (Story 5.7, FR38/FR39)", () => {
  it("renders MoneyHistoryEntry rows for an entry-based report type", async () => {
    mockType = "money-added";
    getReport.mockResolvedValue({ rows: [MONEY_ADDED_ENTRY] });

    render(<ReportViewerPage />);

    // spec-mobile-responsive-phase2-table-cards: the RowCard stack renders
    // the exact same rows alongside the Table (CSS-only breakpoint switch)
    // -- scoped to the Table here, its own desktop-specific assertion; the
    // card stack's own copy is covered by the dedicated describe block below.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Asha")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Money Added" })).toBeInTheDocument();
    await waitFor(() => expect(getReport).toHaveBeenCalledWith("money-added", expect.any(Object)));
  });

  it("shows the date-range filter for an entry-based report type", async () => {
    mockType = "money-added";
    getReport.mockResolvedValue({ rows: [] });

    render(<ReportViewerPage />);

    await waitFor(() => expect(getReport).toHaveBeenCalled());
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toBeInTheDocument();
  });

  it("hides the date-range filter for an aggregate report type (Decision #8)", async () => {
    mockType = "project-money";
    getReport.mockResolvedValue({ rows: [] });

    render(<ReportViewerPage />);

    await waitFor(() => expect(getReport).toHaveBeenCalled());
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("To")).not.toBeInTheDocument();
  });

  it("renders Project Money aggregate rows with their own column shape", async () => {
    mockType = "project-money";
    getReport.mockResolvedValue({
      rows: [
        {
          projectId: "project-a",
          projectName: "Project A",
          totalAdded: "500000",
          totalWithdrawn: "100000",
          totalAvailableBalance: "50000",
        },
      ],
    });

    render(<ReportViewerPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Project A")).toBeInTheDocument();
  });

  it("renders Payment Mode aggregate rows grouped by mode", async () => {
    mockType = "payment-mode";
    getReport.mockResolvedValue({ rows: [{ paymentMode: "neft", totalAmount: "150000", entryCount: 2 }] });

    render(<ReportViewerPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("NEFT")).toBeInTheDocument();
  });

  // Review finding (High): `PartnerTable`, `SubPartnerTable`, and
  // `AvailableBalanceTable` were previously never rendered by any test --
  // in particular, `formatSharePercent()`'s actual rendered DOM output (the
  // "Share %" column, one of this story's named report columns) was never
  // asserted, only exercised as a pure function elsewhere. This is the
  // exact bug class Story 5.5's own review found (a formatting function
  // correct in isolation but never verified in its rendered form) -- a
  // `"33.3300"` Postgres round-trip value must render trimmed as `"33.33%"`,
  // not `"33.3300%"` or a raw unformatted string.
  it("renders Partner aggregate rows with the real DOM, incl. formatSharePercent's trimmed output", async () => {
    mockType = "partner";
    getReport.mockResolvedValue({
      rows: [
        {
          partnerId: "partner-1",
          name: "Asha",
          projectId: "project-a",
          projectName: "Project A",
          sharePercent: "33.3300",
          totalAdded: "500000",
          totalWithdrawn: "100000",
          totalAvailableBalance: "50000",
        },
      ],
    });

    render(<ReportViewerPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Asha")).toBeInTheDocument();
    expect(within(table).getByText("Project A")).toBeInTheDocument();
    expect(within(table).getByText("33.33%")).toBeInTheDocument();
    expect(within(table).getByText("₹5,00,000")).toBeInTheDocument();
  });

  it("renders Sub-partner aggregate rows with the real DOM, incl. formatSharePercent's trimmed output", async () => {
    mockType = "sub-partner";
    getReport.mockResolvedValue({
      rows: [
        {
          subPartnerId: "sub-1",
          name: "Bala",
          partnerId: "partner-1",
          projectId: "project-a",
          projectName: "Project A",
          sharePercent: "20.0000",
          totalAdded: "70000",
          totalWithdrawn: "0",
          totalAvailableBalance: "0",
        },
      ],
    });

    render(<ReportViewerPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Bala")).toBeInTheDocument();
    expect(within(table).getByText("Project A")).toBeInTheDocument();
    expect(within(table).getByText("20%")).toBeInTheDocument();
    expect(within(table).getByText("₹70,000")).toBeInTheDocument();
  });

  it("renders Available Balance aggregate rows with the real DOM, incl. name and balance", async () => {
    mockType = "available-balance";
    getReport.mockResolvedValue({
      rows: [
        {
          partyType: "partner",
          shareId: "partner-1",
          name: "Asha",
          projectId: "project-a",
          projectName: "Project A",
          balance: "5000",
        },
      ],
    });

    render(<ReportViewerPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Asha")).toBeInTheDocument();
    expect(within(table).getByText("Project A")).toBeInTheDocument();
    expect(within(table).getByText("₹5,000")).toBeInTheDocument();
  });

  it("renders an empty state when there are zero rows", async () => {
    mockType = "money-history";
    getReport.mockResolvedValue({ rows: [] });

    render(<ReportViewerPage />);

    expect(await screen.findByText("No Money History data yet")).toBeInTheDocument();
    // EmptyState renders once, not duplicated for table+card (spec-mobile-
    // responsive-phase2-table-cards' I/O matrix).
    expect(screen.queryByTestId("reports-row-cards")).not.toBeInTheDocument();
  });

  it("shows the error message when the API call fails (e.g. a 403 for a report the actor isn't granted)", async () => {
    mockType = "money-movement";
    getReport.mockRejectedValue(new Error("You don't have permission to do that."));

    render(<ReportViewerPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have permission to do that.");
  });
});

/**
 * spec-mobile-responsive-phase2-table-cards: below 860px, each of the 6
 * report shapes renders a `RowCard` stack instead of a table -- both
 * renders exist in the DOM simultaneously (CSS-only breakpoint switch),
 * scoped here via the stack's own `data-testid` so these assertions are
 * independent of the desktop Table's identical content.
 */
describe("ReportViewerPage -- below-860px RowCard stack", () => {
  it("EntryRowsTable's card stack (via the shared money-history helper) carries every field", async () => {
    mockType = "money-added";
    getReport.mockResolvedValue({ rows: [MONEY_ADDED_ENTRY] });

    render(<ReportViewerPage />);

    const cards = await screen.findByTestId("reports-row-cards");
    expect(within(cards).getByText("Money Added")).toBeInTheDocument();
    expect(within(cards).getByText("Asha")).toBeInTheDocument();
    expect(within(cards).getByText("Project A")).toBeInTheDocument();
    expect(within(cards).getByText("NEFT")).toBeInTheDocument();
  });

  it("PaymentModeTable's card stack carries Total Amount and Entries", async () => {
    mockType = "payment-mode";
    getReport.mockResolvedValue({ rows: [{ paymentMode: "neft", totalAmount: "150000", entryCount: 2 }] });

    render(<ReportViewerPage />);

    const cards = await screen.findByTestId("reports-row-cards");
    expect(within(cards).getByText("NEFT")).toBeInTheDocument();
    expect(within(cards).getByText("₹1,50,000")).toBeInTheDocument();
    expect(within(cards).getByText("2")).toBeInTheDocument();
  });

  it("ProjectMoneyTable's card stack carries Money Added/Withdrawn/Available Balance", async () => {
    mockType = "project-money";
    getReport.mockResolvedValue({
      rows: [
        {
          projectId: "project-a",
          projectName: "Project A",
          totalAdded: "500000",
          totalWithdrawn: "100000",
          totalAvailableBalance: "50000",
        },
      ],
    });

    render(<ReportViewerPage />);

    const cards = await screen.findByTestId("reports-row-cards");
    expect(within(cards).getByText("Project A")).toBeInTheDocument();
    expect(within(cards).getByText("₹5,00,000")).toBeInTheDocument();
    expect(within(cards).getByText("₹1,00,000")).toBeInTheDocument();
    expect(within(cards).getByText("₹50,000")).toBeInTheDocument();
  });

  it("PartnerTable's card stack carries Project/Share %/Money Added/Withdrawn/Available Balance", async () => {
    mockType = "partner";
    getReport.mockResolvedValue({
      rows: [
        {
          partnerId: "partner-1",
          name: "Asha",
          projectId: "project-a",
          projectName: "Project A",
          sharePercent: "33.3300",
          totalAdded: "500000",
          totalWithdrawn: "100000",
          totalAvailableBalance: "50000",
        },
      ],
    });

    render(<ReportViewerPage />);

    const cards = await screen.findByTestId("reports-row-cards");
    expect(within(cards).getByText("Asha")).toBeInTheDocument();
    expect(within(cards).getByText("Project A")).toBeInTheDocument();
    expect(within(cards).getByText("33.33%")).toBeInTheDocument();
    expect(within(cards).getByText("₹5,00,000")).toBeInTheDocument();
  });

  it("SubPartnerTable's card stack carries Project/Share %/Money Added/Withdrawn/Available Balance", async () => {
    mockType = "sub-partner";
    getReport.mockResolvedValue({
      rows: [
        {
          subPartnerId: "sub-1",
          name: "Bala",
          partnerId: "partner-1",
          projectId: "project-a",
          projectName: "Project A",
          sharePercent: "20.0000",
          totalAdded: "70000",
          totalWithdrawn: "0",
          totalAvailableBalance: "0",
        },
      ],
    });

    render(<ReportViewerPage />);

    const cards = await screen.findByTestId("reports-row-cards");
    expect(within(cards).getByText("Bala")).toBeInTheDocument();
    expect(within(cards).getByText("Project A")).toBeInTheDocument();
    expect(within(cards).getByText("20%")).toBeInTheDocument();
    expect(within(cards).getByText("₹70,000")).toBeInTheDocument();
  });

  it("AvailableBalanceTable's card stack carries Project/Balance", async () => {
    mockType = "available-balance";
    getReport.mockResolvedValue({
      rows: [
        {
          partyType: "partner",
          shareId: "partner-1",
          name: "Asha",
          projectId: "project-a",
          projectName: "Project A",
          balance: "5000",
        },
      ],
    });

    render(<ReportViewerPage />);

    const cards = await screen.findByTestId("reports-row-cards");
    expect(within(cards).getByText("Asha")).toBeInTheDocument();
    expect(within(cards).getByText("Project A")).toBeInTheDocument();
    expect(within(cards).getByText("₹5,000")).toBeInTheDocument();
  });

  // Review fix: jsdom never evaluates CSS, so a swapped/dropped breakpoint
  // class would still leave every other assertion above green. Assert the
  // actual wiring directly, mirroring layout.test.tsx's `asideClassName`
  // pattern.
  it("wires the desktop Table and mobile RowCard stack to opposite ends of the 860px breakpoint", async () => {
    mockType = "money-added";
    getReport.mockResolvedValue({ rows: [MONEY_ADDED_ENTRY] });

    render(<ReportViewerPage />);

    const table = await screen.findByRole("table");
    const tableWrapper = table.closest('[class*="860px"]');
    expect(tableWrapper?.className).toContain("max-[860px]:hidden");

    const cards = screen.getByTestId("reports-row-cards");
    expect(cards.className).toContain("hidden");
    expect(cards.className).toContain("max-[860px]:block");
  });
});

/**
 * Story 5.8 (FR40): the Export dropdown -- disabled/hidden whenever
 * `state.status !== "loaded"` or `state.rows.length === 0` (exporting
 * nothing is never a valid action), otherwise wired to call
 * `exportReportToExcel`/`exportReportToPdf` with the exact `slug`/`rows`
 * the page currently holds (never a re-fetch, spec-5-8 Decisions #1/#8).
 */
describe("Export dropdown (Story 5.8, FR40)", () => {
  it("is disabled while the report is still loading", async () => {
    mockType = "money-added";
    getReport.mockReturnValue(new Promise(() => {})); // never resolves -- stays "loading"

    render(<ReportViewerPage />);

    expect(await screen.findByRole("button", { name: /export/i })).toBeDisabled();
  });

  it("is disabled when the report loaded with zero rows", async () => {
    mockType = "money-added";
    getReport.mockResolvedValue({ rows: [] });

    render(<ReportViewerPage />);

    await waitFor(() => expect(getReport).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /export/i })).toBeDisabled();
  });

  it("is disabled when the report errored", async () => {
    mockType = "money-movement";
    getReport.mockRejectedValue(new Error("You don't have permission to do that."));

    render(<ReportViewerPage />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });

  it("Export as Excel calls exportReportToExcel with the current slug and the exact loaded/filtered rows", async () => {
    mockType = "money-added";
    getReport.mockResolvedValue({ rows: [MONEY_ADDED_ENTRY] });

    render(<ReportViewerPage />);

    const trigger = await screen.findByRole("button", { name: /export/i });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByText("Export as Excel"));

    expect(exportReportToExcel).toHaveBeenCalledWith("money-added", [MONEY_ADDED_ENTRY]);
    expect(exportReportToPdf).not.toHaveBeenCalled();
  });

  it("Export as PDF calls exportReportToPdf with the current slug and the exact loaded/filtered rows", async () => {
    mockType = "project-money";
    const row = {
      projectId: "project-a",
      projectName: "Project A",
      totalAdded: "500000",
      totalWithdrawn: "100000",
      totalAvailableBalance: "50000",
    };
    getReport.mockResolvedValue({ rows: [row] });

    render(<ReportViewerPage />);

    const trigger = await screen.findByRole("button", { name: /export/i });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByText("Export as PDF"));

    expect(exportReportToPdf).toHaveBeenCalledWith("project-money", [row]);
    expect(exportReportToExcel).not.toHaveBeenCalled();
  });
});

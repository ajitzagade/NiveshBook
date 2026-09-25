// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MoneyHistoryPage from "./page";

const getMoneyHistory = vi.fn();
vi.mock("@/lib/money-history", () => ({
  getMoneyHistory: (...args: unknown[]) => getMoneyHistory(...args),
}));

const listProjects = vi.fn();
vi.mock("@/lib/projects", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
}));

const ONE_ENTRY = {
  id: "inv-1",
  type: "money_added",
  date: "2026-09-01",
  projectId: "project-a",
  projectName: "Project A",
  partyType: "partner",
  shareId: "partner-1",
  personName: "Partner One",
  amount: "1000000",
  paymentMode: "neft",
  from: null,
  to: null,
  notes: null,
  status: "active",
  reversalOfTransactionId: null,
};

const MOVEMENT_ENTRY = {
  id: "leg-project",
  type: "moved_to_project",
  date: "2026-09-10",
  projectId: "project-a",
  projectName: "Project A",
  partyType: "partner",
  shareId: "partner-1",
  personName: "Partner One",
  amount: "300000",
  paymentMode: "cash",
  from: null,
  to: "Project B",
  notes: null,
  status: "active",
  reversalOfTransactionId: null,
};

// Review round 2 (edge-case finding #1): a cancelled transaction and its
// linked reversal, both present in the same response -- proves the page
// actually renders the "Cancelled"/"Cancelled (reversal)" `StatusChip`
// distinction rather than showing two pixel-identical, unmarked rows.
const CANCELLED_ORIGINAL_ENTRY = {
  id: "inv-cancelled",
  type: "money_added",
  date: "2026-09-05",
  projectId: "project-a",
  projectName: "Project A",
  partyType: "partner",
  shareId: "partner-1",
  personName: "Partner One",
  amount: "50000",
  paymentMode: "cash",
  from: null,
  to: null,
  notes: null,
  status: "cancelled",
  reversalOfTransactionId: null,
};

const REVERSAL_ENTRY = {
  id: "inv-reversal",
  type: "money_added",
  date: "2026-09-05",
  projectId: "project-a",
  projectName: "Project A",
  partyType: "partner",
  shareId: "partner-1",
  personName: "Partner One",
  amount: "50000",
  paymentMode: "cash",
  from: null,
  to: null,
  notes: null,
  status: "cancelled",
  reversalOfTransactionId: "inv-cancelled",
};

beforeEach(() => {
  getMoneyHistory.mockReset();
  listProjects.mockReset();
  listProjects.mockResolvedValue([
    { id: "project-a", name: "Project A", description: null, createdAt: "", updatedAt: "" },
    { id: "project-b", name: "Project B", description: null, createdAt: "", updatedAt: "" },
  ]);
});

afterEach(() => {
  cleanup();
});

describe("MoneyHistoryPage (Story 5.1, FR31)", () => {
  it("shows a loading state, then the loaded entries across all 9 columns", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY, MOVEMENT_ENTRY] });

    render(<MoneyHistoryPage />);

    expect(screen.getByText(/loading money history/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Money Added")).toBeInTheDocument());
    expect(screen.getByText("Moved to Project")).toBeInTheDocument();
    expect(screen.getAllByText("Project A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partner One").length).toBe(2);
    expect(screen.getAllByText("Project B").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NEFT").length).toBe(1);
  });

  it("marks a cancelled original and its linked reversal distinctly -- not as two unmarked, pixel-identical rows (review round 2, item #1)", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [CANCELLED_ORIGINAL_ENTRY, REVERSAL_ENTRY] });

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getAllByText("Money Added").length).toBe(2));
    // Both rows show a "Cancelled" chip -- the original AND its reversal both
    // carry `status: "cancelled"` (mirrors `RecordedPayments`' own Story 3.8
    // convention: both the voided original and its reversal are marked).
    expect(screen.getAllByText(/^cancelled/i).length).toBe(2);
    // Only the reversal row's chip carries the "(reversal)" suffix.
    expect(screen.getByText(/cancelled \(reversal\)/i)).toBeInTheDocument();
  });

  it("shows the error state when the fetch fails", async () => {
    getMoneyHistory.mockRejectedValue(new Error("Boom"));

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Boom"));
  });

  it("shows the empty state when there are no entries", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [] });

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByText(/no money history yet/i)).toBeInTheDocument());
  });

  it("applying the Project filter re-fetches with the selected projectId", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByText("Money Added")).toBeInTheDocument());
    await waitFor(() => expect(listProjects).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/^project$/i), "project-b");
    await user.click(screen.getByRole("button", { name: /^filter$/i }));

    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectId: "project-b" }),
      ),
    );
  });

  it("applying the Person filter re-fetches with the typed personName", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [] });

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByText(/no money history yet/i)).toBeInTheDocument());

    await user.type(screen.getByLabelText(/^person$/i), "Partner One");
    await user.click(screen.getByRole("button", { name: /^filter$/i }));

    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ personName: "Partner One" }),
      ),
    );
  });

  it("Clear resets filters and re-fetches with none applied", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [] });

    render(<MoneyHistoryPage />);
    await waitFor(() => expect(screen.getByText(/no money history yet/i)).toBeInTheDocument());

    await user.type(screen.getByLabelText(/^person$/i), "Someone");
    await user.click(screen.getByRole("button", { name: /^filter$/i }));
    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenLastCalledWith(expect.objectContaining({ personName: "Someone" })),
    );

    await user.click(screen.getByRole("button", { name: /^clear$/i }));

    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenLastCalledWith({
        dateFrom: undefined,
        dateTo: undefined,
        projectId: undefined,
        personName: undefined,
      }),
    );
  });
});

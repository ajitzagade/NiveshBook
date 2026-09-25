// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MoneyHistoryPage from "./page";

const getMoneyHistory = vi.fn();
const getTrailStartFromEntry = vi.fn();
vi.mock("@/lib/money-history", () => ({
  getMoneyHistory: (...args: unknown[]) => getMoneyHistory(...args),
  getTrailStartFromEntry: (...args: unknown[]) => getTrailStartFromEntry(...args),
}));

const getMoneyTrail = vi.fn();
vi.mock("@/lib/money-trail", () => ({
  getMoneyTrail: (...args: unknown[]) => getMoneyTrail(...args),
}));

const listProjects = vi.fn();
vi.mock("@/lib/projects", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
}));

const routerPush = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => mockSearchParams,
}));

/** Mirrors `apps/web/lib/money-history.ts`'s real `MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE`, kept local so this test doesn't depend on the mocked module's internals. */
const ENTRY_TYPE_TO_NODE_TYPE: Record<string, string> = {
  money_added: "investment_transaction",
  money_withdrawn: "withdrawal_transaction",
  moved_to_project: "withdrawal_destination_allocation",
  given_to_person: "withdrawal_destination_allocation",
  added_to_available_balance: "withdrawal_destination_allocation",
  used_from_available_balance: "available_balance_spend",
};

const TRAIL_LEG = {
  type: "withdrawal_destination_allocation",
  id: "leg-1",
  amount: "100000",
  data: {
    id: "leg-1",
    withdrawalTransactionId: "wd-1",
    destinationType: "person",
    amount: "100000",
    destinationProjectId: null,
    personName: "Someone",
    notes: null,
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date().toISOString(),
  },
  upstream: [],
  downstream: [],
};

const TRAIL_ORIGIN_POOL = {
  type: "project_investment_pool",
  id: "project-a",
  amount: "1000000",
  data: { projectId: "project-a", totalActiveInvested: "1000000" },
  upstream: [],
  downstream: [],
};

const TRAIL_ROOT = {
  type: "withdrawal_transaction",
  id: "wd-1",
  amount: "500000",
  data: {
    id: "wd-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "share-1",
    sharePercentSnapshot: "100",
    canTakeSnapshot: "500000",
    amount: "500000",
    transactionDate: "2026-09-10",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
  },
  upstream: [TRAIL_ORIGIN_POOL],
  downstream: [TRAIL_LEG],
};

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
  getMoneyTrail.mockReset();
  getTrailStartFromEntry.mockReset();
  getTrailStartFromEntry.mockImplementation((entry: { type: string; id: string }) => ({
    type: ENTRY_TYPE_TO_NODE_TYPE[entry.type],
    id: entry.id,
  }));
  routerPush.mockReset();
  mockSearchParams = new URLSearchParams();
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

describe("MoneyHistoryPage -- trail navigation (Story 5.2, FR32)", () => {
  it("clicking a row navigates into trace mode via traceType/traceId (mapped from the entry's type)", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByText("Money Added")).toBeInTheDocument());

    await user.click(screen.getByText("Money Added"));

    expect(getTrailStartFromEntry).toHaveBeenCalledWith(ONE_ENTRY);
    expect(routerPush).toHaveBeenCalledWith("/money-history?traceType=investment_transaction&traceId=inv-1");
  });

  it("renders TraceBanner + Trail (flattened: origin, root, downstream leg) when traceType/traceId are present in the URL", async () => {
    mockSearchParams = new URLSearchParams({ traceType: "withdrawal_transaction", traceId: "wd-1" });
    getMoneyTrail.mockResolvedValue({ trail: TRAIL_ROOT, reconciliation: { reconciled: true, discrepancies: [] } });

    render(<MoneyHistoryPage />);

    expect(getMoneyTrail).toHaveBeenCalledWith("withdrawal_transaction", "wd-1");
    expect(screen.getByText("Trace: withdrawal_transaction · wd-1")).toBeInTheDocument();

    // The origin (upstream pool), the root withdrawal, and its downstream leg
    // all appear exactly once, proving `flattenTrail()` walked both directions.
    await waitFor(() => expect(screen.getByText("Project Investment Pool")).toBeInTheDocument());
    expect(screen.getByText("Money Withdrawn")).toBeInTheDocument();
    expect(screen.getByText("Given to Person")).toBeInTheDocument();

    // The flat list/filters are not shown while tracing.
    expect(screen.queryByLabelText(/^project$/i)).not.toBeInTheDocument();
  });

  it("shows the trail's error state inline (not a page crash) for a malformed/nonexistent trace id", async () => {
    mockSearchParams = new URLSearchParams({ traceType: "withdrawal_transaction", traceId: "does-not-exist" });
    getMoneyTrail.mockRejectedValue(new Error("No matching transaction was found."));

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no matching transaction/i));
  });

  it("Back to list's own URL-building strips traceType/traceId while preserving every other current query param", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({
      traceType: "withdrawal_transaction",
      traceId: "wd-1",
      someOtherParam: "kept",
    });
    getMoneyTrail.mockResolvedValue({ trail: TRAIL_ROOT, reconciliation: { reconciled: true, discrepancies: [] } });

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByText("Money Withdrawn")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /back to list/i }));

    expect(routerPush).toHaveBeenCalledWith("/money-history?someOtherParam=kept");
  });

  it("a filter applied via the form BEFORE entering trace mode is still selected after Back to list -- proving the claimed mechanism (component state surviving a same-instance re-render, not a URL-encoded filter) actually holds", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });
    getMoneyTrail.mockResolvedValue({ trail: TRAIL_ROOT, reconciliation: { reconciled: true, discrepancies: [] } });

    const { rerender } = render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByText("Money Added")).toBeInTheDocument());
    await waitFor(() => expect(listProjects).toHaveBeenCalled());

    // Apply a real filter through the form -- this sets `formFilters`/
    // `appliedFilters` component state, NOT a URL param (Story 5.1's actual
    // shipped pattern -- confirmed by reading the page, not assumed).
    await user.selectOptions(screen.getByLabelText(/^project$/i), "project-b");
    await user.click(screen.getByRole("button", { name: /^filter$/i }));

    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "project-b" })),
    );

    // Simulate entering trace mode the way a real row click + router.push
    // would: the URL gains traceType/traceId and Next.js re-renders the SAME
    // page component (no unmount) with the new `useSearchParams()` value --
    // `rerender` on the same component instance mirrors that exactly,
    // unlike a fresh `render()` which would reset all state.
    mockSearchParams = new URLSearchParams({ traceType: "withdrawal_transaction", traceId: "wd-1" });
    rerender(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByText("Money Withdrawn")).toBeInTheDocument());
    expect(screen.queryByLabelText(/^project$/i)).not.toBeInTheDocument();

    // Exit trace mode via the real "Back to list" control.
    await user.click(screen.getByRole("button", { name: /back to list/i }));
    expect(routerPush).toHaveBeenCalledWith("/money-history");

    // Simulate the resulting URL change/re-render (traceType/traceId gone).
    mockSearchParams = new URLSearchParams();
    rerender(<MoneyHistoryPage />);

    // The Project filter selected before ever entering trace mode is still
    // selected -- proving `formFilters`/`appliedFilters` state survived the
    // round trip, not just that the URL-building logic strips two params.
    await waitFor(() => expect(screen.getByLabelText(/^project$/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/^project$/i)).toHaveValue("project-b");
  });
});

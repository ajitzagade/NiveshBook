// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
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

// Story 5.9's post-review fix: the View Audit History action's own fetches --
// mocked so every pre-existing test in this file (none of which assert on
// this action) never makes an unmocked real `fetch` call.
const getInvestmentTransactionAuditLog = vi.fn();
vi.mock("@/lib/investment-transactions", () => ({
  getInvestmentTransactionAuditLog: (...args: unknown[]) => getInvestmentTransactionAuditLog(...args),
}));

const getWithdrawalAuditLog = vi.fn();
vi.mock("@/lib/withdrawal-transactions", () => ({
  getWithdrawalAuditLog: (...args: unknown[]) => getWithdrawalAuditLog(...args),
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

const WITHDRAWN_ENTRY = {
  id: "wd-audit-1",
  type: "money_withdrawn",
  date: "2026-09-12",
  projectId: "project-a",
  projectName: "Project A",
  partyType: "partner",
  shareId: "partner-1",
  personName: "Partner One",
  amount: "200000",
  paymentMode: "cash",
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

// Story 5.3 (FR33/FR34, AD-4): a netting audit record -- has no linked money
// movement to trace, unlike every other entry type above.
const ADJUSTMENT_ENTRY = {
  id: "netting-1",
  type: "adjustment",
  date: "2026-09-20",
  projectId: "project-a",
  projectName: "Project A",
  partyType: "partner",
  shareId: "partner-1",
  personName: "Partner One",
  amount: "50000",
  paymentMode: null,
  from: null,
  to: null,
  notes: "Agreed over call",
  status: "active",
  reversalOfTransactionId: null,
};

beforeEach(() => {
  getMoneyHistory.mockReset();
  getMoneyTrail.mockReset();
  getTrailStartFromEntry.mockReset();
  getTrailStartFromEntry.mockImplementation((entry: { type: string; id: string }) => {
    // Mirrors the real `getTrailStartFromEntry`'s Story 5.3 behavior:
    // `null` for an "adjustment" entry -- nothing to trace.
    if (entry.type === "adjustment") {
      return null;
    }
    return { type: ENTRY_TYPE_TO_NODE_TYPE[entry.type], id: entry.id };
  });
  routerPush.mockReset();
  mockSearchParams = new URLSearchParams();
  getInvestmentTransactionAuditLog.mockReset();
  getWithdrawalAuditLog.mockReset();
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

    // spec-mobile-responsive-phase2-table-cards: the RowCard stack renders
    // the exact same entries alongside the Table (CSS-only breakpoint
    // switch) -- scoped to the Table here, its own desktop-specific
    // assertion; the card stack's own copy is covered separately below.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Money Added")).toBeInTheDocument();
    expect(within(table).getByText("Moved to Project")).toBeInTheDocument();
    expect(within(table).getAllByText("Project A").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Partner One").length).toBe(2);
    expect(within(table).getAllByText("Project B").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("NEFT").length).toBe(1);
  });

  it("marks a cancelled original and its linked reversal distinctly -- not as two unmarked, pixel-identical rows (review round 2, item #1)", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [CANCELLED_ORIGINAL_ENTRY, REVERSAL_ENTRY] });

    render(<MoneyHistoryPage />);

    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByText("Money Added").length).toBe(2));
    // Both rows show a "Cancelled" chip -- the original AND its reversal both
    // carry `status: "cancelled"` (mirrors `RecordedPayments`' own Story 3.8
    // convention: both the voided original and its reversal are marked).
    expect(within(table).getAllByText(/^cancelled/i).length).toBe(2);
    // Only the reversal row's chip carries the "(reversal)" suffix.
    expect(within(table).getByText(/cancelled \(reversal\)/i)).toBeInTheDocument();
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

    await screen.findByRole("table");
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

    const table = await screen.findByRole("table");

    await user.click(within(table).getByText("Money Added"));

    expect(getTrailStartFromEntry).toHaveBeenCalledWith(ONE_ENTRY);
    expect(routerPush).toHaveBeenCalledWith("/money-history?traceType=investment_transaction&traceId=inv-1");
  });

  it("renders TraceBanner + Trail (flattened: origin, root, downstream leg) when traceType/traceId are present in the URL", async () => {
    mockSearchParams = new URLSearchParams({ traceType: "withdrawal_transaction", traceId: "wd-1" });
    getMoneyTrail.mockResolvedValue({ trail: TRAIL_ROOT, reconciliation: { reconciled: true, discrepancies: [] } });

    render(<MoneyHistoryPage />);

    expect(getMoneyTrail).toHaveBeenCalledWith("withdrawal_transaction", "wd-1");
    expect(screen.getByText("Showing where this money went")).toBeInTheDocument();

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

    await screen.findByRole("table");
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

describe("MoneyHistoryPage -- 'adjustment' rows have no trace affordance (Story 5.3, FR33/FR34, AD-4)", () => {
  it("renders the 'Adjustment' label for an adjustment-type entry", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ADJUSTMENT_ENTRY] });

    render(<MoneyHistoryPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Adjustment")).toBeInTheDocument();
  });

  it("clicking an adjustment row does not navigate into trace mode -- nothing to trace", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [ADJUSTMENT_ENTRY] });

    render(<MoneyHistoryPage />);

    const table = await screen.findByRole("table");
    await user.click(within(table).getByText("Adjustment"));

    expect(routerPush).not.toHaveBeenCalled();
  });

  it("an adjustment row has no 'View this entry's money trail' title/hover affordance, unlike a traceable row", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY, ADJUSTMENT_ENTRY] });

    render(<MoneyHistoryPage />);

    const table = await screen.findByRole("table");

    const adjustmentRow = within(table).getByText("Adjustment").closest("tr");
    const traceableRow = within(table).getByText("Money Added").closest("tr");
    expect(adjustmentRow).not.toHaveAttribute("title");
    expect(traceableRow).toHaveAttribute("title", "View this entry's money trail");
  });
});

/**
 * Story 5.9's post-review fix (spec-5-9's Spec Change Log): the Partner/
 * Sub-partner self-access "View Audit History" entry point, moved here from
 * Add Money/Withdraw Money (unreachable by that role there -- see
 * `apps/web/app/(dashboard)/layout.tsx`'s `auditHistory` nav item's own doc
 * comment). Shown only for `"money_added"`/`"money_withdrawn"` rows.
 */
describe("MoneyHistoryPage -- View Audit History action (Story 5.9's post-review fix)", () => {
  it("shows the action for a 'money_added' row and fetches via the flat investment route", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });
    getInvestmentTransactionAuditLog.mockResolvedValue({
      entries: [
        {
          id: "audit-1",
          entityType: "investment_transaction",
          entityId: "inv-1",
          action: "create",
          actorUserId: "owner-1",
          oldValue: null,
          newValue: { amount: "1000000" },
          reason: null,
          createdAt: "2026-10-05T00:00:00.000Z",
        },
      ],
      linkedTransactionId: null,
      linkedEntries: [],
    });

    const user = userEvent.setup();
    render(<MoneyHistoryPage />);
    const table = await screen.findByRole("table");

    await user.click(within(table).getByRole("button", { name: "View Audit History" }));

    expect(getInvestmentTransactionAuditLog).toHaveBeenCalledWith("project-a", "inv-1");
    await screen.findByText("Created");
    // Clicking the action must not ALSO trigger the row's own trace
    // navigation (`event.stopPropagation()` inside `openAuditDialog`).
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("shows the action for a 'money_withdrawn' row and fetches via the (already-flat) withdrawal route", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [WITHDRAWN_ENTRY] });
    getWithdrawalAuditLog.mockResolvedValue({
      entries: [
        {
          id: "audit-2",
          entityType: "withdrawal_transaction",
          entityId: "wd-audit-1",
          action: "create",
          actorUserId: "owner-1",
          oldValue: null,
          newValue: { amount: "200000" },
          reason: null,
          createdAt: "2026-10-05T00:00:00.000Z",
        },
      ],
      linkedTransactionId: null,
      linkedEntries: [],
    });

    const user = userEvent.setup();
    render(<MoneyHistoryPage />);
    const table = await screen.findByRole("table");

    await user.click(within(table).getByRole("button", { name: "View Audit History" }));

    expect(getWithdrawalAuditLog).toHaveBeenCalledWith("project-a", "wd-audit-1");
    await screen.findByText("Created");
  });

  it("does not show the action for a non-auditable row type (e.g. 'moved_to_project')", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [MOVEMENT_ENTRY] });

    render(<MoneyHistoryPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Moved to Project")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Audit History" })).not.toBeInTheDocument();
  });

  it("renders the linked reversal section with REAL, non-empty linked entries -- not just the static header", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });
    getInvestmentTransactionAuditLog.mockResolvedValue({
      entries: [
        {
          id: "audit-1",
          entityType: "investment_transaction",
          entityId: "inv-1",
          action: "cancel",
          actorUserId: "owner-1",
          oldValue: { amount: "1000000" },
          newValue: { amount: "1000000" },
          reason: "recorded by mistake",
          createdAt: "2026-10-05T00:00:00.000Z",
        },
      ],
      linkedTransactionId: "inv-reversal-1",
      linkedEntries: [
        {
          id: "audit-3",
          entityType: "investment_transaction",
          entityId: "inv-reversal-1",
          action: "create",
          actorUserId: "owner-1",
          oldValue: null,
          newValue: { amount: "1000000" },
          reason: "reversal of inv-1",
          createdAt: "2026-10-05T00:00:01.000Z",
        },
      ],
    });

    const user = userEvent.setup();
    render(<MoneyHistoryPage />);
    const table = await screen.findByRole("table");

    await user.click(within(table).getByRole("button", { name: "View Audit History" }));

    await waitFor(() => {
      expect(screen.getByText("Linked Transaction")).toBeInTheDocument();
    });
    // The linked section's own real entry content actually renders -- not
    // just its static "Linked Transaction" header: its own reason
    // text ("reversal of inv-1") and its own "Created" action label both
    // appear, distinct from the requested transaction's own "Cancelled"/
    // "recorded by mistake" entry above it.
    expect(screen.getByText("Reason: reversal of inv-1")).toBeInTheDocument();
    expect(screen.getAllByText("Created").length).toBeGreaterThan(0);
    expect(screen.getByText("Reason: recorded by mistake")).toBeInTheDocument();
  });

  it("renders the error state if the audit-log fetch fails (e.g. a 403 for a different party's transaction)", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });
    getInvestmentTransactionAuditLog.mockRejectedValue(new Error("You are not allowed to view this."));

    const user = userEvent.setup();
    render(<MoneyHistoryPage />);
    const table = await screen.findByRole("table");

    await user.click(within(table).getByRole("button", { name: "View Audit History" }));

    await screen.findByText("You are not allowed to view this.");
  });
});

/**
 * spec-mobile-responsive-phase2-table-cards: below 860px, each entry
 * renders as a `RowCard` (via the shared `mapMoneyHistoryEntryToRowCard`
 * helper) instead of a table row -- both renders exist in the DOM
 * simultaneously (CSS-only breakpoint switch), scoped here via the stack's
 * own `data-testid` so these assertions are independent of the desktop
 * Table's identical content.
 */
describe("MoneyHistoryPage -- below-860px RowCard stack", () => {
  it("renders every field visible in the desktop table row on its card equivalent", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });

    render(<MoneyHistoryPage />);

    const cards = await screen.findByTestId("money-history-row-cards");
    expect(within(cards).getByText("Money Added")).toBeInTheDocument();
    expect(within(cards).getByText("2026-09-01")).toBeInTheDocument();
    expect(within(cards).getByText("Project A")).toBeInTheDocument();
    expect(within(cards).getByText("Partner One")).toBeInTheDocument();
    expect(within(cards).getByText("NEFT")).toBeInTheDocument();
  });

  it("a traceable card is keyboard-reachable (role=button, tabIndex=0) and carries the same hover/accessible hint the desktop row uses", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });

    render(<MoneyHistoryPage />);

    const cards = await screen.findByTestId("money-history-row-cards");
    const card = within(cards).getByRole("button", { name: "View this entry's money trail" });
    expect(card).toHaveAttribute("tabIndex", "0");
    expect(card).toHaveAttribute("title", "View this entry's money trail");
  });

  it("tapping a non-adjustment card triggers the same trace-mode navigation as a desktop row click", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });

    render(<MoneyHistoryPage />);

    const cards = await screen.findByTestId("money-history-row-cards");
    await user.click(within(cards).getByText("Money Added"));

    expect(getTrailStartFromEntry).toHaveBeenCalledWith(ONE_ENTRY);
    expect(routerPush).toHaveBeenCalledWith("/money-history?traceType=investment_transaction&traceId=inv-1");
  });

  it("tapping 'View Audit History' on a card opens the same dialog, without also triggering the card's own trace navigation", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });
    getInvestmentTransactionAuditLog.mockResolvedValue({
      entries: [
        {
          id: "audit-1",
          entityType: "investment_transaction",
          entityId: "inv-1",
          action: "create",
          actorUserId: "owner-1",
          oldValue: null,
          newValue: { amount: "1000000" },
          reason: null,
          createdAt: "2026-10-05T00:00:00.000Z",
        },
      ],
      linkedTransactionId: null,
      linkedEntries: [],
    });

    render(<MoneyHistoryPage />);

    const cards = await screen.findByTestId("money-history-row-cards");
    await user.click(within(cards).getByRole("button", { name: "View Audit History" }));

    expect(getInvestmentTransactionAuditLog).toHaveBeenCalledWith("project-a", "inv-1");
    await screen.findByText("Created");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("an adjustment-type card has no click handler (no trace to navigate to) and no Audit action", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [ADJUSTMENT_ENTRY] });

    render(<MoneyHistoryPage />);

    const cards = await screen.findByTestId("money-history-row-cards");
    expect(within(cards).queryByRole("button", { name: "View Audit History" })).not.toBeInTheDocument();
    // Mirrors the desktop table's own "—" fallback for the Audit column
    // (review fix: no silent data loss between the two renders) -- scoped
    // to RowCard's own action row (`.mt-2`, its only element with that
    // class) since several fields also legitimately render "—".
    const actionRow = cards.querySelector(".mt-2");
    expect(actionRow).not.toBeNull();
    expect(actionRow).toHaveTextContent("—");

    await user.click(within(cards).getByText("Adjustment"));
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("renders no card stack in the empty state (EmptyState renders once, not duplicated for table+card)", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [] });

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByText(/no money history yet/i)).toBeInTheDocument());
    expect(screen.queryByTestId("money-history-row-cards")).not.toBeInTheDocument();
  });

  // Review fix: jsdom never evaluates CSS, so a swapped/dropped breakpoint
  // class would still leave every other assertion above green. Assert the
  // actual wiring directly, mirroring layout.test.tsx's `asideClassName`
  // pattern.
  it("wires the desktop Table and mobile RowCard stack to opposite ends of the 860px breakpoint", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });

    render(<MoneyHistoryPage />);

    const table = await screen.findByRole("table");
    const tableWrapper = table.closest('[class*="860px"]');
    expect(tableWrapper?.className).toContain("max-[860px]:hidden");

    const cards = screen.getByTestId("money-history-row-cards");
    expect(cards.className).toContain("hidden");
    expect(cards.className).toContain("max-[860px]:block");
  });
});

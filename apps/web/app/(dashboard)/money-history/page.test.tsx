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

const listMyProjects = vi.fn();
const createProject = vi.fn();
vi.mock("@/lib/projects", () => ({
  listMyProjects: (...args: unknown[]) => listMyProjects(...args),
  createProject: (...args: unknown[]) => createProject(...args),
  canCreateProject: (role: string | null | undefined) => role === "owner_admin",
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

// spec-quick-add-project-user-modals: this page resolves its own caller's
// role client-side via `getCurrentUser()` (`GET /api/users/me`, already used
// by the Users screen -- no new endpoint) purely to gate the Project
// filter's "+ Add New Project" row. Defaults to `owner_admin` so every
// pre-existing test in this file (none of which cares about quick-add) keeps
// seeing the exact same Project filter behavior as before this spec.
const getCurrentUser = vi.fn();
vi.mock("@/lib/users", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
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
  listMyProjects.mockReset();
  listMyProjects.mockResolvedValue([
    { id: "project-a", name: "Project A", description: null, createdAt: "", updatedAt: "" },
    { id: "project-b", name: "Project B", description: null, createdAt: "", updatedAt: "" },
  ]);
  createProject.mockReset();
  getCurrentUser.mockReset().mockResolvedValue({
    id: "owner-1",
    email: "owner@example.com",
    role: "owner_admin",
    active: true,
    createdAt: new Date().toISOString(),
  });
});

afterEach(() => {
  cleanup();
});

/**
 * Opens the Project filter's Combobox popover (spec-quick-add-project-user-
 * modals: replaced the native `<select id="mh-project">` this whole file
 * used to drive via `userEvent.selectOptions`). Its trigger's accessible
 * NAME is still "Project" (the paired `<label for="mh-project">` wins the
 * accessible-name computation over the button's own displayed-value text,
 * byte-identical to the native `<select>`'s own accessible name before this
 * spec) -- `getByLabelText` finds it exactly as it did before.
 */
function openProjectFilter() {
  return userEvent.click(screen.getByLabelText(/^project$/i));
}

/** Opens the Project filter and picks the row with this exact Project name. */
async function selectProjectFilter(projectName: string) {
  await openProjectFilter();
  await userEvent.click(await screen.findByText(projectName));
}

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
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });

    render(<MoneyHistoryPage />);

    await screen.findByRole("table");
    await waitFor(() => expect(listMyProjects).toHaveBeenCalled());

    await selectProjectFilter("Project B");
    await userEvent.click(screen.getByRole("button", { name: /^filter$/i }));

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
    await waitFor(() => expect(listMyProjects).toHaveBeenCalled());

    // Apply a real filter through the form -- this sets `formFilters`/
    // `appliedFilters` component state, NOT a URL param (Story 5.1's actual
    // shipped pattern -- confirmed by reading the page, not assumed).
    await selectProjectFilter("Project B");
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
    // Its accessible NAME stays "Project" throughout (`openProjectFilter`'s
    // doc comment) -- the selected value is asserted via text content.
    await waitFor(() => expect(screen.getByLabelText(/^project$/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/^project$/i)).toHaveTextContent("Project B");
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

/**
 * spec-partner-project-list-self-access: `?projectId=` URL-seeding -- the
 * sidebar switcher's own deep link for a Partner/Sub-partner (this spec's
 * I/O matrix: "Money History opened directly with `?projectId=X` -- Project
 * filter pre-applies on load"), mirroring `traceType`/`traceId`'s existing
 * URL-driven read (lines ~133-134) except seeded once into the flat-list
 * filter's own local component state, not read fresh on every render.
 */
describe("MoneyHistoryPage -- ?projectId= URL-seeding (spec-partner-project-list-self-access)", () => {
  it("pre-applies the Project filter on load when ?projectId= is present in the URL", async () => {
    mockSearchParams = new URLSearchParams({ projectId: "project-b" });
    getMoneyHistory.mockResolvedValue({ entries: [] });

    render(<MoneyHistoryPage />);

    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-b" })),
    );
    await waitFor(() => expect(listMyProjects).toHaveBeenCalled());
    // Its accessible NAME stays "Project" (`openProjectFilter`'s doc
    // comment) -- the pre-applied selection shows up as text content, once
    // `listMyProjects` resolves and the trigger's displayed-value label
    // catches up.
    await waitFor(() => expect(screen.getByLabelText(/^project$/i)).toHaveTextContent("Project B"));
  });

  it("with no ?projectId= in the URL, the Project filter starts unselected -- unchanged, existing behavior", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [] });

    render(<MoneyHistoryPage />);

    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined })),
    );
    expect(await screen.findByLabelText(/^project$/i)).toHaveTextContent("All Projects");
  });

  it("fetches the Project filter's own options via listMyProjects, not listProjects (self-scoped for a Partner/Sub-partner session)", async () => {
    getMoneyHistory.mockResolvedValue({ entries: [] });

    render(<MoneyHistoryPage />);

    await waitFor(() => expect(listMyProjects).toHaveBeenCalled());
  });

  it("review fix: switching Projects via the sidebar while already on this page (same route, new ?projectId=) re-syncs the filter instead of showing the stale Project", async () => {
    mockSearchParams = new URLSearchParams({ projectId: "project-a" });
    getMoneyHistory.mockResolvedValue({ entries: [] });

    const { rerender } = render(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByLabelText(/^project$/i)).toHaveTextContent("Project A"));

    // Simulate the sidebar switcher's `router.push("/money-history?projectId=project-b")`
    // re-rendering the SAME page instance with a new `useSearchParams()` value
    // (no remount) -- mirrors this file's existing trace-mode `rerender` precedent.
    mockSearchParams = new URLSearchParams({ projectId: "project-b" });
    rerender(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByLabelText(/^project$/i)).toHaveTextContent("Project B"));
    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "project-b" })),
    );
  });

  it("review fix: a filter applied purely through the form (never URL-encoded) survives an unrelated searchParams change (e.g. entering trace mode)", async () => {
    const user = userEvent.setup();
    getMoneyHistory.mockResolvedValue({ entries: [ONE_ENTRY] });

    const { rerender } = render(<MoneyHistoryPage />);

    await screen.findByRole("table");
    await selectProjectFilter("Project B");
    await user.click(screen.getByRole("button", { name: /^filter$/i }));
    await waitFor(() =>
      expect(getMoneyHistory).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "project-b" })),
    );

    // An unrelated searchParams change (no projectId involved either before
    // or after) must not stomp the form-applied filter back to empty.
    mockSearchParams = new URLSearchParams({ traceType: "withdrawal_transaction", traceId: "wd-1" });
    getMoneyTrail.mockResolvedValue({ trail: TRAIL_ROOT, reconciliation: { reconciled: true, discrepancies: [] } });
    rerender(<MoneyHistoryPage />);
    await waitFor(() => expect(screen.getByText("Money Withdrawn")).toBeInTheDocument());

    mockSearchParams = new URLSearchParams();
    rerender(<MoneyHistoryPage />);

    await waitFor(() => expect(screen.getByLabelText(/^project$/i)).toHaveTextContent("Project B"));
  });
});

/**
 * spec-quick-add-project-user-modals: Money History's Project filter --
 * this page has no `role` prop of its own (unlike `SidebarShell`, which gets
 * it straight from `layout.tsx`'s server-side resolve), so it resolves its
 * own caller's role client-side via `getCurrentUser()` (`GET /api/users/me`,
 * already used by the Users screen -- no new endpoint) purely to gate the
 * "+ Add New Project" row.
 */
describe("Money History Project filter quick-add (spec-quick-add-project-user-modals)", () => {
  it("owner_admin: the + Add New Project row renders once role resolves", async () => {
    render(<MoneyHistoryPage />);

    await openProjectFilter();

    expect(await screen.findByText("+ Add New Project")).toBeInTheDocument();
  });

  it.each(["partner", "sub_partner"] as const)("role=%s: the + Add New Project row never renders", async (role) => {
    getCurrentUser.mockResolvedValue({
      id: "user-2",
      email: "person@example.com",
      role,
      active: true,
      createdAt: new Date().toISOString(),
    });
    render(<MoneyHistoryPage />);

    await openProjectFilter();
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalled());

    expect(screen.queryByText("+ Add New Project")).not.toBeInTheDocument();
  });

  it("before role resolves, the + Add New Project row is hidden (the safe default)", async () => {
    let resolveRole!: (value: unknown) => void;
    getCurrentUser.mockReturnValue(
      new Promise((resolve) => {
        resolveRole = resolve;
      }),
    );
    render(<MoneyHistoryPage />);

    await openProjectFilter();
    expect(screen.queryByText("+ Add New Project")).not.toBeInTheDocument();

    resolveRole({
      id: "owner-1",
      email: "owner@example.com",
      role: "owner_admin",
      active: true,
      createdAt: new Date().toISOString(),
    });
    expect(await screen.findByText("+ Add New Project")).toBeInTheDocument();
  });

  it("owner_admin: quick-add creates the Project, refreshes the list, and selects it as formFilters.projectId -- no navigation to /projects/new", async () => {
    createProject.mockResolvedValue({
      id: "project-new",
      name: "Riverside Tower",
      description: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    listMyProjects
      .mockResolvedValueOnce([{ id: "project-a", name: "Project A" }])
      .mockResolvedValueOnce([
        { id: "project-a", name: "Project A" },
        { id: "project-new", name: "Riverside Tower" },
      ]);

    render(<MoneyHistoryPage />);

    await openProjectFilter();
    await userEvent.click(await screen.findByText("+ Add New Project"));
    await userEvent.type(screen.getByLabelText("Name"), "Riverside Tower");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({ name: "Riverside Tower", description: null }),
    );
    // The filter's own trigger now shows the newly created + selected Project
    // as its displayed value -- its accessible NAME stays "Project" (see
    // `openProjectFilter`'s doc comment), so this asserts on the labeled
    // control's own text content, not on a role+name query.
    await waitFor(() => expect(screen.getByLabelText("Project")).toHaveTextContent("Riverside Tower"));
    expect(routerPush).not.toHaveBeenCalledWith(expect.stringContaining("/projects/new"));
  });

  it("search filters the Project list client-side by name", async () => {
    listMyProjects.mockResolvedValue([
      { id: "project-a", name: "Project A" },
      { id: "project-b", name: "Beta Residency" },
    ]);
    render(<MoneyHistoryPage />);

    await openProjectFilter();
    await screen.findByText("Beta Residency");
    await userEvent.type(screen.getByPlaceholderText("Search Projects…"), "beta");

    expect(screen.queryByText("Project A")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Residency")).toBeInTheDocument();
  });
});

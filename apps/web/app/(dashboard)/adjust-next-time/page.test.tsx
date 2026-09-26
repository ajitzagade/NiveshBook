// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdjustNextTimePage from "./page";

const getAdjustNextTime = vi.fn();
const recordAdjustmentNetting = vi.fn();

vi.mock("@/lib/adjust-next-time", () => ({
  getAdjustNextTime: (...args: unknown[]) => getAdjustNextTime(...args),
  recordAdjustmentNetting: (...args: unknown[]) => recordAdjustmentNetting(...args),
}));

function makeInvestmentEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ia-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    requirementId: "req-1",
    shouldPay: "200000",
    actualPaid: "0",
    adjustmentType: "pending",
    adjustmentAmount: "200000",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    personName: "Partner A",
    projectName: "Project A",
    ...overrides,
  };
}

function makeWithdrawalEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "wa-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    canTake: "150000",
    taken: "0",
    adjustmentType: "keep_for_later",
    adjustmentAmount: "150000",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    personName: "Partner A",
    projectName: "Project A",
    ...overrides,
  };
}

beforeEach(() => {
  getAdjustNextTime.mockReset();
  recordAdjustmentNetting.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AdjustNextTimePage (Story 5.3, FR33/FR34)", () => {
  it("shows a loading state, then both sections loaded independently", async () => {
    getAdjustNextTime.mockResolvedValue({
      investmentAdjustments: [makeInvestmentEntry({ adjustmentType: "extra_paid", adjustmentAmount: "200000" })],
      withdrawalAdjustments: [makeWithdrawalEntry({ adjustmentType: "keep_for_later", adjustmentAmount: "150000" })],
      canNet: true,
    });

    render(<AdjustNextTimePage />);

    expect(screen.getByText(/loading adjust next time/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Investment Adjustments")).toBeInTheDocument());
    expect(screen.getByText("Withdrawal Adjustments")).toBeInTheDocument();
    expect(screen.getAllByText(/partner a/i).length).toBeGreaterThan(0);
  });

  // Founder feedback 2026-09-26: `isSub` is wired from each entry's own
  // `partyType` -- a sub_partner card carries the one-hierarchy-level
  // (24px, ml-6) inset, a partner card does not, in BOTH sections.
  it("insets a sub_partner's AdjustPersonCard one hierarchy level (ml-6) while a partner's card stays un-inset", async () => {
    getAdjustNextTime.mockResolvedValue({
      investmentAdjustments: [
        makeInvestmentEntry(),
        makeInvestmentEntry({ id: "ia-2", partyType: "sub_partner", shareId: "sub-1", personName: "Sub S" }),
      ],
      withdrawalAdjustments: [
        makeWithdrawalEntry({ id: "wa-2", partyType: "sub_partner", shareId: "sub-1", personName: "Sub S" }),
      ],
      canNet: true,
    });

    render(<AdjustNextTimePage />);

    await screen.findByText("Partner A — Project A");
    const partnerCard = screen.getByText("Partner A — Project A").parentElement as HTMLElement;
    // One sub card per section -- both must carry the inset.
    const subCards = screen.getAllByText("Sub S — Project A").map((el) => el.parentElement as HTMLElement);
    expect(subCards).toHaveLength(2);
    for (const subCard of subCards) {
      expect(subCard.className).toContain("ml-6");
    }
    expect(partnerCard.className).not.toContain("ml-6");
  });

  it("shows the error state when the fetch fails", async () => {
    getAdjustNextTime.mockRejectedValue(new Error("Boom"));

    render(<AdjustNextTimePage />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Boom"));
  });

  it("shows an independent empty state per section when a section has no rows", async () => {
    getAdjustNextTime.mockResolvedValue({ investmentAdjustments: [], withdrawalAdjustments: [], canNet: true });

    render(<AdjustNextTimePage />);

    await waitFor(() => expect(screen.getByText(/no investment adjustments yet/i)).toBeInTheDocument());
    expect(screen.getByText(/no withdrawal adjustments yet/i)).toBeInTheDocument();
  });

  it("AC1: an Extra Paid row reads 'Next time reduce by ₹X', a Pending row reads 'Next time add ₹X' -- no formula shown", async () => {
    getAdjustNextTime.mockResolvedValue({
      investmentAdjustments: [
        makeInvestmentEntry({
          id: "ia-extra",
          personName: "Partner A",
          adjustmentType: "extra_paid",
          adjustmentAmount: "200000",
        }),
        makeInvestmentEntry({
          id: "ia-pending",
          personName: "Partner C",
          adjustmentType: "pending",
          adjustmentAmount: "200000",
        }),
      ],
      withdrawalAdjustments: [],
      canNet: true,
    });

    render(<AdjustNextTimePage />);

    await waitFor(() => expect(screen.getByText(/next time reduce by/i)).toBeInTheDocument());
    expect(screen.getByText(/next time add/i)).toBeInTheDocument();
  });

  it("AC2/AC3: Investment and Withdrawal sections render independently, never combined into one figure", async () => {
    getAdjustNextTime.mockResolvedValue({
      investmentAdjustments: [makeInvestmentEntry()],
      withdrawalAdjustments: [makeWithdrawalEntry({ personName: "Partner B", adjustmentAmount: "150000" })],
      canNet: true,
    });

    render(<AdjustNextTimePage />);

    await waitFor(() => expect(screen.getByText("Withdrawal Adjustments")).toBeInTheDocument());
    // No combined/summed total anywhere -- neither adjustmentAmount's sum
    // (350000) nor any "Net" figure appears.
    expect(screen.queryByText(/350000|₹3,50,000/)).not.toBeInTheDocument();
  });

  it("Owner/Admin (canNet: true) sees the Net Adjustment action; a non-Owner/Admin viewer (canNet: false) does not", async () => {
    getAdjustNextTime.mockResolvedValue({
      investmentAdjustments: [makeInvestmentEntry()],
      withdrawalAdjustments: [],
      canNet: false,
    });

    render(<AdjustNextTimePage />);

    await waitFor(() => expect(screen.getByText("Investment Adjustments")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /net adjustment/i })).not.toBeInTheDocument();
  });

  it("opens the Net Adjustment dialog showing the Withdrawal Adjustment for context, and saves a netting action", async () => {
    const user = userEvent.setup();
    getAdjustNextTime.mockResolvedValue({
      investmentAdjustments: [makeInvestmentEntry({ id: "ia-1", requirementId: "req-1" })],
      withdrawalAdjustments: [makeWithdrawalEntry({ id: "wa-1" })],
      canNet: true,
    });
    recordAdjustmentNetting.mockResolvedValue({ netting: { id: "netting-1" } });

    render(<AdjustNextTimePage />);

    await waitFor(() => expect(screen.getByRole("button", { name: /net adjustment/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /net adjustment/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/net adjustment — partner a/i)).toBeInTheDocument();
    // The dialog shows the Withdrawal Adjustment for context (Keep for Later).
    expect(within(dialog).getByText(/keep for later/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^amount$/i), "50000");
    await user.type(screen.getByLabelText(/^notes$/i), "Agreed over call");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(recordAdjustmentNetting).toHaveBeenCalledTimes(1));
    const [input] = recordAdjustmentNetting.mock.calls[0] as [Record<string, unknown>, string];
    expect(input).toMatchObject({
      projectId: "project-a",
      partyType: "partner",
      shareId: "partner-1",
      investmentRequirementId: "req-1",
      amount: "50000",
      notes: "Agreed over call",
    });

    // Dialog closes and the list re-fetches after a successful save.
    await waitFor(() => expect(screen.queryByText(/net adjustment — partner a/i)).not.toBeInTheDocument());
    expect(getAdjustNextTime).toHaveBeenCalledTimes(2);
  });

  // Review round 2: `investment_adjustments` has exactly ONE current row per
  // `(partyType, shareId, projectId)` (Story 3.4's unique constraint) -- the
  // SAME person can never have two simultaneous rows at the SAME Project,
  // but CAN genuinely have independent single rows at two DIFFERENT
  // Projects (the real, reachable version of "this person has more than one
  // Investment Adjustment row"). This test seeds exactly that -- two rows
  // for "Partner A" at two different Projects, both showing the identical
  // "Pending ₹50,000" adjustment (so the dialog's title is the ONLY thing
  // that could disambiguate them) -- opens the dialog on the SECOND row
  // specifically, and asserts the saved netting carries THAT row's own
  // projectId/investmentRequirementId, not the first row's. Directly
  // validates the dialog title now showing `projectName` (review fix) and
  // proves each row's "Net Adjustment" button closes over its own data.
  it("a person with independent Investment Adjustment rows at two DIFFERENT Projects: opening the dialog on the SECOND row nets THAT row's own Project/requirement, not the first's", async () => {
    const user = userEvent.setup();
    getAdjustNextTime.mockResolvedValue({
      investmentAdjustments: [
        makeInvestmentEntry({
          id: "ia-project-a",
          projectId: "project-a",
          projectName: "Project A",
          requirementId: "req-a",
          adjustmentType: "pending",
          adjustmentAmount: "50000",
        }),
        makeInvestmentEntry({
          id: "ia-project-b",
          projectId: "project-b",
          projectName: "Project B",
          requirementId: "req-b",
          adjustmentType: "pending",
          adjustmentAmount: "50000",
        }),
      ],
      withdrawalAdjustments: [],
      canNet: true,
    });
    recordAdjustmentNetting.mockResolvedValue({ netting: { id: "netting-1" } });

    render(<AdjustNextTimePage />);

    const nettingButtons = await waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: /net adjustment/i });
      expect(buttons).toHaveLength(2);
      return buttons;
    });

    // Open the dialog from the SECOND row (Project B), not the first.
    await user.click(nettingButtons[1] as HTMLElement);

    const dialog = screen.getByRole("dialog");
    // The dialog title now identifies the Project too -- the only visible
    // disambiguator, since both rows share the same person/adjustment text.
    expect(within(dialog).getByText(/net adjustment — partner a · project b/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^amount$/i), "50000");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(recordAdjustmentNetting).toHaveBeenCalledTimes(1));
    const [input] = recordAdjustmentNetting.mock.calls[0] as [Record<string, unknown>, string];
    expect(input).toMatchObject({
      projectId: "project-b",
      investmentRequirementId: "req-b",
    });
  });

  it("shows a server-reported error inline in the dialog without closing it", async () => {
    const user = userEvent.setup();
    getAdjustNextTime.mockResolvedValue({
      investmentAdjustments: [makeInvestmentEntry()],
      withdrawalAdjustments: [],
      canNet: true,
    });
    recordAdjustmentNetting.mockRejectedValue(new Error("Those adjustments no longer exist."));

    render(<AdjustNextTimePage />);

    await waitFor(() => expect(screen.getByRole("button", { name: /net adjustment/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /net adjustment/i }));
    await user.type(screen.getByLabelText(/^amount$/i), "50000");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no longer exist/i));
    // Dialog stays open on error.
    expect(screen.getByLabelText(/^amount$/i)).toBeInTheDocument();
  });
});

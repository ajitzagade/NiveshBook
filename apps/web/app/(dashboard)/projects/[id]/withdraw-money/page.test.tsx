// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PartnerCanTake, PartnerWithdrawalAdjustment } from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import type { CanTakeResponse } from "@/lib/can-take";
import type { WithdrawalTransactionsResponse } from "@/lib/withdrawal-transactions";
import type { WithdrawalAdjustmentsResponse } from "@/lib/withdrawal-adjustments";
import WithdrawMoneyPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-1" }),
}));

const getCanTake = vi.fn();

vi.mock("@/lib/can-take", () => ({
  getCanTake: (...args: unknown[]) => getCanTake(...args),
}));

const listWithdrawalTransactions = vi.fn();
const recordWithdrawalTransaction = vi.fn();

vi.mock("@/lib/withdrawal-transactions", () => ({
  listWithdrawalTransactions: (...args: unknown[]) => listWithdrawalTransactions(...args),
  recordWithdrawalTransaction: (...args: unknown[]) => recordWithdrawalTransaction(...args),
}));

/** Story 4.3: the Withdrawal Adjustment fetch -- mocked so every existing test in this file (which never asserts on adjustment chips) keeps resolving to "nothing to show" rather than an unmocked real `fetch` call. */
const getWithdrawalAdjustments = vi.fn();

vi.mock("@/lib/withdrawal-adjustments", () => ({
  getWithdrawalAdjustments: (...args: unknown[]) => getWithdrawalAdjustments(...args),
}));

const EMPTY_ADJUSTMENTS_RESPONSE: WithdrawalAdjustmentsResponse = { partners: [] };

const PARTNER_WITH_SUBS: PartnerCanTake = {
  partnerId: "a",
  name: "A",
  sharePercent: "50" as Percent,
  canTake: "250000" as Money,
  ownCanTake: "125000" as Money,
  subPartners: [
    {
      subPartnerId: "sub1",
      name: "Sub1",
      sharePercent: "12.5" as Percent,
      canTake: "62500" as Money,
    },
    {
      subPartnerId: "sub2",
      name: "Sub2",
      sharePercent: "12.5" as Percent,
      canTake: "62500" as Money,
    },
  ],
};

const PARTNER_NO_SUBS: PartnerCanTake = {
  partnerId: "b",
  name: "B",
  sharePercent: "50" as Percent,
  canTake: "250000" as Money,
  ownCanTake: "250000" as Money,
  subPartners: [],
};

const CAN_TAKE_RESPONSE: CanTakeResponse = {
  availableToWithdraw: "500000" as Money,
  partners: [PARTNER_WITH_SUBS, PARTNER_NO_SUBS],
};

const EMPTY_WITHDRAWALS_RESPONSE: WithdrawalTransactionsResponse = { transactions: [] };

/**
 * `screen.getByText` only matches a node whose own text isn't split across
 * child elements -- mirrors `AddMoneyPage`'s identical `findParagraphContaining`
 * helper (spec-3-2's page test), needed here for the worked-example hint's
 * `<Amount>`-interleaved text.
 */
function findParagraphContaining(text: string): HTMLElement {
  return screen.getByText((_, element) => {
    if (element?.tagName !== "P") return false;
    return (element.textContent ?? "").includes(text);
  });
}

describe("WithdrawMoneyPage (Story 4.1)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state before the fetch resolves", () => {
    getCanTake.mockReturnValue(new Promise(() => {}));

    render(<WithdrawMoneyPage />);

    expect(screen.getByText("Loading Can Take…")).toBeInTheDocument();
  });

  it("renders the Can Take breakdown once loaded, incl. the pooled total vs. retained Own figure for a Partner with Sub-partners", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("↳ Sub1")).toBeInTheDocument();
    expect(screen.getByText("↳ Sub2")).toBeInTheDocument();
    // A's own retained figure (₹1,25,000) is called out distinctly from their
    // pooled canTake total (₹2,50,000) -- never the same number reused for both.
    expect(findParagraphContaining("Own:")).toHaveTextContent("₹1,25,000");
  });

  it("renders the worked-example hint at point of use, not a hover tooltip", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    const hint = findParagraphContaining("A's normal Can Take is");
    expect(hint).toHaveTextContent("Share 50% means if");
    expect(hint).toHaveTextContent("A's normal Can Take is");
  });

  it("shows an empty state when the Project has no Partner Shares yet", async () => {
    getCanTake.mockResolvedValue({ availableToWithdraw: "0", partners: [] });

    render(<WithdrawMoneyPage />);

    await screen.findByText("No Partner Shares yet");
  });

  it("renders the 409 precondition's plain-language message, not a number", async () => {
    getCanTake.mockRejectedValue(
      new Error("Can Take isn't available until Partner Shares total 100%."),
    );

    render(<WithdrawMoneyPage />);

    await screen.findByRole("alert");
    expect(
      screen.getByText("Can Take isn't available until Partner Shares total 100%."),
    ).toBeInTheDocument();
  });
});

function makePartnerAdjustment(
  overrides: Partial<PartnerWithdrawalAdjustment> = {},
): PartnerWithdrawalAdjustment {
  return {
    partnerId: "a",
    name: "A",
    sharePercent: "50" as Percent,
    canTake: "250000" as Money,
    taken: "0" as Money,
    adjustmentType: "keep_for_later",
    adjustmentAmount: "250000" as Money,
    subPartners: [],
    ...overrides,
  };
}

/**
 * Story 4.3: the Withdrawal Adjustment chip shown alongside each Partner/
 * Sub-partner's Can Take row -- mirrors Add Money's Investment Adjustment
 * chip coverage one ledger over, per this story's Decisions chip mapping
 * (`keep_for_later` -> violet, `extra_taken` -> danger, `none` -> neutral).
 */
describe("WithdrawMoneyPage -- Withdrawal Adjustment chip (Story 4.3)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    getWithdrawalAdjustments.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a Keep for Later chip with its amount for Partner B", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValue({
      partners: [
        makePartnerAdjustment({
          partnerId: "b",
          name: "B",
          adjustmentType: "keep_for_later",
          adjustmentAmount: "90000" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    expect(await screen.findByText("Keep for Later")).toBeInTheDocument();
    expect(screen.getByText("₹90,000")).toBeInTheDocument();
  });

  it("renders an Extra Taken chip with its amount when Taken exceeds Can Take", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValue({
      partners: [
        makePartnerAdjustment({
          partnerId: "b",
          name: "B",
          adjustmentType: "extra_taken",
          adjustmentAmount: "150000" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    expect(await screen.findByText("Extra Taken")).toBeInTheDocument();
    expect(screen.getByText("₹1,50,000")).toBeInTheDocument();
  });

  it("renders a No Adjustment chip with no amount when Taken exactly matches Can Take", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValue({
      partners: [
        makePartnerAdjustment({
          partnerId: "b",
          name: "B",
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    expect(await screen.findByText("No Adjustment")).toBeInTheDocument();
  });

  it("renders no chip while the adjustments fetch hasn't resolved yet (secondary enrichment, never blocking)", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockReturnValue(new Promise(() => {}));

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    expect(screen.queryByText("Keep for Later")).not.toBeInTheDocument();
    expect(screen.queryByText("Extra Taken")).not.toBeInTheDocument();
    expect(screen.queryByText("No Adjustment")).not.toBeInTheDocument();
  });

  it("renders each Sub-partner's own Withdrawal Adjustment chip under their own row, never swapped with a sibling Sub-partner's (findSubPartnerAdjustment)", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValue({
      partners: [
        makePartnerAdjustment({
          partnerId: "a",
          name: "A",
          subPartners: [
            {
              subPartnerId: "sub1",
              name: "Sub1",
              sharePercent: "12.5" as Percent,
              canTake: "62500" as Money,
              taken: "0" as Money,
              adjustmentType: "keep_for_later",
              adjustmentAmount: "20000" as Money,
            },
            {
              subPartnerId: "sub2",
              name: "Sub2",
              sharePercent: "12.5" as Percent,
              canTake: "62500" as Money,
              taken: "70000" as Money,
              adjustmentType: "extra_taken",
              adjustmentAmount: "7500" as Money,
            },
          ],
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    const sub1Row = screen.getByText("↳ Sub1").closest("div")?.parentElement as HTMLElement;
    const sub2Row = screen.getByText("↳ Sub2").closest("div")?.parentElement as HTMLElement;

    expect(within(sub1Row).getByText("Keep for Later")).toBeInTheDocument();
    expect(within(sub1Row).getByText("₹20,000")).toBeInTheDocument();
    expect(within(sub1Row).queryByText("Extra Taken")).not.toBeInTheDocument();

    expect(within(sub2Row).getByText("Extra Taken")).toBeInTheDocument();
    expect(within(sub2Row).getByText("₹7,500")).toBeInTheDocument();
    expect(within(sub2Row).queryByText("Keep for Later")).not.toBeInTheDocument();
  });

  it("renders No Adjustment (never a spurious Keep for Later amount) for a Partner/Sub-partner whose Can Take -- and Taken -- are both exactly zero, matching computeWithdrawalAdjustment's equal-case (`none`) branch", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValue({
      partners: [
        makePartnerAdjustment({
          partnerId: "b",
          name: "B",
          canTake: "0" as Money,
          taken: "0" as Money,
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    expect(await screen.findByText("No Adjustment")).toBeInTheDocument();
    expect(screen.queryByText("₹0")).not.toBeInTheDocument();
    expect(screen.queryByText("Keep for Later")).not.toBeInTheDocument();
  });
});

async function renderAndReady() {
  const user = userEvent.setup();
  getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
  render(<WithdrawMoneyPage />);
  await screen.findByText("A");
  return user;
}

function makeWithdrawalTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "wtx-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50",
    canTakeSnapshot: "250000",
    amount: "100000",
    transactionDate: "2026-10-05",
    paymentMode: "cash",
    referenceNumber: null,
    notes: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * The recorded-withdrawals list persists across reload (Story 4.2, closing
 * Review Triage Log row 1) -- backed by a real `listWithdrawalTransactions`
 * fetch on page load, not purely client-accumulated state.
 */
describe("WithdrawMoneyPage -- recorded-withdrawals list persists across reload (Story 4.2, row 1)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset();
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a previously-recorded withdrawal fetched on page load, without any user action", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue({
      transactions: [
        makeWithdrawalTransaction({ partyType: "partner", shareId: "a", amount: "100000" }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    await waitFor(() => {
      expect(listWithdrawalTransactions).toHaveBeenCalledWith("project-1");
    });
    expect(await screen.findByText("2026-10-05")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
  });
});

describe("WithdrawMoneyPage -- Record Withdrawal dialog (Story 4.2)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    recordWithdrawalTransaction.mockReset();
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the dialog with the Amount format-hint Helper text (row 5 regression -- matches Add Money's identical field)", async () => {
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);

    expect(await screen.findByText(/e\.g\. 1000000 for ₹10,00,000/)).toBeInTheDocument();
  });

  it("records a withdrawal successfully and refreshes the recorded-withdrawals list and the Withdrawal Adjustment chip", async () => {
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ amount: "100000" }));
    const user = await renderAndReady();

    // Initial page-load fetch (inside renderAndReady) already consumed the
    // default empty-list/empty-adjustments mocks -- queue the post-save
    // refresh's responses separately so the assertions below can prove a
    // *second* fetch actually happened and actually changed what's
    // rendered, not just that recordWithdrawalTransaction was called.
    expect(listWithdrawalTransactions).toHaveBeenCalledTimes(1);
    expect(getWithdrawalAdjustments).toHaveBeenCalledTimes(1);
    listWithdrawalTransactions.mockResolvedValueOnce({
      transactions: [makeWithdrawalTransaction({ amount: "100000" })],
    });
    getWithdrawalAdjustments.mockResolvedValueOnce({
      partners: [
        makePartnerAdjustment({
          partnerId: "a",
          name: "A",
          adjustmentType: "keep_for_later",
          adjustmentAmount: "150000" as Money,
        }),
      ],
    });

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    expect(recordWithdrawalTransaction).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ partyType: "partner", shareId: "a", amount: "100000" }),
      expect.any(String),
    );

    // The "refreshes" behavior this test is named for: a second
    // listWithdrawalTransactions fetch actually fires after save, and its
    // result (the newly-recorded ₹1,00,000 withdrawal) actually renders.
    await waitFor(() => {
      expect(listWithdrawalTransactions).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("2026-10-05")).toBeInTheDocument();
    expect(screen.getByText("₹1,00,000")).toBeInTheDocument();

    // Story 4.3: `handleRecordWithdrawalSubmit` also calls `refreshAdjustments()`
    // -- a second getWithdrawalAdjustments fetch fires after save, and its
    // result (the updated Keep for Later chip) actually renders.
    await waitFor(() => {
      expect(getWithdrawalAdjustments).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Keep for Later")).toBeInTheDocument();
    expect(screen.getByText("₹1,50,000")).toBeInTheDocument();
  });

  it("renders a validation/server error inside the dialog on failure, without closing it", async () => {
    recordWithdrawalTransaction.mockRejectedValue(new Error("Amount must be a non-negative number."));
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "-500" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("alert");
    expect(screen.getByText("Amount must be a non-negative number.")).toBeInTheDocument();
  });

  it("renders the stale-share 404 error from the server inside the dialog (row 7 regression -- a share removed while the dialog was already open)", async () => {
    recordWithdrawalTransaction.mockRejectedValue(
      new Error("No current Partner or Sub-partner Share matches that id."),
    );
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No current Partner or Sub-partner Share matches that id.");
    // The dialog itself stays open/rendered (the Save button is still present) --
    // the 404 surfaces as an inline error, not a page-level crash.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

describe("WithdrawMoneyPage -- Record Withdrawal idempotency key reuse across a retry (Story 4.2)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    recordWithdrawalTransaction.mockReset();
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
  });

  afterEach(() => {
    cleanup();
  });

  it("sends the SAME idempotencyKey on a retry after a failed submission, not a fresh one", async () => {
    recordWithdrawalTransaction
      .mockRejectedValueOnce(new Error("Network error -- please try again."))
      .mockResolvedValueOnce(makeWithdrawalTransaction({ amount: "100000" }));

    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(2);
    });

    const firstCallKey = recordWithdrawalTransaction.mock.calls[0]?.[2] as string;
    const secondCallKey = recordWithdrawalTransaction.mock.calls[1]?.[2] as string;

    expect(typeof firstCallKey).toBe("string");
    expect(firstCallKey.length).toBeGreaterThan(0);
    expect(secondCallKey).toBe(firstCallKey);
  });

  it("mints a NEW idempotencyKey for a genuinely new submission (dialog closed and reopened)", async () => {
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ amount: "100000" }));

    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-06" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(2);
    });

    const firstCallKey = recordWithdrawalTransaction.mock.calls[0]?.[2] as string;
    const secondCallKey = recordWithdrawalTransaction.mock.calls[1]?.[2] as string;
    expect(secondCallKey).not.toBe(firstCallKey);
  });
});

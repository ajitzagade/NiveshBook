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
import WithdrawMoneyPage, {
  digitsToInt,
  scaleMoneyForCompare,
  exceedsCanTake,
  excessOverCanTake,
} from "./page";

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

/**
 * Story 4.5 (FR25): direct unit coverage for the page's hand-rolled,
 * client-side decimal-safe money helpers -- exercised only indirectly
 * elsewhere (via round-number page tests), so the edge cases their own doc
 * comments describe (malformed/mid-edit input, two-decimal amounts, a
 * >12-digit value) are asserted here directly instead.
 */
describe("withdraw-money/page money helpers (Story 4.5)", () => {
  describe("digitsToInt", () => {
    it("accumulates a plain digit string", () => {
      expect(digitsToInt("250000")).toBe(250000);
    });

    it("returns 0 for an empty string (no digits to accumulate)", () => {
      expect(digitsToInt("")).toBe(0);
    });
  });

  describe("scaleMoneyForCompare", () => {
    it("scales a whole-rupee amount by 100", () => {
      expect(scaleMoneyForCompare("250000")).toBe(25000000);
    });

    it("scales a two-decimal amount exactly", () => {
      expect(scaleMoneyForCompare("1234.56")).toBe(123456);
    });

    it("scales a single-decimal amount as if right-padded with a trailing 0", () => {
      expect(scaleMoneyForCompare("10.5")).toBe(1050);
    });

    it("returns 0 for an empty string (mid-edit, nothing typed yet)", () => {
      expect(scaleMoneyForCompare("")).toBe(0);
    });

    it("returns 0 for a trailing-dot value (mid-edit, e.g. \"12.\")", () => {
      expect(scaleMoneyForCompare("12.")).toBe(0);
    });

    it("returns 0 for a non-numeric string", () => {
      expect(scaleMoneyForCompare("abc")).toBe(0);
    });

    it("scales a 12-digit whole-number amount (the maximum accepted width)", () => {
      expect(scaleMoneyForCompare("999999999999")).toBe(99999999999900);
    });

    it("returns 0 for a value wider than 12 whole-number digits, matching the server's own toMoney cap", () => {
      expect(scaleMoneyForCompare("1000000000000")).toBe(0);
    });
  });

  describe("exceedsCanTake", () => {
    it("is false when the amount is within Can Take", () => {
      expect(exceedsCanTake("200000", "250000" as Money)).toBe(false);
    });

    it("is false for an exact match (not \"exceeds\")", () => {
      expect(exceedsCanTake("250000", "250000" as Money)).toBe(false);
    });

    it("is true when the amount exceeds Can Take", () => {
      expect(exceedsCanTake("300000", "250000" as Money)).toBe(true);
    });

    it("is true for a two-decimal amount that exceeds Can Take by a fractional amount", () => {
      expect(exceedsCanTake("250000.01", "250000" as Money)).toBe(true);
    });

    it("is false for malformed/mid-edit input -- never spuriously 'exceeds' (client-side UX nicety only)", () => {
      expect(exceedsCanTake("", "250000" as Money)).toBe(false);
      expect(exceedsCanTake("12.", "250000" as Money)).toBe(false);
    });
  });

  describe("excessOverCanTake", () => {
    it("computes the exact excess for a whole-rupee over-cap amount", () => {
      expect(excessOverCanTake("300000", "250000" as Money)).toBe("50000");
    });

    it("computes the exact excess for a two-decimal over-cap amount", () => {
      expect(excessOverCanTake("250050.75", "250000" as Money)).toBe("50.75");
    });

    it("clamps at 0 for malformed/mid-edit input rather than a negative or NaN value", () => {
      expect(excessOverCanTake("", "250000" as Money)).toBe("0");
      expect(excessOverCanTake("12.", "250000" as Money)).toBe("0");
    });

    it("clamps at 0 when the amount doesn't actually exceed canTake", () => {
      expect(excessOverCanTake("200000", "250000" as Money)).toBe("0");
    });
  });
});

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
    const chip = (await screen.findByText("Keep for Later")).closest("span") as HTMLElement;
    // Scoped to the chip itself (not the page as a whole) -- Story 4.4's
    // separate Recommended Available Withdrawal line legitimately renders
    // the same ₹90,000 figure elsewhere on the row (they algebraically
    // coincide for `keep_for_later`), so a page-wide `getByText` is
    // ambiguous now; the chip's own amount is what this test is about.
    expect(within(chip).getByText("₹90,000")).toBeInTheDocument();
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
    // Scoped to the chip itself, not the whole sub1Row -- Story 4.4's
    // separate Recommended Available Withdrawal line also renders ₹20,000
    // on this same row (they algebraically coincide for `keep_for_later`),
    // so a row-wide lookup is ambiguous now.
    const sub1Chip = within(sub1Row).getByText("Keep for Later").closest("span") as HTMLElement;
    expect(within(sub1Chip).getByText("₹20,000")).toBeInTheDocument();
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
    const chip = (await screen.findByText("No Adjustment")).closest("span") as HTMLElement;
    // Scoped to the chip itself -- Story 4.4's separate Recommended Available
    // Withdrawal line legitimately renders "₹0" elsewhere on this row for
    // adjustmentType "none" (AC3's "nothing further recommended" case), so a
    // page-wide `queryByText("₹0")` is no longer a valid proxy for "the chip
    // shows no spurious amount"; this test's actual intent (see its title).
    expect(within(chip).queryByText("₹0")).not.toBeInTheDocument();
    expect(screen.queryByText("Keep for Later")).not.toBeInTheDocument();
  });
});

/**
 * Story 4.4 (FR24): the Recommended Available Withdrawal line shown next to
 * the Withdrawal Adjustment chip -- `recommendedWithdrawalFor` derived
 * entirely from the already-fetched Story 4.3 adjustment (no new fetch, no
 * new API), covering all three `adjustmentType` values plus the
 * not-yet-loaded case per this story's Intent.
 */
describe("WithdrawMoneyPage -- Recommended Available Withdrawal (Story 4.4)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    getWithdrawalAdjustments.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("recommends the Keep for Later amount when adjustmentType is keep_for_later", async () => {
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
    expect(await findParagraphContaining("Recommended Available Withdrawal:")).toHaveTextContent(
      "₹90,000",
    );
  });

  it("recommends 0 when adjustmentType is extra_taken -- nothing further until back under entitlement", async () => {
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
    expect(await findParagraphContaining("Recommended Available Withdrawal:")).toHaveTextContent("₹0");
  });

  it("renders no Recommended Available Withdrawal line when adjustmentType is none -- restating a figure the No Adjustment chip already implies adds no information (orchestrator-authorized refinement, 2026-09-24)", async () => {
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
    await screen.findByText("No Adjustment");
    expect(screen.queryByText(/Recommended Available Withdrawal/)).not.toBeInTheDocument();
  });

  it("renders no Recommended Available Withdrawal line while the adjustments fetch hasn't resolved yet (never a misleading ₹0)", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockReturnValue(new Promise(() => {}));

    render(<WithdrawMoneyPage />);

    await screen.findByText("A");
    expect(screen.queryByText(/Recommended Available Withdrawal/)).not.toBeInTheDocument();
  });

  it("renders each Sub-partner's own Recommended Available Withdrawal line under their own row, never swapped with a sibling's (mirrors Story 4.3's findSubPartnerAdjustment chip coverage)", async () => {
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

    // Sub1 (keep_for_later): recommends its Keep for Later amount.
    expect(
      within(sub1Row).getByText((_, element) => {
        if (element?.tagName !== "P") return false;
        return (element.textContent ?? "").includes("Recommended Available Withdrawal:");
      }),
    ).toHaveTextContent("₹20,000");

    // Sub2 (extra_taken): recommends 0, never Sub1's ₹20,000.
    expect(
      within(sub2Row).getByText((_, element) => {
        if (element?.tagName !== "P") return false;
        return (element.textContent ?? "").includes("Recommended Available Withdrawal:");
      }),
    ).toHaveTextContent("₹0");
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
    // Scoped to the chip itself -- Story 4.4's separate Recommended
    // Available Withdrawal line also renders ₹1,50,000 on this same row
    // (they algebraically coincide for `keep_for_later`), so a page-wide
    // lookup is ambiguous now.
    const chip = (await screen.findByText("Keep for Later")).closest("span") as HTMLElement;
    expect(within(chip).getByText("₹1,50,000")).toBeInTheDocument();
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

/**
 * Story 4.5 (FR25): the "Authorize Extra Withdrawal?" confirmation dialog,
 * opened when the Record Withdrawal form's amount exceeds the target's live
 * Can Take. Partner A's Can Take is 2,50,000 throughout (`PARTNER_WITH_SUBS`
 * above) -- 3,00,000 exceeds it by 50,000.
 */
describe("WithdrawMoneyPage -- Authorize Extra Withdrawal confirmation dialog (Story 4.5)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    recordWithdrawalTransaction.mockReset();
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
  });

  afterEach(() => {
    cleanup();
  });

  it("submits immediately (no confirmation dialog) when the amount is within Can Take", async () => {
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ amount: "100000" }));
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    expect(recordWithdrawalTransaction).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ amount: "100000", extraWithdrawalAuthorized: false }),
      expect.any(String),
    );
    expect(screen.queryByText("Authorize Extra Withdrawal?")).not.toBeInTheDocument();
  });

  it("intercepts the submit and opens the confirmation dialog when the amount exceeds Can Take -- no API call yet", async () => {
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Authorize Extra Withdrawal?")).toBeInTheDocument();
    expect(recordWithdrawalTransaction).not.toHaveBeenCalled();
  });

  it("over-cap amount -> confirm dialog -> confirm -> success (extraWithdrawalAuthorized: true)", async () => {
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ amount: "300000" }));
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Authorize Extra Withdrawal?");
    await user.click(screen.getByRole("button", { name: "Confirm Authorization" }));

    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    expect(recordWithdrawalTransaction).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ amount: "300000", extraWithdrawalAuthorized: true }),
      expect.any(String),
    );
    await waitFor(() => {
      expect(screen.queryByText("Authorize Extra Withdrawal?")).not.toBeInTheDocument();
    });
  });

  it("over-cap amount -> confirm dialog -> cancel (Back) -> no submission, Record Withdrawal dialog stays open", async () => {
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Authorize Extra Withdrawal?");
    await user.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.queryByText("Authorize Extra Withdrawal?")).not.toBeInTheDocument();
    });
    expect(recordWithdrawalTransaction).not.toHaveBeenCalled();
    // The Record Withdrawal dialog underneath is still open, values intact.
    expect(screen.getByLabelText("Amount")).toHaveValue("300000");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("renders the 403 error from the server inside the confirmation dialog on failure, without closing it", async () => {
    recordWithdrawalTransaction.mockRejectedValue(
      new Error("You don't have permission to do that."),
    );
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Authorize Extra Withdrawal?");
    await user.click(screen.getByRole("button", { name: "Confirm Authorization" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You don't have permission to do that.");
    expect(screen.getByText("Authorize Extra Withdrawal?")).toBeInTheDocument();
  });

  it("does not intercept an exact-match amount (amount === Can Take) -- submits immediately, no confirmation dialog", async () => {
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ amount: "250000" }));
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "250000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Authorize Extra Withdrawal?")).not.toBeInTheDocument();
  });

  it("renders the exact 'exceeds by ₹X' excess-amount text (excessOverCanTake's output, not just the boolean exceedsCanTake check)", async () => {
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Authorize Extra Withdrawal?");
    // Can Take is ₹2,50,000, amount is ₹3,00,000 -- excessOverCanTake computes
    // exactly ₹50,000, distinct from either of those two figures.
    expect(findParagraphContaining("by ₹50,000")).toBeInTheDocument();
  });

  it("sends extraWithdrawalAuthorized: true on a within-Can-Take request with no special effect -- the client just passes the flag through, it never re-checks the amount at confirm time", async () => {
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ amount: "100000" }));
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Record Withdrawal" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Authorize Extra Withdrawal?");

    // Edit the amount back down to within Can Take while the confirmation
    // dialog is still open underneath (its values are shared, live state),
    // then confirm anyway.
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100000" } });
    await user.click(screen.getByRole("button", { name: "Confirm Authorization" }));

    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    expect(recordWithdrawalTransaction).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ amount: "100000", extraWithdrawalAuthorized: true }),
      expect.any(String),
    );
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

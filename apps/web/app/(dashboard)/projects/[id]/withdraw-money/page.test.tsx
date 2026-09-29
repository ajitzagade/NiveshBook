// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PartnerWithdrawalAdjustment } from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import type { CanTakeResponse, PartnerCanTakeWithEffective } from "@/lib/can-take";
import type { WithdrawalTransactionsResponse } from "@/lib/withdrawal-transactions";
import type { WithdrawalAdjustmentsResponse } from "@/lib/withdrawal-adjustments";
import { WithdrawalReallocationsForbiddenError } from "@/lib/withdrawal-reallocations";
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
const editWithdrawalTransaction = vi.fn();
const cancelWithdrawalTransaction = vi.fn();

vi.mock("@/lib/withdrawal-transactions", () => ({
  listWithdrawalTransactions: (...args: unknown[]) => listWithdrawalTransactions(...args),
  recordWithdrawalTransaction: (...args: unknown[]) => recordWithdrawalTransaction(...args),
  editWithdrawalTransaction: (...args: unknown[]) => editWithdrawalTransaction(...args),
  cancelWithdrawalTransaction: (...args: unknown[]) => cancelWithdrawalTransaction(...args),
}));

/** Story 4.3: the Withdrawal Adjustment fetch -- mocked so every existing test in this file (which never asserts on adjustment chips) keeps resolving to "nothing to show" rather than an unmocked real `fetch` call. */
const getWithdrawalAdjustments = vi.fn();

vi.mock("@/lib/withdrawal-adjustments", () => ({
  getWithdrawalAdjustments: (...args: unknown[]) => getWithdrawalAdjustments(...args),
}));

/**
 * Story 4.7: the destination-allocation dialog opens automatically right
 * after every successful Record Withdrawal save (`openAllocationDialog`) --
 * mocked so every pre-existing test in this file (most of which never
 * interact with that dialog at all) never makes an unmocked real `fetch`
 * call to `GET /api/projects`/`POST .../destination-allocations`.
 */
const listProjects = vi.fn();
const createProject = vi.fn();
const recordDestinationAllocation = vi.fn();

vi.mock("@/lib/projects", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
  createProject: (...args: unknown[]) => createProject(...args),
}));

vi.mock("@/lib/withdrawal-destination-allocations", () => ({
  recordDestinationAllocation: (...args: unknown[]) => recordDestinationAllocation(...args),
}));

/**
 * Story 4.8 (FR28): a "project" leg's destination-requirement/Share pickers
 * -- fetched lazily once a "project" leg names a destination Project.
 * Mocked so every pre-existing test in this file (none of which pick a
 * "project" leg's requirement/Share) never makes an unmocked real `fetch`
 * call; tests that DO exercise a "project" leg set their own resolved
 * values.
 */
const listInvestmentRequirements = vi.fn();
const listPartnerShares = vi.fn();
const listSubPartnerShares = vi.fn();

vi.mock("@/lib/investment-requirements", () => ({
  listInvestmentRequirements: (...args: unknown[]) => listInvestmentRequirements(...args),
}));

vi.mock("@/lib/partner-shares", () => ({
  listPartnerShares: (...args: unknown[]) => listPartnerShares(...args),
}));

vi.mock("@/lib/subpartner-shares", () => ({
  listSubPartnerShares: (...args: unknown[]) => listSubPartnerShares(...args),
}));

/**
 * Flexible pro-rata withdrawal reallocation ("Skip this round") -- the
 * endpoint is Owner/Admin-only, so a real (non-Owner/Admin) session would
 * 403 on every page load. Defaults every existing test in this file (none
 * of which exercise this feature) to that exact real-world "forbidden"
 * outcome via the top-level `beforeEach` below -- hides the Skip buttons/
 * Active Reallocations panel entirely, the same as before this feature
 * existed, rather than changing any pre-existing test's rendered button set.
 * Dedicated tests for this feature override it to `"loaded"`.
 */
const listWithdrawalReallocations = vi.fn();
const createWithdrawalReallocation = vi.fn();
const cancelWithdrawalReallocation = vi.fn();
const previewWithdrawalReallocation = vi.fn();

vi.mock("@/lib/withdrawal-reallocations", () => {
  class WithdrawalReallocationsForbiddenError extends Error {}
  return {
    listWithdrawalReallocations: (...args: unknown[]) => listWithdrawalReallocations(...args),
    createWithdrawalReallocation: (...args: unknown[]) => createWithdrawalReallocation(...args),
    cancelWithdrawalReallocation: (...args: unknown[]) => cancelWithdrawalReallocation(...args),
    previewWithdrawalReallocation: (...args: unknown[]) => previewWithdrawalReallocation(...args),
    WithdrawalReallocationsForbiddenError,
  };
});

beforeEach(() => {
  listWithdrawalReallocations.mockReset().mockRejectedValue(new WithdrawalReallocationsForbiddenError());
  createWithdrawalReallocation.mockReset();
  cancelWithdrawalReallocation.mockReset();
  // Never resolves by default (a pending promise) -- the 400ms-debounced
  // preview fires in the background of most tests (any Skip dialog open),
  // and none of the pre-existing tests assert on it; a never-resolving
  // promise means it just stays "loading" quietly rather than a test
  // needing to explicitly wait it out or risk an unmocked-call crash.
  previewWithdrawalReallocation.mockReset().mockImplementation(() => new Promise(() => {}));
});

const EMPTY_ADJUSTMENTS_RESPONSE: WithdrawalAdjustmentsResponse = { partners: [] };

const PARTNER_WITH_SUBS: PartnerCanTakeWithEffective = {
  partnerId: "a",
  name: "Partner A",
  sharePercent: "50" as Percent,
  canTake: "250000" as Money,
  effectiveCanTake: "250000" as Money,
  ownCanTake: "125000" as Money,
  subPartners: [
    {
      subPartnerId: "sub1",
      name: "Sub1",
      sharePercent: "12.5" as Percent,
      canTake: "62500" as Money,
      effectiveCanTake: "62500" as Money,
    },
    {
      subPartnerId: "sub2",
      name: "Sub2",
      sharePercent: "12.5" as Percent,
      canTake: "62500" as Money,
      effectiveCanTake: "62500" as Money,
    },
  ],
};

const PARTNER_NO_SUBS: PartnerCanTakeWithEffective = {
  partnerId: "b",
  name: "Partner B",
  sharePercent: "50" as Percent,
  canTake: "250000" as Money,
  effectiveCanTake: "250000" as Money,
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
 * Every Partner/Sub-partner `PersonCard` on this page now starts
 * collapsed (2026-09-29, founder feedback) -- most of this file's
 * existing coverage is about content that only renders once expanded
 * (buttons, recorded withdrawals, nested Sub-partner cards). Rather than
 * add an expand step to every one of those tests individually, this
 * helper expands everything up front, mirroring how a real user would
 * open every row to work through them. Loops because a collapsed Partner
 * hides its Sub-partners' cards entirely (`nested` doesn't render at
 * all while collapsed) -- expanding the Partner can reveal fresh
 * collapsed Sub-partner buttons that weren't in the DOM yet. Uses
 * `fireEvent` (not `userEvent`) so it works from a plain, non-`async`
 * `it()` with no `userEvent.setup()` in scope.
 */
function expandAllPersonCards() {
  let collapsedNameButtons = screen.queryAllByRole("button", { expanded: false });
  while (collapsedNameButtons.length > 0) {
    collapsedNameButtons.forEach((button) => fireEvent.click(button));
    collapsedNameButtons = screen.queryAllByRole("button", { expanded: false });
  }
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

    await screen.findByText("Partner A");
    expect(screen.getByText("Partner B")).toBeInTheDocument();
    // Sub-partner cards don't exist in the DOM until their parent Partner
    // is expanded (collapsed by default, 2026-09-29 feedback).
    expandAllPersonCards();
    expect(screen.getByText("Sub1")).toBeInTheDocument();
    expect(screen.getByText("Sub2")).toBeInTheDocument();

    // spec-partner-hierarchy-cards (founder-approved hybrid, 2026-09-26):
    // structure intentionally changed from batch-1's `↳`/`ml-6` indent --
    // each Sub-partner is now a violet-tinted card nested INSIDE its parent
    // Partner's teal-tinted card, behind the `.nb-person-nest` colored rail.
    // Containment + role tint, not an indent, carry the hierarchy.
    const partnerCard = screen.getByText("Partner A").closest(".nb-person-card") as HTMLElement;
    const subCard = screen.getByText("Sub1").closest(".nb-person-card") as HTMLElement;
    expect(partnerCard.className).toContain("nb-person-card-partner");
    expect(subCard.className).toContain("nb-person-card-sub");
    expect(partnerCard.contains(subCard)).toBe(true);
    expect(subCard.parentElement?.className).toContain("nb-person-nest");
    // A's own retained figure (₹1,25,000) is called out distinctly from their
    // pooled canTake total (₹2,50,000) -- never the same number reused for both.
    expect(findParagraphContaining("Own:")).toHaveTextContent("₹1,25,000");
  });

  it("renders the worked-example hint at point of use, not a hover tooltip", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
    expandAllPersonCards();
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

  it("every Partner card starts collapsed (2026-09-29 follow-up feedback) -- Own figure visible up front, explanation/Withdraw Money button revealed by clicking the name", async () => {
    const user = userEvent.setup();
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");

    const partnerCard = screen.getByText("Partner A").closest(".nb-person-card") as HTMLElement;
    // The header's accessible name also includes the avatar circle's own
    // initials text (2026-09-29) -- match by substring, not exact string.
    const nameButton = within(partnerCard).getByRole("button", { name: /Partner A/ });
    expect(nameButton).toHaveAttribute("aria-expanded", "false");
    // Collapsed by default -- children (buttons, explanation) and nested
    // (Sub1/Sub2's own cards) aren't in the DOM at all yet.
    expect(within(partnerCard).queryAllByRole("button", { name: "Withdraw Money" })).toHaveLength(0);
    expect(screen.queryByText(/A's normal Can Take is/)).not.toBeInTheDocument();
    // The retained "Own" figure is visible up front regardless -- it's in `summary`, not `children`.
    expect(findParagraphContaining("Own:")).toHaveTextContent("₹1,25,000");

    await user.click(nameButton);

    expect(nameButton).toHaveAttribute("aria-expanded", "true");
    // Partner A's own button renders first (`children` precedes `nested`),
    // so index 0 is unambiguously theirs, not Sub1/Sub2's.
    expect(within(partnerCard).getAllByRole("button", { name: "Withdraw Money" })[0]).toBeInTheDocument();
    expect(findParagraphContaining("A's normal Can Take is")).toBeInTheDocument();

    await user.click(nameButton);
    expect(nameButton).toHaveAttribute("aria-expanded", "false");
    expect(within(partnerCard).queryAllByRole("button", { name: "Withdraw Money" })).toHaveLength(0);
  });
});

function makePartnerAdjustment(
  overrides: Partial<PartnerWithdrawalAdjustment> = {},
): PartnerWithdrawalAdjustment {
  return {
    partnerId: "a",
    name: "Partner A",
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
          name: "Partner B",
          adjustmentType: "keep_for_later",
          adjustmentAmount: "90000" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
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
          name: "Partner B",
          adjustmentType: "extra_taken",
          adjustmentAmount: "150000" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
    expect(await screen.findByText("Extra Taken")).toBeInTheDocument();
    expect(screen.getByText("₹1,50,000")).toBeInTheDocument();
  });

  it("renders a No Adjustment chip with no amount when Taken exactly matches Can Take", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValue({
      partners: [
        makePartnerAdjustment({
          partnerId: "b",
          name: "Partner B",
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
    expect(await screen.findByText("No Adjustment")).toBeInTheDocument();
  });

  it("renders no chip while the adjustments fetch hasn't resolved yet (secondary enrichment, never blocking)", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockReturnValue(new Promise(() => {}));

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
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
          name: "Partner A",
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

    await screen.findByText("Partner A");
    // Sub-partner cards don't exist in the DOM until their parent Partner
    // is expanded (collapsed by default, 2026-09-29 feedback).
    expandAllPersonCards();
    // Each sub's own content now lives inside its nested `PersonCard`
    // (spec-partner-hierarchy-cards) -- scope lookups to that card.
    const sub1Row = screen.getByText("Sub1").closest(".nb-person-card") as HTMLElement;
    const sub2Row = screen.getByText("Sub2").closest(".nb-person-card") as HTMLElement;

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
          name: "Partner B",
          canTake: "0" as Money,
          taken: "0" as Money,
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
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
          name: "Partner B",
          adjustmentType: "keep_for_later",
          adjustmentAmount: "90000" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
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
          name: "Partner B",
          adjustmentType: "extra_taken",
          adjustmentAmount: "150000" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
    expect(await findParagraphContaining("Recommended Available Withdrawal:")).toHaveTextContent("₹0");
  });

  it("renders no Recommended Available Withdrawal line when adjustmentType is none -- restating a figure the No Adjustment chip already implies adds no information (orchestrator-authorized refinement, 2026-09-24)", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValue({
      partners: [
        makePartnerAdjustment({
          partnerId: "b",
          name: "Partner B",
          adjustmentType: "none",
          adjustmentAmount: "0" as Money,
        }),
      ],
    });

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
    await screen.findByText("No Adjustment");
    expect(screen.queryByText(/Recommended Available Withdrawal/)).not.toBeInTheDocument();
  });

  it("renders no Recommended Available Withdrawal line while the adjustments fetch hasn't resolved yet (never a misleading ₹0)", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockReturnValue(new Promise(() => {}));

    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner A");
    expect(screen.queryByText(/Recommended Available Withdrawal/)).not.toBeInTheDocument();
  });

  it("renders each Sub-partner's own Recommended Available Withdrawal line under their own row, never swapped with a sibling's (mirrors Story 4.3's findSubPartnerAdjustment chip coverage)", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValue({
      partners: [
        makePartnerAdjustment({
          partnerId: "a",
          name: "Partner A",
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

    await screen.findByText("Partner A");
    // Sub-partner cards don't exist in the DOM until their parent Partner
    // is expanded (collapsed by default, 2026-09-29 feedback).
    expandAllPersonCards();
    // Each sub's own content now lives inside its nested `PersonCard`
    // (spec-partner-hierarchy-cards) -- scope lookups to that card.
    const sub1Row = screen.getByText("Sub1").closest(".nb-person-card") as HTMLElement;
    const sub2Row = screen.getByText("Sub2").closest(".nb-person-card") as HTMLElement;

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
  await screen.findByText("Partner A");
  expandAllPersonCards();
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
    status: "active",
    reversalOfTransactionId: null,
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

    await screen.findByText("Partner A");
    await waitFor(() => {
      expect(listWithdrawalTransactions).toHaveBeenCalledWith("project-1");
    });
    expandAllPersonCards();
    expect(await screen.findByText("2026-10-05")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
  });
});

describe("WithdrawMoneyPage -- Edit/Cancel a withdrawal (Story 4.11)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset();
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
    editWithdrawalTransaction.mockReset();
    cancelWithdrawalTransaction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Edit/Cancel buttons for an active withdrawal, no StatusChip", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue({
      transactions: [makeWithdrawalTransaction({ amount: "100000" })],
    });

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();
    await screen.findByText("2026-10-05");

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByText(/Cancelled/)).not.toBeInTheDocument();
  });

  it("shows a Cancelled StatusChip and hides Edit/Cancel for a cancelled withdrawal", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue({
      transactions: [makeWithdrawalTransaction({ amount: "100000", status: "cancelled" })],
    });

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();
    await screen.findByText("2026-10-05");

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("labels a reversal row 'Cancelled (reversal)' distinctly from the original", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue({
      transactions: [
        makeWithdrawalTransaction({ id: "wtx-1", amount: "100000", status: "cancelled" }),
        makeWithdrawalTransaction({
          id: "wtx-2",
          amount: "100000",
          status: "cancelled",
          reversalOfTransactionId: "wtx-1",
        }),
      ],
    });

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();
    await screen.findAllByText("2026-10-05");

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Cancelled (reversal)")).toBeInTheDocument();
  });

  it("edits a withdrawal successfully and refreshes the recorded-withdrawals list", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue({
      transactions: [makeWithdrawalTransaction({ id: "wtx-1", amount: "100000" })],
    });
    editWithdrawalTransaction.mockResolvedValue(
      makeWithdrawalTransaction({ id: "wtx-1", amount: "150000" }),
    );
    const user = userEvent.setup();

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();
    await screen.findByText("2026-10-05");
    listWithdrawalTransactions.mockResolvedValueOnce({
      transactions: [makeWithdrawalTransaction({ id: "wtx-1", amount: "150000" })],
    });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const amountInput = await screen.findByLabelText("Amount");
    fireEvent.change(amountInput, { target: { value: "150000" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(editWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    expect(editWithdrawalTransaction).toHaveBeenCalledWith(
      "project-1",
      "wtx-1",
      expect.objectContaining({ amount: "150000" }),
      expect.any(String),
    );
    await waitFor(() => {
      expect(listWithdrawalTransactions).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("₹1,50,000")).toBeInTheDocument();
  });

  it("renders a server error inside the Edit dialog on failure, without closing it", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue({
      transactions: [makeWithdrawalTransaction({ id: "wtx-1", amount: "100000" })],
    });
    editWithdrawalTransaction.mockRejectedValue(
      new Error(
        "This withdrawal's amount can no longer be edited because its destination allocation has already been recorded.",
      ),
    );
    const user = userEvent.setup();

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();
    await screen.findByText("2026-10-05");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    // Both the (still-open, underneath) Edit dialog and the Confirm Changes
    // dialog on top of it render the error (mirrors `add-money/page.tsx`'s
    // identical stacked-dialogs-both-show-the-error convention) -- assert at
    // least one is present, rather than requiring exactly one.
    expect((await screen.findAllByText(/amount can no longer be edited/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("cancels a withdrawal successfully and refreshes the recorded-withdrawals list", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue({
      transactions: [makeWithdrawalTransaction({ id: "wtx-1", amount: "100000" })],
    });
    cancelWithdrawalTransaction.mockResolvedValue({
      originalTransaction: makeWithdrawalTransaction({ id: "wtx-1", amount: "100000", status: "cancelled" }),
      reversalTransaction: makeWithdrawalTransaction({
        id: "wtx-2",
        amount: "100000",
        status: "cancelled",
        reversalOfTransactionId: "wtx-1",
      }),
    });
    const user = userEvent.setup();

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();
    await screen.findByText("2026-10-05");
    listWithdrawalTransactions.mockResolvedValueOnce({
      transactions: [
        makeWithdrawalTransaction({ id: "wtx-1", amount: "100000", status: "cancelled" }),
        makeWithdrawalTransaction({
          id: "wtx-2",
          amount: "100000",
          status: "cancelled",
          reversalOfTransactionId: "wtx-1",
        }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Confirm Cancel" }));

    await waitFor(() => {
      expect(cancelWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    expect(cancelWithdrawalTransaction).toHaveBeenCalledWith(
      "project-1",
      "wtx-1",
      null,
      expect.any(String),
    );
    await waitFor(() => {
      expect(listWithdrawalTransactions).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Cancelled (reversal)")).toBeInTheDocument();
  });

  it("renders a server error inside the Cancel dialog on failure, without closing it", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue({
      transactions: [makeWithdrawalTransaction({ id: "wtx-1", amount: "100000" })],
    });
    cancelWithdrawalTransaction.mockRejectedValue(
      new Error("Cannot spend 250000 from an available balance of only 100000 -- insufficient balance."),
    );
    const user = userEvent.setup();

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();
    await screen.findByText("2026-10-05");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Confirm Cancel" }));

    expect(await screen.findByText(/insufficient balance/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Cancel" })).toBeInTheDocument();
  });

  it("disables the Amount field and shows the amount-locked message in the Edit dialog once a destination allocation has been saved this session", async () => {
    getCanTake.mockResolvedValue(CAN_TAKE_RESPONSE);
    listWithdrawalTransactions.mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    recordWithdrawalTransaction.mockResolvedValue(
      makeWithdrawalTransaction({ id: "wtx-locked-1", amount: "100000" }),
    );
    listProjects.mockResolvedValue([]);
    recordDestinationAllocation.mockResolvedValue({ allocations: [] });
    const user = userEvent.setup();

    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();

    // Record the withdrawal -- `submitWithdrawal` refreshes the
    // recorded-withdrawals list right after saving (before the allocation
    // dialog is even filled in), so the new row (with its Edit/Cancel
    // buttons) is already visible underneath the destination-allocation
    // dialog once queued here.
    listWithdrawalTransactions.mockResolvedValueOnce({
      transactions: [makeWithdrawalTransaction({ id: "wtx-locked-1", amount: "100000" })],
    });
    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Where did this money go?");

    // Save its destination allocation -- this is what populates
    // `allocatedWithdrawalIds` (see that state's own doc comment on the page
    // component: a session-local signal, no GET endpoint exists to list a
    // withdrawal's legs).
    fireEvent.change(screen.getByLabelText("Notes (Destination 1)"), { target: { value: "Kept as cash" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByText("Where did this money go?")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(await screen.findByText(/Amount can no longer be edited/)).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeDisabled();
  });
});

describe("WithdrawMoneyPage -- Record Withdrawal dialog (Story 4.2)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    recordWithdrawalTransaction.mockReset();
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
    listProjects.mockReset().mockResolvedValue([]);
    recordDestinationAllocation.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the dialog with the Amount format-hint Helper text (row 5 regression -- matches Add Money's identical field)", async () => {
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);

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
          name: "Partner A",
          adjustmentType: "keep_for_later",
          adjustmentAmount: "150000" as Money,
        }),
      ],
    });

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    // Story 4.7: the "Where did this money go?" destination-allocation
    // dialog opens automatically right after a successful save (the "very
    // next step in the same flow") -- dismissed here via Skip (this story's
    // own dialog flow is covered by its own describe block below), so this
    // pre-existing test's remaining assertions aren't made ambiguous by a
    // second "₹1,00,000" rendered inside that dialog's description.
    await screen.findByText("Where did this money go?");
    await user.click(screen.getByRole("button", { name: "Skip" }));

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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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
    listProjects.mockReset().mockResolvedValue([]);
    recordDestinationAllocation.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("submits immediately (no confirmation dialog) when the amount is within Can Take", async () => {
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ amount: "100000" }));
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Authorize Extra Withdrawal?")).toBeInTheDocument();
    expect(recordWithdrawalTransaction).not.toHaveBeenCalled();
  });

  it("uses effectiveCanTake, not the plain canTake, for the exceeds-check -- a recipient's unconsumed bonus needs no confirmation dialog even though the amount exceeds their plain canTake", async () => {
    getCanTake.mockResolvedValue({
      availableToWithdraw: "500000" as Money,
      partners: [{ ...PARTNER_NO_SUBS, effectiveCanTake: "300000" as Money }, PARTNER_WITH_SUBS],
    });
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ shareId: "b", amount: "300000" }));
    const user = userEvent.setup();
    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();

    const bCard = screen.getByText("Partner B").closest(".nb-person-card") as HTMLElement;
    await user.click(within(bCard).getByRole("button", { name: "Withdraw Money" }));
    // 300000 exceeds B's plain canTake (250000) but fits within their boosted effectiveCanTake (300000).
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    expect(recordWithdrawalTransaction).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ amount: "300000", extraWithdrawalAuthorized: false }),
      expect.any(String),
    );
    expect(screen.queryByText("Authorize Extra Withdrawal?")).not.toBeInTheDocument();
  });

  it("uses effectiveCanTake, not the plain canTake, for the exceeds-check -- a decliner's own reduced ceiling still triggers the confirmation dialog for an amount within their plain canTake", async () => {
    getCanTake.mockResolvedValue({
      availableToWithdraw: "500000" as Money,
      partners: [{ ...PARTNER_NO_SUBS, effectiveCanTake: "150000" as Money }, PARTNER_WITH_SUBS],
    });
    const user = userEvent.setup();
    render(<WithdrawMoneyPage />);
    await screen.findByText("Partner A");
    expandAllPersonCards();

    const bCard = screen.getByText("Partner B").closest(".nb-person-card") as HTMLElement;
    await user.click(within(bCard).getByRole("button", { name: "Withdraw Money" }));
    // 200000 is within B's plain canTake (250000) but exceeds their reduced effectiveCanTake (150000).
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Authorize Extra Withdrawal?")).toBeInTheDocument();
    expect(recordWithdrawalTransaction).not.toHaveBeenCalled();
  });

  it("over-cap amount -> confirm dialog -> confirm -> success (extraWithdrawalAuthorized: true)", async () => {
    recordWithdrawalTransaction.mockResolvedValue(makeWithdrawalTransaction({ amount: "300000" }));
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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
    listProjects.mockReset().mockResolvedValue([]);
    recordDestinationAllocation.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("sends the SAME idempotencyKey on a retry after a failed submission, not a fresh one", async () => {
    recordWithdrawalTransaction
      .mockRejectedValueOnce(new Error("Network error -- please try again."))
      .mockResolvedValueOnce(makeWithdrawalTransaction({ amount: "100000" }));

    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1);
    });
    // Story 4.7: dismiss the auto-opened destination-allocation dialog
    // (Skip) before reopening Record Withdrawal for the second submission --
    // otherwise two dialogs' worth of "Amount"-labeled inputs would make the
    // next `findByLabelText("Amount")` ambiguous.
    await screen.findByText("Where did this money go?");
    await user.click(screen.getByRole("button", { name: "Skip" }));

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
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

/**
 * Story 4.7 (FR27): the "Where did this money go?" destination-allocation
 * dialog, opened automatically right after `submitWithdrawal` succeeds.
 * Covers this story's own verification checklist: add/remove destination
 * rows, the running Distributed total, Save disabled until it matches
 * exactly, and skipping without saving.
 */
describe("WithdrawMoneyPage -- destination-allocation dialog (Story 4.7, extended by Story 4.8)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    recordWithdrawalTransaction.mockReset();
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
    listProjects.mockReset().mockResolvedValue([]);
    createProject.mockReset();
    recordDestinationAllocation.mockReset();
    listInvestmentRequirements.mockReset();
    listPartnerShares.mockReset();
    listSubPartnerShares.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  /** Records a ₹1,00,000 withdrawal and returns the userEvent instance with the destination dialog now open. */
  async function recordAndOpenAllocationDialog() {
    recordWithdrawalTransaction.mockResolvedValue(
      makeWithdrawalTransaction({ id: "wtx-alloc-1", amount: "100000" }),
    );
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Withdraw Money" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Where did this money go?");

    return user;
  }

  /**
   * spec-quick-add-project-user-modals (follow-up): the destination-Project
   * field is now a `Combobox` (was a native `<select>`) -- opens its popover
   * via the trigger's `aria-label` (unchanged: `Destination Project (<row>)`)
   * and clicks the matching option by name, replacing the old
   * `fireEvent.change(..., { target: { value: <id> } })` one-step select.
   */
  async function selectDestinationProject(rowLabel: string, projectName: string) {
    fireEvent.click(screen.getByLabelText(`Destination Project (${rowLabel})`));
    fireEvent.click(await screen.findByText(projectName));
  }

  it("opens with one default 'other' leg pre-filled with the full amount, but Save disabled until notes (its required field) is filled in", async () => {
    await recordAndOpenAllocationDialog();

    // The amount sum already matches exactly (pre-filled with the full
    // withdrawn amount) -- Save must still be disabled, since the default
    // "other" leg's required `notes` field is blank (row 5's regression:
    // `allocationMatches` alone isn't enough to gate Save).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("leaves the default dialog state exactly as auto-opened, fills in only the required notes field, and Save actually succeeds", async () => {
    recordDestinationAllocation.mockResolvedValue({ allocations: [] });
    const user = await recordAndOpenAllocationDialog();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Notes (Destination 1)"), { target: { value: "Kept as cash" } });

    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(recordDestinationAllocation).toHaveBeenCalledTimes(1);
    });
    const [, , legsArg] = recordDestinationAllocation.mock.calls[0];
    expect(legsArg).toEqual([
      {
        destinationType: "other",
        amount: "100000",
        destinationProjectId: null,
        personName: null,
        notes: "Kept as cash",
        destinationRequirementId: null,
        destinationShareId: null,
        destinationPartyType: null,
      },
    ]);

    await waitFor(() => {
      expect(screen.queryByText("Where did this money go?")).not.toBeInTheDocument();
    });
  });

  it("disables Save when a legs edit breaks the exact-sum match, and re-enables it once fixed", async () => {
    const user = await recordAndOpenAllocationDialog();

    fireEvent.change(screen.getByLabelText("Notes (Destination 1)"), { target: { value: "Kept as cash" } });
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    const amountInput = screen.getByLabelText("Amount (Destination 1)") as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "40000" } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(amountInput, { target: { value: "100000" } });
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    void user;
  });

  it("adds and removes destination rows, keeping the running total AND the per-row required-field check in sync", async () => {
    const user = await recordAndOpenAllocationDialog();

    // Splitting the single default row into two -- reduce it, fill its
    // required notes, then add a second row (Available Balance -- no
    // type-specific field of its own) for the remainder.
    fireEvent.change(screen.getByLabelText("Amount (Destination 1)"), { target: { value: "60000" } });
    fireEvent.change(screen.getByLabelText("Notes (Destination 1)"), { target: { value: "Kept as cash" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Add destination" }));
    fireEvent.change(screen.getByLabelText("Destination type (Destination 2)"), {
      target: { value: "available_balance" },
    });
    fireEvent.change(screen.getByLabelText("Amount (Destination 2)"), { target: { value: "40000" } });

    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    // Removing the second row again drops the total back below the target.
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0] as HTMLElement);
    expect(screen.queryByLabelText("Amount (Destination 2)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("skips without saving -- no recordDestinationAllocation call, dialog closes", async () => {
    const user = await recordAndOpenAllocationDialog();

    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(recordDestinationAllocation).not.toHaveBeenCalled();
    expect(screen.queryByText("Where did this money go?")).not.toBeInTheDocument();
  });

  it("saves a multi-destination split (AC1) -- project/person/available_balance legs sent with the right shape", async () => {
    listProjects.mockResolvedValue([
      { id: "project-2", name: "Project Two", description: null, createdAt: "", updatedAt: "" },
    ]);
    listInvestmentRequirements.mockResolvedValue({
      requirements: [
        { id: "req-2", projectId: "project-2", amount: "1000000", requirementDate: "2026-10-01", createdAt: "" },
      ],
    });
    listPartnerShares.mockResolvedValue({
      shares: [
        {
          id: "row-1",
          partnerId: "partner-2",
          projectId: "project-2",
          name: "Destination Partner",
          sharePercent: "100",
          userId: null,
          subPartnerVisibilityGrant: false,
          effectiveFrom: "",
          createdAt: "",
        },
      ],
      total: "100",
    });
    listSubPartnerShares.mockResolvedValue({ shares: [], total: "0" });
    recordDestinationAllocation.mockResolvedValue({ allocations: [] });
    const user = await recordAndOpenAllocationDialog();

    // Leg 1 (default row): switch to "Another Project", ₹60,000.
    fireEvent.change(screen.getByLabelText("Destination type (Destination 1)"), {
      target: { value: "project" },
    });
    fireEvent.change(screen.getByLabelText("Amount (Destination 1)"), { target: { value: "60000" } });
    await selectDestinationProject("Destination 1", "Project Two");

    // Story 4.8 (FR28): the requirement/Share pickers appear once the
    // destination Project's fetch resolves.
    await screen.findByLabelText("Destination funding requirement (Destination 1)");
    fireEvent.change(screen.getByLabelText("Destination funding requirement (Destination 1)"), {
      target: { value: "req-2" },
    });
    fireEvent.change(screen.getByLabelText("Destination Partner/Sub-partner Share (Destination 1)"), {
      target: { value: "partner:partner-2" },
    });

    // Leg 2: a Person, ₹40,000.
    await user.click(screen.getByRole("button", { name: "Add destination" }));
    fireEvent.change(screen.getByLabelText("Destination type (Destination 2)"), {
      target: { value: "person" },
    });
    fireEvent.change(screen.getByLabelText("Amount (Destination 2)"), { target: { value: "40000" } });
    fireEvent.change(screen.getByLabelText("Person's name (Destination 2)"), {
      target: { value: "Person X" },
    });

    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(recordDestinationAllocation).toHaveBeenCalledTimes(1);
    });
    const [projectIdArg, transactionIdArg, legsArg, idempotencyKeyArg] =
      recordDestinationAllocation.mock.calls[0];
    expect(projectIdArg).toBe("project-1");
    expect(transactionIdArg).toBe("wtx-alloc-1");
    expect(legsArg).toEqual([
      {
        destinationType: "project",
        amount: "60000",
        destinationProjectId: "project-2",
        personName: null,
        notes: null,
        destinationRequirementId: "req-2",
        destinationShareId: "partner-2",
        destinationPartyType: "partner",
      },
      {
        destinationType: "person",
        amount: "40000",
        destinationProjectId: null,
        personName: "Person X",
        notes: null,
        destinationRequirementId: null,
        destinationShareId: null,
        destinationPartyType: null,
      },
    ]);
    expect(typeof idempotencyKeyArg).toBe("string");

    await waitFor(() => {
      expect(screen.queryByText("Where did this money go?")).not.toBeInTheDocument();
    });
  });

  it("shows a blocking message and keeps Save disabled when the destination Project has zero funding requirements (Story 4.8's Decisions)", async () => {
    listProjects.mockResolvedValue([
      { id: "project-2", name: "Project Two", description: null, createdAt: "", updatedAt: "" },
    ]);
    listInvestmentRequirements.mockResolvedValue({ requirements: [] });
    listPartnerShares.mockResolvedValue({ shares: [], total: "0" });
    listSubPartnerShares.mockResolvedValue({ shares: [], total: "0" });
    await recordAndOpenAllocationDialog();

    fireEvent.change(screen.getByLabelText("Destination type (Destination 1)"), {
      target: { value: "project" },
    });
    await selectDestinationProject("Destination 1", "Project Two");

    expect(
      await screen.findByText("Project Two has no funding requirements yet -- choose a different destination."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByLabelText("Destination funding requirement (Destination 1)")).not.toBeInTheDocument();
  });

  it("shows a blocking message and keeps Save disabled when the destination Project has requirements but zero Partner/Sub-partner Shares (review finding, Story 4.8)", async () => {
    listProjects.mockResolvedValue([
      { id: "project-2", name: "Project Two", description: null, createdAt: "", updatedAt: "" },
    ]);
    listInvestmentRequirements.mockResolvedValue({
      requirements: [
        { id: "req-2", projectId: "project-2", amount: "1000000", requirementDate: "2026-10-01", createdAt: "" },
      ],
    });
    listPartnerShares.mockResolvedValue({ shares: [], total: "0" });
    listSubPartnerShares.mockResolvedValue({ shares: [], total: "0" });
    await recordAndOpenAllocationDialog();

    fireEvent.change(screen.getByLabelText("Destination type (Destination 1)"), {
      target: { value: "project" },
    });
    await selectDestinationProject("Destination 1", "Project Two");

    expect(
      await screen.findByText("Project Two has no Partner/Sub-partner Shares yet -- choose a different destination."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByLabelText("Destination funding requirement (Destination 1)")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Destination Partner/Sub-partner Share (Destination 1)"),
    ).not.toBeInTheDocument();
  });

  it("keeps Save disabled for a 'project' leg with a zero amount, even once requirement/Share are both chosen (review finding, Story 4.8)", async () => {
    listProjects.mockResolvedValue([
      { id: "project-2", name: "Project Two", description: null, createdAt: "", updatedAt: "" },
    ]);
    listInvestmentRequirements.mockResolvedValue({
      requirements: [
        { id: "req-2", projectId: "project-2", amount: "1000000", requirementDate: "2026-10-01", createdAt: "" },
      ],
    });
    listPartnerShares.mockResolvedValue({
      shares: [
        {
          id: "row-1",
          partnerId: "partner-2",
          projectId: "project-2",
          name: "Destination Partner",
          sharePercent: "100",
          userId: null,
          subPartnerVisibilityGrant: false,
          effectiveFrom: "",
          createdAt: "",
        },
      ],
      total: "100",
    });
    listSubPartnerShares.mockResolvedValue({ shares: [], total: "0" });
    await recordAndOpenAllocationDialog();

    fireEvent.change(screen.getByLabelText("Destination type (Destination 1)"), {
      target: { value: "project" },
    });
    // The default row is pre-filled with the full withdrawn amount --
    // explicitly zero it out to exercise the new gate.
    fireEvent.change(screen.getByLabelText("Amount (Destination 1)"), { target: { value: "0" } });
    await selectDestinationProject("Destination 1", "Project Two");
    await screen.findByLabelText("Destination funding requirement (Destination 1)");
    fireEvent.change(screen.getByLabelText("Destination funding requirement (Destination 1)"), {
      target: { value: "req-2" },
    });
    fireEvent.change(screen.getByLabelText("Destination Partner/Sub-partner Share (Destination 1)"), {
      target: { value: "partner:partner-2" },
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // Restoring a positive amount (matching the withdrawn total) re-enables it.
    fireEvent.change(screen.getByLabelText("Amount (Destination 1)"), { target: { value: "100000" } });
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("shows the server's error message and keeps the dialog open on a failed save", async () => {
    recordDestinationAllocation.mockRejectedValue(new Error("Allocated amounts must sum to exactly the withdrawal's amount."));
    const user = await recordAndOpenAllocationDialog();
    fireEvent.change(screen.getByLabelText("Notes (Destination 1)"), { target: { value: "Kept as cash" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Allocated amounts must sum to exactly the withdrawal's amount."),
    ).toBeInTheDocument();
    expect(screen.getByText("Where did this money go?")).toBeInTheDocument();
  });

  it("shows a visible error next to the Project selector when GET /api/projects fails, instead of silently showing zero options", async () => {
    listProjects.mockRejectedValue(new Error("Could not load Projects."));
    await recordAndOpenAllocationDialog();

    fireEvent.change(screen.getByLabelText("Destination type (Destination 1)"), {
      target: { value: "project" },
    });

    expect(await screen.findByText("Couldn't load Projects: Could not load Projects.")).toBeInTheDocument();
  });

  /**
   * spec-quick-add-project-user-modals (follow-up): the destination-Project
   * Combobox's own "+ Add New Project" quick-add row -- this surface was
   * deferred from the original spec (already inside the "Where did this
   * money go?" dialog) until `packages/ui`'s `DialogContent` outside-click
   * fix (spec-quick-add-user-share-dialog) made nesting a `Combobox` inside
   * a `Dialog` safe.
   */
  it("quick-add creates a Project, and selects it as the destination without navigating away", async () => {
    listProjects.mockResolvedValue([]);
    createProject.mockResolvedValue({
      id: "project-new",
      name: "Riverside Tower",
      description: null,
      createdAt: "",
      updatedAt: "",
    });
    const user = await recordAndOpenAllocationDialog();

    fireEvent.change(screen.getByLabelText("Destination type (Destination 1)"), {
      target: { value: "project" },
    });
    await user.click(screen.getByLabelText("Destination Project (Destination 1)"));
    await user.click(await screen.findByText("+ Add New Project"));
    await user.type(screen.getByLabelText("Name"), "Riverside Tower");
    await user.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ name: "Riverside Tower", description: null }));
    await waitFor(() =>
      expect(screen.getByLabelText("Destination Project (Destination 1)")).toHaveTextContent("Riverside Tower"),
    );
  });
});

/**
 * "Distribute a Withdrawal" -- the collective, ownership-based redesign.
 * `CAN_TAKE_RESPONSE` (module-scope) gives Partner A ownCanTake=125000 (25%
 * of the 500000 available), two Sub-partners at 62500 (12.5%) each, and
 * Partner B ownCanTake=250000 (50%) -- these four bases already sum to
 * exactly 500000, so a Total of "500000" gives clean, exact suggested
 * amounts with no rounding to account for in assertions.
 */
describe("WithdrawMoneyPage -- Distribute a Withdrawal (Withdrawal Flow redesign)", () => {
  beforeEach(() => {
    getCanTake.mockReset();
    listWithdrawalTransactions.mockReset().mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    recordWithdrawalTransaction.mockReset();
    getWithdrawalAdjustments.mockReset().mockResolvedValue(EMPTY_ADJUSTMENTS_RESPONSE);
    recordDestinationAllocation.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("suggests each row's ownership-based share of the entered Total, live", async () => {
    const user = await renderAndReady();

    await user.click(screen.getByRole("button", { name: "Distribute a Withdrawal" }));
    await user.type(screen.getByLabelText("Total Withdrawal Amount"), "500000");

    expect(screen.getByLabelText("Actual withdrawal (Partner A)")).toHaveValue("125000.00");
    expect(screen.getByLabelText("Actual withdrawal (Sub1)")).toHaveValue("62500.00");
    expect(screen.getByLabelText("Actual withdrawal (Sub2)")).toHaveValue("62500.00");
    expect(screen.getByLabelText("Actual withdrawal (Partner B)")).toHaveValue("250000.00");
  });

  it("manually adjusting one row leaves the others at their own suggested amount, and shows the difference", async () => {
    const user = await renderAndReady();

    await user.click(screen.getByRole("button", { name: "Distribute a Withdrawal" }));
    await user.type(screen.getByLabelText("Total Withdrawal Amount"), "500000");

    const aInput = screen.getByLabelText("Actual withdrawal (Partner A)");
    await user.clear(aInput);
    await user.type(aInput, "150000");

    expect(aInput).toHaveValue("150000");
    expect(screen.getByLabelText("Actual withdrawal (Partner B)")).toHaveValue("250000.00"); // untouched, still suggested
    expect(screen.getByText("+25000.00")).toBeInTheDocument(); // A's difference: 150000 - 125000
  });

  it("blocks Save when the Actual amounts don't add up to the Total (over-allocation guard)", async () => {
    const user = await renderAndReady();

    await user.click(screen.getByRole("button", { name: "Distribute a Withdrawal" }));
    await user.type(screen.getByLabelText("Total Withdrawal Amount"), "500000");
    const aInput = screen.getByLabelText("Actual withdrawal (Partner A)");
    await user.clear(aInput);
    await user.type(aInput, "150000"); // now sums to 525000, not 500000
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });

    await user.click(screen.getByRole("button", { name: "Save Distribution" }));

    expect(
      await screen.findByText("The Actual amounts must add up to exactly the Total Withdrawal amount."),
    ).toBeInTheDocument();
    expect(recordWithdrawalTransaction).not.toHaveBeenCalled();
  });

  it("supports individual participation -- a row set to 0 is simply skipped, never forced", async () => {
    recordWithdrawalTransaction.mockImplementation((_projectId, input) =>
      Promise.resolve(makeWithdrawalTransaction({ id: `wtx-${input.shareId}`, ...input })),
    );
    recordDestinationAllocation.mockResolvedValue({ allocations: [], moneyMovements: [] });
    const user = await renderAndReady();

    await user.click(screen.getByRole("button", { name: "Distribute a Withdrawal" }));
    await user.type(screen.getByLabelText("Total Withdrawal Amount"), "125000");
    // Only Partner A participates this round -- every other row's own
    // suggested share (proportional to the smaller 125000 total, so none of
    // them default to zero on their own) is manually zeroed out.
    for (const name of ["Sub1", "Sub2", "Partner B"]) {
      const input = screen.getByLabelText(`Actual withdrawal (${name})`);
      await user.clear(input);
      await user.type(input, "0");
    }
    const aInput = screen.getByLabelText("Actual withdrawal (Partner A)");
    await user.clear(aInput);
    await user.type(aInput, "125000");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });

    await user.click(screen.getByRole("button", { name: "Save Distribution" }));

    await waitFor(() => expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1));
    expect(recordWithdrawalTransaction).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ partyType: "partner", shareId: "a", amount: "125000" }),
      expect.any(String),
    );
  });

  it("saves one withdrawal per participating row, then that same shared destination for each, and refreshes the list", async () => {
    recordWithdrawalTransaction.mockImplementation((_projectId, input) =>
      Promise.resolve(makeWithdrawalTransaction({ id: `wtx-${input.shareId}`, ...input })),
    );
    recordDestinationAllocation.mockResolvedValue({ allocations: [], moneyMovements: [] });
    const user = await renderAndReady();

    await user.click(screen.getByRole("button", { name: "Distribute a Withdrawal" }));
    await user.type(screen.getByLabelText("Total Withdrawal Amount"), "500000");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("Default destination for this batch"), {
      target: { value: "available_balance" },
    });

    await user.click(screen.getByRole("button", { name: "Save Distribution" }));

    await waitFor(() => expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(recordDestinationAllocation).toHaveBeenCalledTimes(4));
    expect(recordDestinationAllocation).toHaveBeenCalledWith(
      "project-1",
      "wtx-a",
      [expect.objectContaining({ destinationType: "available_balance", amount: "125000.00" })],
      expect.any(String),
    );
    await waitFor(() => expect(listWithdrawalTransactions).toHaveBeenCalled());
    // The trigger button itself is always on screen (it's the page's own
    // action, not dialog content) -- absence of a dialog-only field is what
    // actually proves the dialog closed.
    await waitFor(() => expect(screen.queryByLabelText("Total Withdrawal Amount")).not.toBeInTheDocument());
  });

  it("a row exceeding its own Can Take opens Authorize Extra Withdrawal instead of saving immediately", async () => {
    const user = await renderAndReady();

    await user.click(screen.getByRole("button", { name: "Distribute a Withdrawal" }));
    await user.type(screen.getByLabelText("Total Withdrawal Amount"), "500000");
    // Sub1/Sub2 stay at their own suggested 62500 each (untouched); moving
    // 135000 from B to A keeps the four rows' sum at exactly 500000 while
    // pushing A (260000) past its own 250000 `effectiveCanTake` ceiling.
    const aInput = screen.getByLabelText("Actual withdrawal (Partner A)");
    await user.clear(aInput);
    await user.type(aInput, "260000"); // A's own effectiveCanTake ceiling is 250000
    const bInput = screen.getByLabelText("Actual withdrawal (Partner B)");
    await user.clear(bInput);
    await user.type(bInput, "115000");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });

    await user.click(screen.getByRole("button", { name: "Save Distribution" }));

    expect(await screen.findByText("Authorize Extra Withdrawal?")).toBeInTheDocument();
    expect(recordWithdrawalTransaction).not.toHaveBeenCalled();
  });

  it("only shows the button when there's at least one Partner Share to distribute across", async () => {
    getCanTake.mockResolvedValue({ availableToWithdraw: "0", partners: [] });
    render(<WithdrawMoneyPage />);

    await screen.findByText("No Partner Shares yet");

    expect(screen.queryByRole("button", { name: "Distribute a Withdrawal" })).not.toBeInTheDocument();
  });
});

describe("Withdraw Money page -- flexible pro-rata withdrawal reallocation", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides Skip this round and the Active Reallocations panel for a non-Owner/Admin session (the default, forbidden fetch)", async () => {
    await renderAndReady();

    expect(screen.queryByRole("button", { name: "Skip this round" })).not.toBeInTheDocument();
    expect(screen.queryByText("Active Reallocations")).not.toBeInTheDocument();
  });

  it("shows Skip this round for an Owner/Admin session (the reallocations fetch succeeds)", async () => {
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [], allocations: [], isOwnerAdminView: true });
    await renderAndReady();

    expect(screen.getAllByRole("button", { name: "Skip this round" }).length).toBeGreaterThan(0);
  });

  it("shows a boosted (success) badge when a leaf's effectiveCanTake exceeds its plain canTake", async () => {
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [], allocations: [], isOwnerAdminView: true });
    getCanTake.mockResolvedValue({
      availableToWithdraw: "500000" as Money,
      partners: [
        { ...PARTNER_NO_SUBS, effectiveCanTake: "300000" as Money },
        PARTNER_WITH_SUBS,
      ],
    });
    listWithdrawalTransactions.mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner B");

    expect(screen.getByText(/Bonus/)).toBeInTheDocument();
    expect(screen.getByText("₹50,000")).toBeInTheDocument();
  });

  it("shows the decliner's name on a boosted badge, and hides Skip/the oversight panel, for a Partner's own row-scoped (non-Owner/Admin) view", async () => {
    listWithdrawalReallocations.mockResolvedValue({
      reallocations: [
        {
          id: "realloc-1",
          projectId: "project-1",
          partyType: "partner",
          shareId: "a",
          declinedAmount: "50000",
          notes: null,
          status: "active",
          createdByUserId: "owner-1",
          createdAt: new Date().toISOString(),
        },
      ],
      allocations: [
        {
          id: "leg-1",
          reallocationId: "realloc-1",
          partyType: "partner",
          shareId: "b",
          allocatedAmount: "50000",
          consumedAmount: "0",
          createdAt: new Date().toISOString(),
        },
      ],
      isOwnerAdminView: false,
    });
    getCanTake.mockResolvedValue({
      availableToWithdraw: "500000" as Money,
      partners: [{ ...PARTNER_NO_SUBS, effectiveCanTake: "300000" as Money }, PARTNER_WITH_SUBS],
    });
    listWithdrawalTransactions.mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner B");

    expect(screen.getByText(/Bonus/)).toBeInTheDocument();
    expect(screen.getByText(/declined by Partner A/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip this round" })).not.toBeInTheDocument();
    expect(screen.queryByText("Active Reallocations")).not.toBeInTheDocument();
  });

  it("shows a reduced (neutral) badge when a leaf's effectiveCanTake is below its plain canTake", async () => {
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [], allocations: [], isOwnerAdminView: true });
    getCanTake.mockResolvedValue({
      availableToWithdraw: "500000" as Money,
      partners: [
        { ...PARTNER_NO_SUBS, effectiveCanTake: "190000" as Money },
        PARTNER_WITH_SUBS,
      ],
    });
    listWithdrawalTransactions.mockResolvedValue(EMPTY_WITHDRAWALS_RESPONSE);
    render(<WithdrawMoneyPage />);

    await screen.findByText("Partner B");

    expect(screen.getByText(/Declined/)).toBeInTheDocument();
    expect(screen.getByText("₹60,000")).toBeInTheDocument();
  });

  it("declines an amount via the Skip dialog, refreshing Can Take/adjustments/reallocations on success", async () => {
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [], allocations: [], isOwnerAdminView: true });
    createWithdrawalReallocation.mockResolvedValue({
      reallocation: {
        id: "realloc-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "b",
        declinedAmount: "100000",
        notes: null,
        status: "active",
        createdByUserId: "owner-1",
        createdAt: new Date().toISOString(),
      },
      allocations: [],
    });
    const user = await renderAndReady();

    expect(getCanTake).toHaveBeenCalledTimes(1);
    expect(getWithdrawalAdjustments).toHaveBeenCalledTimes(1);
    expect(listWithdrawalReallocations).toHaveBeenCalledTimes(1);
    getCanTake.mockResolvedValueOnce(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValueOnce(EMPTY_ADJUSTMENTS_RESPONSE);
    listWithdrawalReallocations.mockResolvedValueOnce({ reallocations: [], allocations: [], isOwnerAdminView: true });

    const skipButtons = screen.getAllByRole("button", { name: "Skip this round" });
    await user.click(skipButtons[skipButtons.length - 1] as HTMLElement);

    await screen.findByText("Skip this round — Partner B");
    // Pre-filled with B's own effectiveCanTake (250000, unchanged from canTake here).
    expect(screen.getByLabelText("Amount to decline")).toHaveValue("250000");

    fireEvent.change(screen.getByLabelText("Amount to decline"), { target: { value: "100000" } });
    await user.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(createWithdrawalReallocation).toHaveBeenCalledTimes(1);
    });
    expect(createWithdrawalReallocation).toHaveBeenCalledWith(
      "project-1",
      { partyType: "partner", shareId: "b", declinedAmount: "100000", notes: null },
      expect.any(String),
    );

    await waitFor(() => {
      expect(getCanTake).toHaveBeenCalledTimes(2);
    });
    expect(listWithdrawalReallocations).toHaveBeenCalledTimes(2);
  });

  it("shows the debounced pro-rata split preview -- every other recipient's name and computed amount", async () => {
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [], allocations: [], isOwnerAdminView: true });
    previewWithdrawalReallocation.mockResolvedValue({
      effectiveCanTake: "250000",
      allocationLegs: [
        { partyType: "partner", shareId: "a", allocatedAmount: "250000" },
      ],
    });
    const user = await renderAndReady();

    const skipButtons = screen.getAllByRole("button", { name: "Skip this round" });
    await user.click(skipButtons[skipButtons.length - 1] as HTMLElement);
    await screen.findByText("Skip this round — Partner B");

    await waitFor(
      () => {
        expect(previewWithdrawalReallocation).toHaveBeenCalledWith("project-1", "partner", "b", "250000");
      },
      { timeout: 1000 },
    );
    expect(await screen.findByText("This will be split as:")).toBeInTheDocument();
    expect(screen.getByText(/A:/)).toBeInTheDocument();
  });

  it("re-fetches the preview when the declined amount changes", async () => {
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [], allocations: [], isOwnerAdminView: true });
    previewWithdrawalReallocation.mockResolvedValue({
      effectiveCanTake: "250000",
      allocationLegs: [{ partyType: "partner", shareId: "a", allocatedAmount: "50000" }],
    });
    const user = await renderAndReady();

    const skipButtons = screen.getAllByRole("button", { name: "Skip this round" });
    await user.click(skipButtons[skipButtons.length - 1] as HTMLElement);
    await screen.findByText("Skip this round — Partner B");

    fireEvent.change(screen.getByLabelText("Amount to decline"), { target: { value: "60000" } });

    await waitFor(
      () => {
        expect(previewWithdrawalReallocation).toHaveBeenCalledWith("project-1", "partner", "b", "60000");
      },
      { timeout: 1000 },
    );
  });

  it("shows an inline error, without blocking the Skip button, when the preview fetch fails", async () => {
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [], allocations: [], isOwnerAdminView: true });
    previewWithdrawalReallocation.mockRejectedValue(new Error("Could not compute the split."));
    const user = await renderAndReady();

    const skipButtons = screen.getAllByRole("button", { name: "Skip this round" });
    await user.click(skipButtons[skipButtons.length - 1] as HTMLElement);
    await screen.findByText("Skip this round — Partner B");

    expect(
      await screen.findByText("Couldn't preview the split: Could not compute the split.", {}, { timeout: 1000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).not.toBeDisabled();
  });

  it("shows the server's error message and keeps the Skip dialog open on a failed decline", async () => {
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [], allocations: [], isOwnerAdminView: true });
    createWithdrawalReallocation.mockRejectedValue(
      new Error("Cannot decline more than this Partner/Sub-partner's own currently-available Can Take."),
    );
    const user = await renderAndReady();

    const skipButtons = screen.getAllByRole("button", { name: "Skip this round" });
    await user.click(skipButtons[skipButtons.length - 1] as HTMLElement);
    await screen.findByLabelText("Amount to decline");
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(
      await screen.findByText("Cannot decline more than this Partner/Sub-partner's own currently-available Can Take."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Amount to decline")).toBeInTheDocument();
  });

  it("shows Undo Skip instead of Skip this round once a share has an active decline, and cancels it via the confirm dialog", async () => {
    const activeReallocation = {
      id: "realloc-1",
      projectId: "project-1",
      partyType: "partner" as const,
      shareId: "b",
      declinedAmount: "100000",
      notes: "Taking a step back this round",
      status: "active" as const,
      createdByUserId: "owner-1",
      createdAt: new Date().toISOString(),
    };
    listWithdrawalReallocations.mockResolvedValue({
      reallocations: [activeReallocation],
      allocations: [
        {
          id: "leg-1",
          reallocationId: "realloc-1",
          partyType: "partner",
          shareId: "a",
          allocatedAmount: "100000",
          consumedAmount: "0",
          createdAt: new Date().toISOString(),
        },
      ],
      isOwnerAdminView: true,
    });
    cancelWithdrawalReallocation.mockResolvedValue({ ...activeReallocation, status: "cancelled" });
    const user = await renderAndReady();

    expect(screen.getByText("Active Reallocations")).toBeInTheDocument();
    expect(screen.getByText(/B declined/)).toBeInTheDocument();
    expect(screen.getByText("Taking a step back this round")).toBeInTheDocument();

    const undoButtons = screen.getAllByRole("button", { name: "Undo Skip" });
    expect(undoButtons.length).toBeGreaterThan(0);

    getCanTake.mockResolvedValueOnce(CAN_TAKE_RESPONSE);
    getWithdrawalAdjustments.mockResolvedValueOnce(EMPTY_ADJUSTMENTS_RESPONSE);
    listWithdrawalReallocations.mockResolvedValueOnce({ reallocations: [], allocations: [], isOwnerAdminView: true });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Cancel this reallocation?");
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));

    await waitFor(() => {
      expect(cancelWithdrawalReallocation).toHaveBeenCalledWith("project-1", "realloc-1");
    });
  });

  it("shows the server's error message and keeps the confirm dialog open on a failed cancel (e.g. already consumed)", async () => {
    const activeReallocation = {
      id: "realloc-1",
      projectId: "project-1",
      partyType: "partner" as const,
      shareId: "b",
      declinedAmount: "100000",
      notes: null,
      status: "active" as const,
      createdByUserId: "owner-1",
      createdAt: new Date().toISOString(),
    };
    listWithdrawalReallocations.mockResolvedValue({ reallocations: [activeReallocation], allocations: [], isOwnerAdminView: true });
    cancelWithdrawalReallocation.mockRejectedValue(
      new Error("Cannot cancel a reallocation once any part of it has been consumed."),
    );
    const user = await renderAndReady();

    await user.click(screen.getAllByRole("button", { name: "Undo Skip" })[0] as HTMLElement);
    await screen.findByText("Cancel this reallocation?");
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));

    expect(
      await screen.findByText("Cannot cancel a reallocation once any part of it has been consumed."),
    ).toBeInTheDocument();
  });
});

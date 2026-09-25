// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PartnerShouldPay } from "@niveshbook/core";
import type { Money, Percent } from "@niveshbook/types";
import type { ShouldPayResponse } from "@/lib/should-pay";
import type { InvestmentTransactionsResponse } from "@/lib/investment-transactions";
import AddMoneyPage from "./page";

/**
 * Focused regression coverage for the two review-flagged bugs in this page
 * (spec-3-2's Review Triage Log, rows 1-2) -- not full-page coverage, which
 * is a separate, pre-existing gap (row 5). Mirrors `app/SessionList.test.tsx`'s
 * pattern for testing a client component with hooks/fetch.
 */

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-1" }),
}));

const listInvestmentRequirements = vi.fn();
const addInvestmentRequirement = vi.fn();

vi.mock("@/lib/investment-requirements", () => ({
  listInvestmentRequirements: (...args: unknown[]) => listInvestmentRequirements(...args),
  addInvestmentRequirement: (...args: unknown[]) => addInvestmentRequirement(...args),
}));

const getShouldPay = vi.fn();

vi.mock("@/lib/should-pay", () => ({
  getShouldPay: (...args: unknown[]) => getShouldPay(...args),
}));

const listInvestmentTransactions = vi.fn();
const recordInvestmentTransaction = vi.fn();
const editInvestmentTransaction = vi.fn();
const cancelInvestmentTransaction = vi.fn();

vi.mock("@/lib/investment-transactions", () => ({
  listInvestmentTransactions: (...args: unknown[]) => listInvestmentTransactions(...args),
  recordInvestmentTransaction: (...args: unknown[]) => recordInvestmentTransaction(...args),
  editInvestmentTransaction: (...args: unknown[]) => editInvestmentTransaction(...args),
  cancelInvestmentTransaction: (...args: unknown[]) => cancelInvestmentTransaction(...args),
}));

const REQUIREMENT = {
  id: "req-1",
  projectId: "project-1",
  amount: "1000000",
  requirementDate: "2026-10-01",
  createdAt: new Date().toISOString(),
};

const PARTNER_WITH_SUBS: PartnerShouldPay = {
  partnerId: "a",
  name: "A",
  sharePercent: "50" as Percent,
  shouldPay: "500000" as Money,
  ownShouldPay: "250000" as Money,
  subPartners: [
    {
      subPartnerId: "sub1",
      name: "Sub1",
      sharePercent: "12.5" as Percent,
      shouldPay: "125000" as Money,
    },
    {
      subPartnerId: "sub2",
      name: "Sub2",
      sharePercent: "12.5" as Percent,
      shouldPay: "125000" as Money,
    },
  ],
};

const SHOULD_PAY_RESPONSE: ShouldPayResponse = { partners: [PARTNER_WITH_SUBS] };

async function renderAndExpand() {
  const user = userEvent.setup();
  render(<AddMoneyPage />);

  await screen.findByText("2026-10-01");
  await user.click(screen.getByRole("button", { name: "Should Pay" }));
  return user;
}

/**
 * `screen.getByText` only matches a node whose own text isn't split across
 * child elements (here, "Own: " is a text node followed by a nested
 * `<Amount>` `<span>`) -- so an exact-string match never finds it. Matches
 * on the concatenated `textContent` of a single `<p>` element instead.
 */
function findParagraphContaining(text: string): HTMLElement {
  return screen.getByText((_, element) => {
    if (element?.tagName !== "P") return false;
    return (element.textContent ?? "").includes(text);
  });
}

describe("AddMoneyPage -- Should Pay expand (regression, spec-3-2 Review Triage rows 1-2)", () => {
  beforeEach(() => {
    listInvestmentRequirements.mockReset().mockResolvedValue({ requirements: [REQUIREMENT] });
    addInvestmentRequirement.mockReset();
    getShouldPay.mockReset();
    listInvestmentTransactions.mockReset().mockResolvedValue({ transactions: [] });
    recordInvestmentTransaction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a Partner's ownShouldPay as a distinct value from their pooled shouldPay total, not the same number reused for both (row 1)", async () => {
    getShouldPay.mockResolvedValue(SHOULD_PAY_RESPONSE);

    await renderAndExpand();

    // The pooled total (ownShouldPay + Σ subShouldPay = 250000 + 125000 +
    // 125000 = 500000) still appears, once -- the ShareRow action amount.
    await waitFor(() => {
      expect(screen.getByText("₹5,00,000")).toBeInTheDocument();
    });

    // The Partner's own retained amount is called out on its own distinct
    // line, never conflated with the pooled total above.
    expect(findParagraphContaining("Own: ₹2,50,000")).toBeInTheDocument();

    // The worked-example hint must describe ownShouldPay ("A's normal share
    // is ₹2,50,000"), never the pooled total ("₹5,00,000") -- otherwise a
    // reader double-counts what's already been delegated to Sub-partners.
    const hint = findParagraphContaining("normal share is");
    expect(hint.textContent).toContain("₹2,50,000");
    expect(hint.textContent).not.toContain("₹5,00,000");

    // Exactly one place shows the pooled total (₹5,00,000) -- the ShareRow
    // action amount -- confirming the hint/"Own" line don't also show it.
    expect(screen.getAllByText("₹5,00,000")).toHaveLength(1);
  });

  it("does not get stuck on 'Loading…' forever after collapsing before the fetch resolves, then re-expanding (row 2)", async () => {
    let releaseFirstFetch: (() => void) | undefined;
    getShouldPay
      .mockImplementationOnce(
        () =>
          new Promise<ShouldPayResponse>((resolve) => {
            releaseFirstFetch = () => resolve(SHOULD_PAY_RESPONSE);
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(SHOULD_PAY_RESPONSE));

    const user = await renderAndExpand();

    // The first fetch is still in flight -- the panel shows the loading state.
    expect(screen.getByText("Loading Should Pay…")).toBeInTheDocument();
    expect(getShouldPay).toHaveBeenCalledTimes(1);

    // Collapse before that fetch ever resolves.
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Loading Should Pay…")).not.toBeInTheDocument();

    // Re-expand -- this must trigger a brand-new fetch (not read the stale
    // "loading" state left over from the abandoned first attempt).
    await user.click(screen.getByRole("button", { name: "Should Pay" }));
    expect(getShouldPay).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(findParagraphContaining("Own: ₹2,50,000")).toBeInTheDocument();
    });
    expect(screen.queryByText("Loading Should Pay…")).not.toBeInTheDocument();

    // The first (abandoned) fetch resolving late must not resurrect a stale
    // render -- the panel should still show the second fetch's loaded data.
    releaseFirstFetch?.();
    await Promise.resolve();
    expect(findParagraphContaining("Own: ₹2,50,000")).toBeInTheDocument();
  });
});

describe("AddMoneyPage -- Record Payment idempotency key reuse across a retry (regression, spec-3-3 Review Triage row 1)", () => {
  beforeEach(() => {
    listInvestmentRequirements.mockReset().mockResolvedValue({ requirements: [REQUIREMENT] });
    getShouldPay.mockReset().mockResolvedValue(SHOULD_PAY_RESPONSE);
    listInvestmentTransactions
      .mockReset()
      .mockResolvedValue({ transactions: [] } satisfies InvestmentTransactionsResponse);
    recordInvestmentTransaction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("sends the SAME idempotencyKey on a retry after a failed submission, not a fresh one", async () => {
    recordInvestmentTransaction
      .mockRejectedValueOnce(new Error("Network error -- please try again."))
      .mockResolvedValueOnce({
        id: "tx-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "700000",
        transactionDate: "2026-10-05",
        paymentMode: "cash",
        referenceNumber: null,
        notes: null,
        createdAt: new Date().toISOString(),
      });

    const user = await renderAndExpand();

    // A "Record Payment" button exists per Partner/Sub-partner row -- the
    // Partner's own row is the first one.
    await user.click(screen.getAllByRole("button", { name: "Record Payment" })[0] as HTMLElement);

    const amountInput = await screen.findByLabelText("Amount");
    fireEvent.change(amountInput, { target: { value: "700000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });

    // 2026-09-25: "Save" now only opens the summary-confirm step (money-
    // moving actions); the actual submit happens on "Confirm" inside it.
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Confirm Payment");

    // First attempt: fails. The confirm dialog stays open with the error
    // shown inside it (mirrors Cancel Payment's stay-open-on-error convention).
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(recordInvestmentTransaction).toHaveBeenCalledTimes(1);
    });
    await screen.findByRole("alert");

    // Retry via the same still-open confirm dialog with the same field
    // values -- exactly the "user retries after a perceived failure"
    // scenario this fix protects.
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(recordInvestmentTransaction).toHaveBeenCalledTimes(2);
    });

    const firstCallKey = recordInvestmentTransaction.mock.calls[0]?.[3] as string;
    const secondCallKey = recordInvestmentTransaction.mock.calls[1]?.[3] as string;

    expect(typeof firstCallKey).toBe("string");
    expect(firstCallKey.length).toBeGreaterThan(0);
    expect(secondCallKey).toBe(firstCallKey);
  });

  it("mints a NEW idempotencyKey for a genuinely new submission (dialog closed and reopened)", async () => {
    recordInvestmentTransaction.mockResolvedValue({
      id: "tx-1",
      requirementId: "req-1",
      projectId: "project-1",
      partyType: "partner",
      shareId: "a",
      sharePercentSnapshot: "50",
      shouldPaySnapshot: "500000",
      amount: "700000",
      transactionDate: "2026-10-05",
      paymentMode: "cash",
      referenceNumber: null,
      notes: null,
      createdAt: new Date().toISOString(),
    });

    const user = await renderAndExpand();

    await user.click(screen.getAllByRole("button", { name: "Record Payment" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Confirm Payment");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(recordInvestmentTransaction).toHaveBeenCalledTimes(1);
    });

    // Both dialogs close on success -- open Record Payment again for a
    // second, distinct payment.
    await user.click(screen.getAllByRole("button", { name: "Record Payment" })[0] as HTMLElement);
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-06" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Confirm Payment");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(recordInvestmentTransaction).toHaveBeenCalledTimes(2);
    });

    const firstCallKey = recordInvestmentTransaction.mock.calls[0]?.[3] as string;
    const secondCallKey = recordInvestmentTransaction.mock.calls[1]?.[3] as string;
    expect(secondCallKey).not.toBe(firstCallKey);
  });
});

function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    requirementId: "req-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50",
    shouldPaySnapshot: "500000",
    amount: "300000",
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
 * Narrow regression coverage for the Cancel UI's new surface (spec-3-8's
 * Review Triage Log, rows 2 and 5) -- not full-page coverage (row 5 is
 * explicit that only what a bug was found in warrants a test, mirroring
 * this file's own established precedent for spec-3-2/3-3's rows above).
 */
describe("AddMoneyPage -- Cancel UI (regression, spec-3-8 Review Triage rows 2/5)", () => {
  beforeEach(() => {
    listInvestmentRequirements.mockReset().mockResolvedValue({ requirements: [REQUIREMENT] });
    getShouldPay.mockReset().mockResolvedValue(SHOULD_PAY_RESPONSE);
    listInvestmentTransactions.mockReset();
    recordInvestmentTransaction.mockReset();
    editInvestmentTransaction.mockReset();
    cancelInvestmentTransaction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("hides the 'Edit' button (and the 'Cancel' button) for an already-cancelled transaction -- regression for row 2 (Edit wasn't gated on status the way Cancel was)", async () => {
    listInvestmentTransactions.mockResolvedValue({
      transactions: [makeTransaction({ id: "tx-cancelled", status: "cancelled" })],
    });

    await renderAndExpand();

    await waitFor(() => {
      expect(screen.getByText("Cancelled")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("shows both 'Edit' and 'Cancel' for a still-active transaction, and no 'Cancelled' chip", async () => {
    listInvestmentTransactions.mockResolvedValue({
      transactions: [makeTransaction({ id: "tx-active", status: "active" })],
    });

    await renderAndExpand();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
  });

  it("does not call cancelInvestmentTransaction just from opening the confirmation dialog -- only after the explicit 'Confirm Cancel' step", async () => {
    listInvestmentTransactions.mockResolvedValue({
      transactions: [makeTransaction({ id: "tx-active", status: "active" })],
    });
    cancelInvestmentTransaction.mockResolvedValue({
      originalTransaction: makeTransaction({ id: "tx-active", status: "cancelled" }),
      reversalTransaction: makeTransaction({
        id: "tx-reversal",
        status: "cancelled",
        reversalOfTransactionId: "tx-active",
      }),
    });

    const user = await renderAndExpand();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // The confirmation dialog is open -- confirming the request has NOT
    // fired yet, since this is a destructive-feeling action requiring an
    // explicit confirm step (this story's Decisions/Boundaries).
    await screen.findByText("Cancel this payment?");
    expect(cancelInvestmentTransaction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm Cancel" }));

    await waitFor(() => {
      expect(cancelInvestmentTransaction).toHaveBeenCalledTimes(1);
    });
  });

  it("firing 'Back' instead of 'Confirm Cancel' closes the dialog without ever calling cancelInvestmentTransaction", async () => {
    listInvestmentTransactions.mockResolvedValue({
      transactions: [makeTransaction({ id: "tx-active", status: "active" })],
    });

    const user = await renderAndExpand();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Cancel this payment?");

    await user.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.queryByText("Cancel this payment?")).not.toBeInTheDocument();
    });
    expect(cancelInvestmentTransaction).not.toHaveBeenCalled();
  });
});

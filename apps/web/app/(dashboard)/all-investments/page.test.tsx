// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import type { Money, Percent } from "@niveshbook/types";
import type { MyInvestmentEntry } from "@/lib/my-investments";
import AllInvestmentsPage from "./page";

const getMyInvestments = vi.fn();

vi.mock("@/lib/my-investments", () => ({
  getMyInvestments: (...args: unknown[]) => getMyInvestments(...args),
}));

function makeEntry(overrides: Partial<MyInvestmentEntry> = {}): MyInvestmentEntry {
  return {
    projectId: "project-a",
    projectName: "Project A",
    role: "partner",
    shareId: "partner-1",
    name: "Asha",
    sharePercent: "60.0000" as Percent,
    requirements: [
      {
        requirementId: "req-1",
        requirementDate: "2026-09-01",
        requirementAmount: "1000000" as Money,
        status: {
          shouldPay: "600000" as Money,
          actualPaid: "400000" as Money,
          adjustmentType: "pending",
          adjustmentAmount: "200000" as Money,
        },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  getMyInvestments.mockReset().mockResolvedValue({ entries: [] });
});

afterEach(() => {
  cleanup();
});

describe("AllInvestmentsPage (founder feedback 2026-09-26)", () => {
  it("shows a loading state before the fetch resolves", () => {
    getMyInvestments.mockReturnValue(new Promise(() => {}));

    render(<AllInvestmentsPage />);

    expect(screen.getByText("Loading All Investments…")).toBeInTheDocument();
  });

  it("renders EmptyState (packages/ui) when the actor has zero current shares", async () => {
    render(<AllInvestmentsPage />);

    await screen.findByText("No investments yet");
  });

  it("renders one card per entry: project name, role, share % (trailing zeros trimmed), and per-requirement own status", async () => {
    getMyInvestments.mockResolvedValue({
      entries: [
        makeEntry(),
        makeEntry({
          projectId: "project-b",
          projectName: "Project B",
          role: "sub_partner",
          shareId: "sub-1",
          name: "Asha",
          sharePercent: "12.5000" as Percent,
          requirements: [
            {
              requirementId: "req-2",
              requirementDate: "2026-09-05",
              requirementAmount: "500000" as Money,
              status: {
                shouldPay: "62500" as Money,
                actualPaid: "70000" as Money,
                adjustmentType: "extra_paid",
                adjustmentAmount: "7500" as Money,
                recommendedAmount: "60000" as Money,
              },
            },
          ],
        }),
      ],
    });

    render(<AllInvestmentsPage />);

    await screen.findByText("Project A");
    expect(screen.getByText("Partner")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();

    // spec-partner-hierarchy-cards (2026-09-26): each entry Card's `tint`
    // prop (wired from `entry.role`) renders the matching role-tint class.
    const partnerCard = screen.getByText("Project A").closest(".nb-card") as HTMLElement;
    const subPartnerCard = screen.getByText("Project B").closest(".nb-card") as HTMLElement;
    expect(partnerCard.className).toContain("nb-person-card-partner");
    expect(subPartnerCard.className).toContain("nb-person-card-sub");

    // spec-mobile-responsive-phase2-table-cards: the below-860px RowCard
    // stack renders the exact same per-requirement data alongside the
    // nested Table (CSS-only breakpoint switch) -- scoped to each entry's
    // own Table here, its own desktop-specific assertion.
    const partnerTable = within(partnerCard).getByRole("table");
    expect(within(partnerTable).getByText("Pending")).toBeInTheDocument();

    expect(screen.getByText("Project B")).toBeInTheDocument();
    expect(screen.getByText("Sub-partner")).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
    const subPartnerTable = within(subPartnerCard).getByRole("table");
    const extraPaidChip = within(subPartnerTable).getByText("Extra Paid").closest("span") as HTMLElement;
    expect(within(extraPaidChip).getByText("₹7,500")).toBeInTheDocument();
    // The Recommended snapshot surfaces when it differs from should-pay.
    expect(within(subPartnerTable).getByText("₹60,000")).toBeInTheDocument();
  });

  it("renders the not-computable note (never a crash) for a requirement whose status is null", async () => {
    getMyInvestments.mockResolvedValue({
      entries: [
        makeEntry({
          requirements: [
            {
              requirementId: "req-1",
              requirementDate: "2026-09-01",
              requirementAmount: "1000000" as Money,
              status: null,
            },
          ],
        }),
      ],
    });

    render(<AllInvestmentsPage />);

    // spec-mobile-responsive-phase2-table-cards' I/O matrix: the fallback
    // text renders in BOTH the desktop Table's merged cell and the
    // below-860px RowCard's own "Status" field -- exactly twice, never a
    // crash either way.
    await waitFor(() =>
      expect(
        screen.getAllByText(/Not available yet — this Project's ownership percentages need to be fixed first\./),
      ).toHaveLength(2),
    );
  });

  it("renders the no-requirements note for a Project with no funding requirements", async () => {
    getMyInvestments.mockResolvedValue({ entries: [makeEntry({ requirements: [] })] });

    render(<AllInvestmentsPage />);

    await screen.findByText("No funding requirements on this Project yet.");
  });

  it("renders the fetch error as a role=alert message", async () => {
    getMyInvestments.mockRejectedValue(new Error("Not allowed."));

    render(<AllInvestmentsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not allowed.");
  });
});

/**
 * spec-mobile-responsive-phase2-table-cards, Decision #5: only the nested
 * per-requirement rows convert to `RowCard`s below 860px -- the outer
 * Card/tint/header is untouched. Both renders exist in the DOM
 * simultaneously (CSS-only breakpoint switch), scoped here via the stack's
 * own `data-testid`.
 */
describe("AllInvestmentsPage -- below-860px RowCard stack", () => {
  it("renders one RowCard per requirement, with every table field present on its card equivalent", async () => {
    getMyInvestments.mockResolvedValue({ entries: [makeEntry()] });

    render(<AllInvestmentsPage />);

    const cards = await screen.findByTestId("all-investments-row-cards");
    expect(within(cards).getByText("2026-09-01")).toBeInTheDocument();
    expect(within(cards).getByText("Pending")).toBeInTheDocument();
    expect(within(cards).getByText("₹6,00,000")).toBeInTheDocument();
    expect(within(cards).getByText("₹4,00,000")).toBeInTheDocument();
  });

  it("renders the Extra Paid badge with BOTH the label and the adjustment amount on the card (review fix: only the desktop-table-scoped test covered this, not the card)", async () => {
    getMyInvestments.mockResolvedValue({
      entries: [
        makeEntry({
          requirements: [
            {
              requirementId: "req-2",
              requirementDate: "2026-09-05",
              requirementAmount: "500000" as Money,
              status: {
                shouldPay: "62500" as Money,
                actualPaid: "70000" as Money,
                adjustmentType: "extra_paid",
                adjustmentAmount: "7500" as Money,
              },
            },
          ],
        }),
      ],
    });

    render(<AllInvestmentsPage />);

    const cards = await screen.findByTestId("all-investments-row-cards");
    const extraPaidChip = within(cards).getByText("Extra Paid").closest("span") as HTMLElement;
    expect(within(extraPaidChip).getByText("₹7,500")).toBeInTheDocument();
  });

  it("shows the same not-computable fallback text on the card for a null status", async () => {
    getMyInvestments.mockResolvedValue({
      entries: [
        makeEntry({
          requirements: [
            {
              requirementId: "req-1",
              requirementDate: "2026-09-01",
              requirementAmount: "1000000" as Money,
              status: null,
            },
          ],
        }),
      ],
    });

    render(<AllInvestmentsPage />);

    const cards = await screen.findByTestId("all-investments-row-cards");
    expect(
      within(cards).getByText(/Not available yet — this Project's ownership percentages need to be fixed first\./),
    ).toBeInTheDocument();
  });

  it("renders no card stack for a Project with no funding requirements (outer Card/header still render, per Decision #5)", async () => {
    getMyInvestments.mockResolvedValue({ entries: [makeEntry({ requirements: [] })] });

    render(<AllInvestmentsPage />);

    await screen.findByText("No funding requirements on this Project yet.");
    expect(screen.queryByTestId("all-investments-row-cards")).not.toBeInTheDocument();
  });

  // Review fix: jsdom never evaluates CSS, so a swapped/dropped breakpoint
  // class would still leave every other assertion above green. Assert the
  // actual wiring directly, mirroring layout.test.tsx's `asideClassName`
  // pattern.
  it("wires the desktop Table and mobile RowCard stack to opposite ends of the 860px breakpoint", async () => {
    getMyInvestments.mockResolvedValue({ entries: [makeEntry()] });

    render(<AllInvestmentsPage />);

    const table = await screen.findByRole("table");
    const tableWrapper = table.closest('[class*="860px"]');
    expect(tableWrapper?.className).toContain("max-[860px]:hidden");

    const cards = screen.getByTestId("all-investments-row-cards");
    expect(cards.className).toContain("hidden");
    expect(cards.className).toContain("max-[860px]:block");
  });
});

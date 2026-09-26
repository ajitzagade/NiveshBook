// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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
    expect(screen.getByText("Pending")).toBeInTheDocument();

    expect(screen.getByText("Project B")).toBeInTheDocument();
    expect(screen.getByText("Sub-partner")).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
    const extraPaidChip = screen.getByText("Extra Paid").closest("span") as HTMLElement;
    expect(within(extraPaidChip).getByText("₹7,500")).toBeInTheDocument();
    // The Recommended snapshot surfaces when it differs from should-pay.
    expect(screen.getByText("₹60,000")).toBeInTheDocument();
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

    await screen.findByText(/Not computable yet/);
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

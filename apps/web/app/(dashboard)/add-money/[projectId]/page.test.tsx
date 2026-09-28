// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddMoneyPage from "./page";

const getOwnershipStructure = vi.fn();
vi.mock("@/lib/ownership-structure", () => ({
  getOwnershipStructure: (...args: unknown[]) => getOwnershipStructure(...args),
}));

const listInvestmentRequirements = vi.fn();
vi.mock("@/lib/investment-requirements", () => ({
  listInvestmentRequirements: (...args: unknown[]) => listInvestmentRequirements(...args),
}));

const getMyInvestmentStatus = vi.fn();
vi.mock("@/lib/my-investment-status", () => ({
  getMyInvestmentStatus: (...args: unknown[]) => getMyInvestmentStatus(...args),
}));

const recordInvestmentTransaction = vi.fn();
vi.mock("@/lib/investment-transactions", () => ({
  recordInvestmentTransaction: (...args: unknown[]) => recordInvestmentTransaction(...args),
}));

let mockProjectId = "project-1";
let mockSearchParams = new URLSearchParams({ partnerId: "partner-xyz" });
vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: mockProjectId }),
  useSearchParams: () => mockSearchParams,
}));

function makeRequirement(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    projectId: "project-1",
    amount: "1000000",
    requirementDate: "2026-09-01",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockProjectId = "project-1";
  mockSearchParams = new URLSearchParams({ partnerId: "partner-xyz" });
});

describe("AddMoneyPage (self-service)", () => {
  it("shows a loading state before the fetch resolves", () => {
    getOwnershipStructure.mockReturnValue(new Promise(() => {}));
    listInvestmentRequirements.mockReturnValue(new Promise(() => {}));
    render(<AddMoneyPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows an error state when neither partnerId nor subPartnerId is in the URL", async () => {
    mockSearchParams = new URLSearchParams();
    render(<AddMoneyPage />);
    expect(await screen.findByText("This link is missing a Partner or Sub-partner reference.")).toBeInTheDocument();
    expect(getOwnershipStructure).not.toHaveBeenCalled();
  });

  it("shows the generic error state on a rejected fetch -- e.g. a 403 from the route", async () => {
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    listInvestmentRequirements.mockRejectedValue(new Error("You don't have permission to do that."));

    render(<AddMoneyPage />);

    expect(await screen.findByText("You don't have permission to do that.")).toBeInTheDocument();
  });

  it("renders EmptyState when there are no funding requirements", async () => {
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    listInvestmentRequirements.mockResolvedValue({ requirements: [] });

    render(<AddMoneyPage />);

    expect(await screen.findByText("No funding requirements yet")).toBeInTheDocument();
  });

  it("expanding a requirement fetches this caller's own status via partyType/shareId from the URL", async () => {
    const user = userEvent.setup();
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    listInvestmentRequirements.mockResolvedValue({ requirements: [makeRequirement()] });
    getMyInvestmentStatus.mockResolvedValue({
      partyType: "partner",
      status: { shouldPay: "300000", actualPaid: "100000", recommendedAmount: "200000" },
    });

    render(<AddMoneyPage />);
    await screen.findByText("My Project -- your own investment payments.");

    await user.click(screen.getByRole("button", { name: /Requirement of/ }));

    await waitFor(() =>
      expect(getMyInvestmentStatus).toHaveBeenCalledWith("project-1", "req-1", "partner", "partner-xyz"),
    );
    expect(await screen.findByRole("button", { name: "Add Investment" })).toBeInTheDocument();
  });

  it("expanding a requirement resolves partyType/shareId from subPartnerId when that's what's in the URL", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({ subPartnerId: "sub-abc" });
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    listInvestmentRequirements.mockResolvedValue({ requirements: [makeRequirement()] });
    getMyInvestmentStatus.mockResolvedValue({
      partyType: "sub_partner",
      status: { shouldPay: "100000", actualPaid: "0" },
    });

    render(<AddMoneyPage />);
    await screen.findByText("My Project -- your own investment payments.");
    await user.click(screen.getByRole("button", { name: /Requirement of/ }));

    await waitFor(() =>
      expect(getMyInvestmentStatus).toHaveBeenCalledWith("project-1", "req-1", "sub_partner", "sub-abc"),
    );
  });

  it("submitting the Add Investment dialog posts against the caller's own share and refreshes the status", async () => {
    const user = userEvent.setup();
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    listInvestmentRequirements.mockResolvedValue({ requirements: [makeRequirement()] });
    getMyInvestmentStatus.mockResolvedValue({
      partyType: "partner",
      status: { shouldPay: "300000", actualPaid: "100000" },
    });
    recordInvestmentTransaction.mockResolvedValue({ id: "tx-1" });

    render(<AddMoneyPage />);
    await screen.findByText("My Project -- your own investment payments.");
    await user.click(screen.getByRole("button", { name: /Requirement of/ }));
    await user.click(await screen.findByRole("button", { name: "Add Investment" }));

    await user.type(screen.getByLabelText("Amount"), "50000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(recordInvestmentTransaction).toHaveBeenCalledTimes(1));
    const [projectId, requirementId, input] = recordInvestmentTransaction.mock.calls[0];
    expect(projectId).toBe("project-1");
    expect(requirementId).toBe("req-1");
    expect(input).toMatchObject({ partyType: "partner", shareId: "partner-xyz", amount: "50000" });
  });

  it("shows the server's error message inline when the submit is rejected", async () => {
    const user = userEvent.setup();
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    listInvestmentRequirements.mockResolvedValue({ requirements: [makeRequirement()] });
    getMyInvestmentStatus.mockResolvedValue({
      partyType: "partner",
      status: { shouldPay: "300000", actualPaid: "100000" },
    });
    recordInvestmentTransaction.mockRejectedValue(new Error("Shares are not fully allocated."));

    render(<AddMoneyPage />);
    await screen.findByText("My Project -- your own investment payments.");
    await user.click(screen.getByRole("button", { name: /Requirement of/ }));
    await user.click(await screen.findByRole("button", { name: "Add Investment" }));
    await user.type(screen.getByLabelText("Amount"), "50000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Shares are not fully allocated.");
  });
});

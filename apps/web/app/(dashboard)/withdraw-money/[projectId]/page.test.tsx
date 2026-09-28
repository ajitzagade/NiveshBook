// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WithdrawMoneyPage from "./page";

const getOwnershipStructure = vi.fn();
vi.mock("@/lib/ownership-structure", () => ({
  getOwnershipStructure: (...args: unknown[]) => getOwnershipStructure(...args),
}));

const getMyWithdrawalStatus = vi.fn();
vi.mock("@/lib/my-withdrawal-status", () => ({
  getMyWithdrawalStatus: (...args: unknown[]) => getMyWithdrawalStatus(...args),
}));

const recordWithdrawalTransaction = vi.fn();
vi.mock("@/lib/withdrawal-transactions", () => ({
  recordWithdrawalTransaction: (...args: unknown[]) => recordWithdrawalTransaction(...args),
}));

let mockProjectId = "project-1";
let mockSearchParams = new URLSearchParams({ partnerId: "partner-xyz" });
vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: mockProjectId }),
  useSearchParams: () => mockSearchParams,
}));

function makeWithdrawalStatus(overrides: Record<string, unknown> = {}) {
  return {
    partyType: "partner",
    status: {
      partnerId: "partner-xyz",
      name: "Partner A",
      sharePercent: "50",
      canTake: "80000",
      taken: "20000",
      adjustmentType: "none",
      adjustmentAmount: "0",
      effectiveCanTake: "80000",
      ...overrides,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockProjectId = "project-1";
  mockSearchParams = new URLSearchParams({ partnerId: "partner-xyz" });
});

describe("WithdrawMoneyPage (self-service)", () => {
  it("shows a loading state before the fetch resolves", () => {
    getOwnershipStructure.mockReturnValue(new Promise(() => {}));
    getMyWithdrawalStatus.mockReturnValue(new Promise(() => {}));
    render(<WithdrawMoneyPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows an error state when neither partnerId nor subPartnerId is in the URL", async () => {
    mockSearchParams = new URLSearchParams();
    render(<WithdrawMoneyPage />);
    expect(await screen.findByText("This link is missing a Partner or Sub-partner reference.")).toBeInTheDocument();
    expect(getOwnershipStructure).not.toHaveBeenCalled();
    expect(getMyWithdrawalStatus).not.toHaveBeenCalled();
  });

  it("shows the generic error state on a rejected fetch -- e.g. a 403 from the route", async () => {
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    getMyWithdrawalStatus.mockRejectedValue(new Error("You don't have permission to do that."));

    render(<WithdrawMoneyPage />);

    expect(await screen.findByText("You don't have permission to do that.")).toBeInTheDocument();
  });

  it("fetches the caller's own withdrawal status via partyType/shareId resolved from the URL", async () => {
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    getMyWithdrawalStatus.mockResolvedValue(makeWithdrawalStatus());

    render(<WithdrawMoneyPage />);

    await waitFor(() => expect(getMyWithdrawalStatus).toHaveBeenCalledWith("project-1", "partner", "partner-xyz"));
    expect(await screen.findByText("My Project -- your own withdrawals.")).toBeInTheDocument();
    expect(screen.getByText("Can Take")).toBeInTheDocument();
    expect(screen.getByText("Effective Can Take")).toBeInTheDocument();
  });

  it("resolves partyType/shareId from subPartnerId when that's what's in the URL", async () => {
    mockSearchParams = new URLSearchParams({ subPartnerId: "sub-abc" });
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    getMyWithdrawalStatus.mockResolvedValue(
      makeWithdrawalStatus({ partnerId: undefined, subPartnerId: "sub-abc" }),
    );

    render(<WithdrawMoneyPage />);

    await waitFor(() =>
      expect(getMyWithdrawalStatus).toHaveBeenCalledWith("project-1", "sub_partner", "sub-abc"),
    );
  });

  it("submitting the Withdraw Money dialog posts against the caller's own share and refreshes the status", async () => {
    const user = userEvent.setup();
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    getMyWithdrawalStatus.mockResolvedValue(makeWithdrawalStatus());
    recordWithdrawalTransaction.mockResolvedValue({ id: "wtx-1" });

    render(<WithdrawMoneyPage />);
    await screen.findByText("My Project -- your own withdrawals.");

    await user.click(screen.getByRole("button", { name: "Withdraw Money" }));
    await user.type(screen.getByLabelText("Amount"), "30000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(recordWithdrawalTransaction).toHaveBeenCalledTimes(1));
    const [projectId, input] = recordWithdrawalTransaction.mock.calls[0];
    expect(projectId).toBe("project-1");
    expect(input).toMatchObject({ partyType: "partner", shareId: "partner-xyz", amount: "30000" });
  });

  it("shows the server's error message inline when the submit exceeds Can Take (403)", async () => {
    const user = userEvent.setup();
    getOwnershipStructure.mockResolvedValue({ projectId: "project-1", projectName: "My Project" });
    getMyWithdrawalStatus.mockResolvedValue(makeWithdrawalStatus());
    recordWithdrawalTransaction.mockRejectedValue(new Error("This exceeds your Can Take."));

    render(<WithdrawMoneyPage />);
    await screen.findByText("My Project -- your own withdrawals.");
    await user.click(screen.getByRole("button", { name: "Withdraw Money" }));
    await user.type(screen.getByLabelText("Amount"), "999999");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This exceeds your Can Take.");
  });
});

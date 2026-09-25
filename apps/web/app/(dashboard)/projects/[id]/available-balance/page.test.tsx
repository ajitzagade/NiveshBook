// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ListAvailableBalancesResponse } from "@/lib/available-balances";
import AvailableBalancePage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-1" }),
}));

const listAvailableBalances = vi.fn();
const spendAvailableBalance = vi.fn();

vi.mock("@/lib/available-balances", () => ({
  listAvailableBalances: (...args: unknown[]) => listAvailableBalances(...args),
  spendAvailableBalance: (...args: unknown[]) => spendAvailableBalance(...args),
}));

const listProjects = vi.fn();

vi.mock("@/lib/projects", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
}));

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

const ONE_PARTNER_ZERO_BALANCE: ListAvailableBalancesResponse = {
  partners: [{ partnerId: "a", name: "Partner A", sharePercent: "50", balance: "0", subPartners: [] }],
};

const ONE_PARTNER_WITH_BALANCE: ListAvailableBalancesResponse = {
  partners: [
    {
      partnerId: "a",
      name: "Partner A",
      sharePercent: "50",
      balance: "50000.00",
      subPartners: [
        { subPartnerId: "sub-1", name: "Sub One", sharePercent: "10", balance: "5000.00" },
      ],
    },
  ],
};

beforeEach(() => {
  listAvailableBalances.mockReset();
  spendAvailableBalance.mockReset();
  listProjects.mockReset();
  listProjects.mockResolvedValue([]);
  listInvestmentRequirements.mockReset();
  listPartnerShares.mockReset();
  listSubPartnerShares.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AvailableBalancePage (Story 4.9, FR29)", () => {
  it("shows a loading state, then the loaded balances", async () => {
    listAvailableBalances.mockResolvedValue(ONE_PARTNER_WITH_BALANCE);

    render(<AvailableBalancePage />);

    expect(screen.getByText(/loading available balance/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Partner A")).toBeInTheDocument());
    expect(screen.getByText(/sub one/i)).toBeInTheDocument();
  });

  it("shows the error state when the fetch fails", async () => {
    listAvailableBalances.mockRejectedValue(new Error("Boom"));

    render(<AvailableBalancePage />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Boom"));
  });

  it("shows the empty state when there are no current Partner Shares", async () => {
    listAvailableBalances.mockResolvedValue({ partners: [] });

    render(<AvailableBalancePage />);

    await waitFor(() => expect(screen.getByText(/no partner shares yet/i)).toBeInTheDocument());
  });

  it("disables 'Use Balance' for a row with a zero balance", async () => {
    listAvailableBalances.mockResolvedValue(ONE_PARTNER_ZERO_BALANCE);

    render(<AvailableBalancePage />);

    await waitFor(() => expect(screen.getByText("Partner A")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /use balance/i })).toBeDisabled();
  });

  it("opens the Use Balance dialog showing the row's current balance, and saves a 'Give to a Person' spend", async () => {
    const user = userEvent.setup();
    listAvailableBalances.mockResolvedValue(ONE_PARTNER_WITH_BALANCE);
    spendAvailableBalance.mockResolvedValue({
      spend: { id: "spend-1" },
      investmentTransaction: null,
      moneyMovement: null,
    });

    render(<AvailableBalancePage />);

    await waitFor(() => expect(screen.getByText("Partner A")).toBeInTheDocument());
    const useBalanceButtons = screen.getAllByRole("button", { name: /use balance/i });
    await user.click(useBalanceButtons[0] as HTMLElement);

    expect(screen.getByText(/use balance — partner a/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^amount$/i), "20000");
    await user.type(screen.getByLabelText(/person's name/i), "Person X");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(spendAvailableBalance).toHaveBeenCalledTimes(1));
    const [projectId, input] = spendAvailableBalance.mock.calls[0] as [string, Record<string, unknown>];
    expect(projectId).toBe("project-1");
    expect(input).toMatchObject({
      partyType: "partner",
      shareId: "a",
      destinationType: "person",
      amount: "20000",
      personName: "Person X",
    });
  });

  it("blocks Save client-side when the amount exceeds the row's current balance", async () => {
    const user = userEvent.setup();
    listAvailableBalances.mockResolvedValue(ONE_PARTNER_WITH_BALANCE);

    render(<AvailableBalancePage />);

    await waitFor(() => expect(screen.getByText("Partner A")).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: /use balance/i })[0] as HTMLElement);

    await user.type(screen.getByLabelText(/^amount$/i), "999999");
    await user.type(screen.getByLabelText(/person's name/i), "Person X");

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/must be greater than zero and not exceed/i)).toBeInTheDocument();
    expect(spendAvailableBalance).not.toHaveBeenCalled();
  });

  it("saves an 'Invest in a Project' spend with a resolved requirement/Share", async () => {
    const user = userEvent.setup();
    listAvailableBalances.mockResolvedValue(ONE_PARTNER_WITH_BALANCE);
    listProjects.mockResolvedValue([{ id: "project-2", name: "Project Two", description: null, createdAt: "", updatedAt: "" }]);
    listInvestmentRequirements.mockResolvedValue({
      requirements: [{ id: "req-1", projectId: "project-2", amount: "1000000", requirementDate: "2026-10-01", createdAt: "" }],
    });
    listPartnerShares.mockResolvedValue({ shares: [{ partnerId: "dest-partner", name: "Dest Partner", sharePercent: "100" }] });
    listSubPartnerShares.mockResolvedValue({ shares: [] });
    spendAvailableBalance.mockResolvedValue({
      spend: { id: "spend-2" },
      investmentTransaction: { id: "tx-1" },
      moneyMovement: { id: "mv-1" },
    });

    render(<AvailableBalancePage />);

    await waitFor(() => expect(screen.getByText("Partner A")).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: /use balance/i })[0] as HTMLElement);

    await user.selectOptions(screen.getByLabelText(/^destination$/i), "project");
    await waitFor(() => expect(listProjects).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/destination project/i), "project-2");

    await waitFor(() => expect(listInvestmentRequirements).toHaveBeenCalledWith("project-2"));
    await user.selectOptions(await screen.findByLabelText(/destination funding requirement/i), "req-1");
    await user.selectOptions(screen.getByLabelText(/destination partner\/sub-partner share/i), "partner:dest-partner");

    await user.type(screen.getByLabelText(/^amount$/i), "30000");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(spendAvailableBalance).toHaveBeenCalledTimes(1));
    const [, input] = spendAvailableBalance.mock.calls[0] as [string, Record<string, unknown>];
    expect(input).toMatchObject({
      destinationType: "project",
      destinationProjectId: "project-2",
      destinationRequirementId: "req-1",
      destinationShareId: "dest-partner",
      destinationPartyType: "partner",
      amount: "30000",
    });
  });
});

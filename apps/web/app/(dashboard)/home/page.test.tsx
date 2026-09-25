import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { PartnerOverviewRow } from "@niveshbook/core";
import type {
  AvailableBalance,
  InvestmentTransaction,
  Money,
  PartnerShare,
  Percent,
  Project,
  SubPartnerShare,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { AdjustPersonCard, EmptyState, StatCard } from "@niveshbook/ui";
import DashboardHomePage, { PartnerOverviewCard } from "./page";

const investmentListAll = vi.fn();
const withdrawalListAll = vi.fn();
const availableBalanceListAll = vi.fn();
const partnerShareListAll = vi.fn();
const subPartnerShareListAll = vi.fn();
const listProjects = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    cancelTransaction: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    listAll: investmentListAll,
  }),
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    cancelTransaction: vi.fn(),
    listAll: withdrawalListAll,
  }),
  createAvailableBalancePort: () => ({
    creditBalance: vi.fn(),
    debitBalance: vi.fn(),
    listBalancesByProjectId: vi.fn(),
    findBalance: vi.fn(),
    listAll: availableBalanceListAll,
  }),
  createPartnerSharePort: () => ({
    createPartnerShare: vi.fn(),
    findLatestByPartnerId: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: partnerShareListAll,
  }),
  createSubPartnerSharePort: () => ({
    createSubPartnerShare: vi.fn(),
    findLatestBySubPartnerId: vi.fn(),
    listByPartnerId: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: subPartnerShareListAll,
  }),
  createProjectPort: () => ({
    createProject: vi.fn(),
    updateProject: vi.fn(),
    findProjectById: vi.fn(),
    listProjects,
  }),
}));

/** Collects every element of the given type anywhere in the tree (arrays and `props.children` both walked) -- mirrors `apps/web/app/page.test.tsx`'s `findComponent` helper, generalized to return every match instead of just the first (this page renders 4 `StatCard`s and N `PartnerOverviewCard`s, not just one of interest). */
function collectComponents(node: ReactNode, type: unknown, results: ReactElement[]): void {
  if (node === null || node === undefined || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectComponents(child, type, results);
    }
    return;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) {
    results.push(element);
  }
  collectComponents(element.props?.children, type, results);
}

function findAllComponents(node: ReactNode, type: unknown): ReactElement[] {
  const results: ReactElement[] = [];
  collectComponents(node, type, results);
  return results;
}

function containsComponent(node: ReactNode, type: unknown): boolean {
  return findAllComponents(node, type).length > 0;
}

function makeInvestmentTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "inv-1",
    requirementId: "req-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "100" as Percent,
    shouldPaySnapshot: "1000000" as Money,
    amount: "1000000" as Money,
    transactionDate: "2026-09-01",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWithdrawalTransaction(overrides: Partial<WithdrawalTransaction> = {}): WithdrawalTransaction {
  return {
    id: "wd-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "100" as Percent,
    canTakeSnapshot: "1000000" as Money,
    amount: "400000" as Money,
    transactionDate: "2026-09-10",
    paymentMode: "cash",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAvailableBalance(overrides: Partial<AvailableBalance> = {}): AvailableBalance {
  return {
    id: "bal-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    balance: "0" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "share-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Asha",
    sharePercent: "100" as Percent,
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-a",
    name: "Project A",
    description: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePartnerOverviewRow(overrides: Partial<PartnerOverviewRow> = {}): PartnerOverviewRow {
  return {
    partnerId: "partner-1",
    name: "Asha",
    projectId: "project-a",
    projectName: "Project A",
    invested: "300000" as Money,
    withdrawn: "50000" as Money,
    availableBalance: "20000" as Money,
    netPosition: "250000" as Money,
    ...overrides,
  };
}

describe("DashboardHomePage (Owner/Admin Dashboard, Story 5.4)", () => {
  beforeEach(() => {
    investmentListAll.mockReset().mockResolvedValue([]);
    withdrawalListAll.mockReset().mockResolvedValue([]);
    availableBalanceListAll.mockReset().mockResolvedValue([]);
    partnerShareListAll.mockReset().mockResolvedValue([]);
    subPartnerShareListAll.mockReset().mockResolvedValue([]);
    listProjects.mockReset().mockResolvedValue([]);
  });

  /**
   * Review finding (2026-09-25): `PartnerOverviewCard` was previously only
   * ever asserted on as an opaque wrapper (matched by reference, never
   * looked inside) -- nothing proved it actually renders `AdjustPersonCard`
   * (`packages/ui`) rather than a hand-rolled duplicate (AGENTS.md's UI
   * reuse rule). Calling the component function directly and walking ITS
   * OWN returned tree (rather than `DashboardHomePage()`'s tree, which never
   * expands `PartnerOverviewCard`'s own internals since it's an unexecuted
   * element there) proves the real child component is used, with the
   * row's own data threaded through to the right props.
   */
  it("PartnerOverviewCard genuinely renders AdjustPersonCard (packages/ui), not a hand-rolled duplicate", () => {
    const row = makePartnerOverviewRow({ name: "Deepa", projectName: "Project Z" });

    const rendered = PartnerOverviewCard({ row });

    const cards = findAllComponents(rendered, AdjustPersonCard);
    expect(cards).toHaveLength(1);
    const props = cards[0]?.props as { name: string; lines: Array<{ label: string }> };
    expect(props.name).toBe("Deepa — Project Z");
    expect(props.lines.map((line) => line.label)).toEqual(["Invested", "Withdrawn", "Available Balance"]);
  });

  it("empty case: renders all 4 stat cards at '0' and EmptyState (not a crash) when there are zero current Partner Shares", async () => {
    const result = await DashboardHomePage();

    const statCards = findAllComponents(result, StatCard);
    expect(statCards).toHaveLength(4);
    for (const card of statCards) {
      expect((card.props as { value: unknown }).value).toBe("0");
    }

    expect(containsComponent(result, EmptyState)).toBe(true);
    expect(findAllComponents(result, PartnerOverviewCard)).toHaveLength(0);
  });

  it("populated case: renders correct numbers across all 5 cards, including the Sub-partner-rolls-into-parent-Partner rollup", async () => {
    investmentListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "inv-1", partyType: "partner", shareId: "partner-1", amount: "700000" as Money }),
      makeInvestmentTransaction({
        id: "inv-2",
        partyType: "sub_partner",
        shareId: "sub-1",
        amount: "200000" as Money,
      }),
      makeInvestmentTransaction({ id: "inv-cancelled", amount: "999999" as Money, status: "cancelled" }),
    ]);
    withdrawalListAll.mockResolvedValue([
      makeWithdrawalTransaction({ id: "wd-1", partyType: "partner", shareId: "partner-1", amount: "300000" as Money }),
    ]);
    availableBalanceListAll.mockResolvedValue([
      makeAvailableBalance({ id: "bal-1", partyType: "partner", shareId: "partner-1", balance: "50000" as Money }),
      makeAvailableBalance({ id: "bal-2", partyType: "sub_partner", shareId: "sub-1", balance: "10000" as Money }),
    ]);
    partnerShareListAll.mockResolvedValue([makePartnerShare({ partnerId: "partner-1", name: "Asha" })]);
    subPartnerShareListAll.mockResolvedValue([
      {
        id: "sub-share-1",
        subPartnerId: "sub-1",
        partnerId: "partner-1",
        projectId: "project-a",
        name: "Bala",
        sharePercent: "50" as Percent,
        userId: null,
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } satisfies SubPartnerShare,
    ]);
    listProjects.mockResolvedValue([makeProject({ id: "project-a", name: "Project A" })]);

    const result = await DashboardHomePage();

    const statCards = findAllComponents(result, StatCard);
    expect(statCards).toHaveLength(4);
    const byLabel = Object.fromEntries(
      statCards.map((card) => [(card.props as { label: string }).label, (card.props as { value: unknown }).value]),
    );
    // Total Added = 700000 (partner) + 200000 (sub-partner) = 900000 (cancelled excluded)
    expect(byLabel["Total Added"]).toBe("900000");
    expect(byLabel["Total Withdrawn"]).toBe("300000");
    // Total Project Money = 900000 - 300000 = 600000
    expect(byLabel["Total Project Money"]).toBe("600000");
    // Available Balance = 50000 (partner) + 10000 (sub-partner) = 60000
    expect(byLabel["Available Balance"]).toBe("60000");

    expect(containsComponent(result, EmptyState)).toBe(false);
    const overviewCards = findAllComponents(result, PartnerOverviewCard);
    expect(overviewCards).toHaveLength(1);
    const row = (overviewCards[0]?.props as { row: { invested: string; withdrawn: string; availableBalance: string; name: string; projectName: string } }).row;
    expect(row.name).toBe("Asha");
    expect(row.projectName).toBe("Project A");
    // The Sub-partner's own activity (900000-700000=200000 invested, 10000 balance) rolled into the parent Partner's row.
    expect(row.invested).toBe("900000");
    expect(row.withdrawn).toBe("300000");
    expect(row.availableBalance).toBe("60000");
  });

  /**
   * Review finding (2026-09-25): the prior "populated case" test only ever
   * had ONE `currentPartnerShares` entry (its "second partner" in the
   * fixture was actually a Sub-partner, which correctly gets no own row) --
   * so `summary.partnerOverview.map(...)`'s rendering of MULTIPLE
   * `PartnerOverviewCard`s was never exercised at the page/component level,
   * only at the pure-function level (`owner-admin-dashboard.test.ts`, which
   * proves the DATA is right but not that the PAGE renders every row -- a
   * stale `key`, an off-by-one slice, or an early `return` after the first
   * row would all still pass a single-row fixture).
   */
  it("multi-Partner, multi-Project case: renders one PartnerOverviewCard per current Partner Share, each with its own correct numbers", async () => {
    partnerShareListAll.mockResolvedValue([
      makePartnerShare({ id: "share-1", partnerId: "partner-1", name: "Asha", projectId: "project-a" }),
      makePartnerShare({ id: "share-2", partnerId: "partner-2", name: "Chetan", projectId: "project-b" }),
    ]);
    investmentListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "inv-1", projectId: "project-a", partyType: "partner", shareId: "partner-1", amount: "700000" as Money }),
      makeInvestmentTransaction({ id: "inv-2", projectId: "project-b", partyType: "partner", shareId: "partner-2", amount: "150000" as Money }),
    ]);
    withdrawalListAll.mockResolvedValue([
      makeWithdrawalTransaction({ id: "wd-1", projectId: "project-a", partyType: "partner", shareId: "partner-1", amount: "100000" as Money }),
    ]);
    availableBalanceListAll.mockResolvedValue([
      makeAvailableBalance({ id: "bal-1", projectId: "project-b", partyType: "partner", shareId: "partner-2", balance: "30000" as Money }),
    ]);
    listProjects.mockResolvedValue([
      makeProject({ id: "project-a", name: "Project A" }),
      makeProject({ id: "project-b", name: "Project B" }),
    ]);

    const result = await DashboardHomePage();

    const overviewCards = findAllComponents(result, PartnerOverviewCard);
    expect(overviewCards).toHaveLength(2);

    const rows = overviewCards.map(
      (card) => (card.props as { row: { partnerId: string; projectName: string; invested: string; withdrawn: string; availableBalance: string } }).row,
    );
    const asha = rows.find((row) => row.partnerId === "partner-1");
    const chetan = rows.find((row) => row.partnerId === "partner-2");

    expect(asha).toMatchObject({ projectName: "Project A", invested: "700000", withdrawn: "100000", availableBalance: "0" });
    expect(chetan).toMatchObject({ projectName: "Project B", invested: "150000", withdrawn: "0", availableBalance: "30000" });
  });

  it("Total Project Money data-integrity edge case: withdrawn >= added clamps to '0' instead of throwing", async () => {
    investmentListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "inv-1", amount: "100000" as Money }),
    ]);
    withdrawalListAll.mockResolvedValue([
      makeWithdrawalTransaction({ id: "wd-1", amount: "500000" as Money }),
    ]);

    const result = await DashboardHomePage();

    const statCards = findAllComponents(result, StatCard);
    const byLabel = Object.fromEntries(
      statCards.map((card) => [(card.props as { label: string }).label, (card.props as { value: unknown }).value]),
    );
    expect(byLabel["Total Project Money"]).toBe("0");
  });
});

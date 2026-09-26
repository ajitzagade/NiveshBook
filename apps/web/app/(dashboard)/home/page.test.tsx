import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { redirect } from "next/navigation";
import type { PartnerOverviewRow } from "@niveshbook/core";
import type {
  AvailableBalance,
  InvestmentAdjustment,
  InvestmentTransaction,
  Money,
  PartnerShare,
  Percent,
  Project,
  SubPartnerShare,
  WithdrawalAdjustment,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { AdjustPersonCard, EmptyState, ShareRow, StatCard } from "@niveshbook/ui";
import DashboardHomePage, { formatSharePercent, PartnerOverviewCard } from "./page";

const investmentListAll = vi.fn();
const withdrawalListAll = vi.fn();
const availableBalanceListAll = vi.fn();
const investmentAdjustmentListAll = vi.fn();
const withdrawalAdjustmentListAll = vi.fn();
const partnerShareListAll = vi.fn();
const subPartnerShareListAll = vi.fn();
const listProjects = vi.fn();
const findUserById = vi.fn();
// `requireSession` is referenced directly in the "@/lib/session-guard" mock
// factory below, evaluated eagerly the moment that factory runs (unlike
// `findUserById` above, only read inside a nested `() => (...)` closure) --
// `vi.hoisted()` genuinely runs before every `vi.mock()` factory, unlike a
// plain top-level `const` (mirrors `layout.test.tsx`'s identical fix).
const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));

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
  createInvestmentAdjustmentPort: () => ({
    upsert: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: investmentAdjustmentListAll,
  }),
  createWithdrawalAdjustmentPort: () => ({
    upsert: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: withdrawalAdjustmentListAll,
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
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById,
    listAllUsers: vi.fn(),
  }),
}));

vi.mock("@/lib/session-guard", () => ({
  requireSession,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
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

/**
 * Flattens a `ShareRow`'s own `input` prop (a small JSX tree, e.g.
 * `<span>{formatSharePercent(...)}%</span>`) down to its plain rendered
 * text -- review finding (2026-09-25): every prior Partner-dashboard test
 * asserted on `ShareRow`'s `name` prop but never on `input`, so "My Share
 * %" (one of the frozen AC's 9 named data points) had zero coverage of its
 * actual rendered/formatted output.
 */
function shareRowInputText(row: ReactElement): string {
  const input = (row.props as { input: ReactElement<{ children: ReactNode }> }).input;
  const children = input.props.children;
  return (Array.isArray(children) ? children : [children]).join("");
}

/**
 * Finds the first `href` anywhere inside a `ShareRow`'s `action` subtree
 * (Story 5.10's "View Structure" `Link`, nested inside a `Button asChild`) --
 * mirrors `findAllComponents`'s own recursive-tree-walking approach, but
 * hunting for a prop rather than a component type.
 */
function findHref(node: ReactNode): string | undefined {
  if (node === null || node === undefined || typeof node !== "object") {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findHref(child);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as ReactElement<{ href?: string; children?: ReactNode }>;
  if (typeof element.props?.href === "string") {
    return element.props.href;
  }
  return findHref(element.props?.children);
}

function shareRowActionHref(row: ReactElement): string | undefined {
  return findHref((row.props as { action?: ReactNode }).action);
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

function makeInvestmentAdjustment(overrides: Partial<InvestmentAdjustment> = {}): InvestmentAdjustment {
  return {
    id: "adj-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    requirementId: "req-1",
    shouldPay: "100000" as Money,
    actualPaid: "60000" as Money,
    adjustmentType: "pending",
    adjustmentAmount: "40000" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWithdrawalAdjustment(overrides: Partial<WithdrawalAdjustment> = {}): WithdrawalAdjustment {
  return {
    id: "wadj-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    canTake: "100000" as Money,
    taken: "60000" as Money,
    adjustmentType: "keep_for_later",
    adjustmentAmount: "40000" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Every port's fetch defaults to empty, and the actor resolves to `owner_admin` by default -- individual tests override `findUserById` to switch role. */
beforeEach(() => {
  investmentListAll.mockReset().mockResolvedValue([]);
  withdrawalListAll.mockReset().mockResolvedValue([]);
  availableBalanceListAll.mockReset().mockResolvedValue([]);
  investmentAdjustmentListAll.mockReset().mockResolvedValue([]);
  withdrawalAdjustmentListAll.mockReset().mockResolvedValue([]);
  partnerShareListAll.mockReset().mockResolvedValue([]);
  subPartnerShareListAll.mockReset().mockResolvedValue([]);
  listProjects.mockReset().mockResolvedValue([]);
  requireSession.mockReset().mockResolvedValue({ id: "session-1", userId: "user-1" });
  findUserById.mockReset().mockResolvedValue({ id: "user-1", role: "owner_admin", active: true });
  (redirect as unknown as Mock).mockClear();
});

describe("DashboardHomePage (Owner/Admin Dashboard, Story 5.4, unchanged by Story 5.5)", () => {

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

describe("DashboardHomePage (Partner Dashboard, Story 5.5)", () => {
  beforeEach(() => {
    findUserById.mockResolvedValue({ id: "user-1", role: "partner", active: true });
  });

  it("empty case: zero linked Partner Shares -- all 6 stat cards at '0', both EmptyStates render, not a crash", async () => {
    const result = await DashboardHomePage();

    const statCards = findAllComponents(result, StatCard);
    expect(statCards).toHaveLength(6);
    for (const card of statCards) {
      expect((card.props as { value: unknown }).value).toBe("0");
    }

    expect(findAllComponents(result, EmptyState)).toHaveLength(2);
    expect(findAllComponents(result, ShareRow)).toHaveLength(0);
  });

  it("populated case: one linked Partner Share with activity -- correct numbers, scoped to this actor only", async () => {
    partnerShareListAll.mockResolvedValue([
      // "70.0000" (not the bare "70" a hand-typed fixture would use)
      // deliberately mirrors Postgres's own `numeric(7,4)` round-trip shape,
      // so this test proves `formatSharePercent()`'s trailing-zero trim is
      // actually wired into the rendered "My Share %" badge, not just
      // passing an already-clean value straight through untouched.
      makePartnerShare({ partnerId: "partner-1", userId: "user-1", sharePercent: "70.0000" as Percent }),
      // A different Partner (different userId) at the same Project -- must never leak into this actor's totals.
      makePartnerShare({
        id: "share-other",
        partnerId: "partner-other",
        userId: "someone-else",
        name: "Deepa",
      }),
    ]);
    investmentListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "inv-1", partyType: "partner", shareId: "partner-1", amount: "700000" as Money }),
      makeInvestmentTransaction({ id: "inv-other", partyType: "partner", shareId: "partner-other", amount: "999999" as Money }),
    ]);
    withdrawalListAll.mockResolvedValue([
      makeWithdrawalTransaction({ id: "wd-1", partyType: "partner", shareId: "partner-1", amount: "200000" as Money }),
    ]);
    availableBalanceListAll.mockResolvedValue([
      makeAvailableBalance({ id: "bal-1", partyType: "partner", shareId: "partner-1", balance: "50000" as Money }),
    ]);
    investmentAdjustmentListAll.mockResolvedValue([
      makeInvestmentAdjustment({ id: "adj-1", shareId: "partner-1", adjustmentType: "pending", adjustmentAmount: "30000" as Money }),
      makeInvestmentAdjustment({ id: "adj-2", shareId: "partner-1", requirementId: "req-2", adjustmentType: "extra_paid", adjustmentAmount: "5000" as Money }),
    ]);
    withdrawalAdjustmentListAll.mockResolvedValue([
      makeWithdrawalAdjustment({ id: "wadj-1", shareId: "partner-1", adjustmentType: "keep_for_later", adjustmentAmount: "15000" as Money }),
    ]);
    subPartnerShareListAll.mockResolvedValue([
      {
        id: "sub-share-1",
        subPartnerId: "sub-1",
        partnerId: "partner-1",
        projectId: "project-a",
        name: "Bala",
        sharePercent: "50.0000" as Percent,
        userId: null,
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } satisfies SubPartnerShare,
    ]);
    listProjects.mockResolvedValue([makeProject({ id: "project-a", name: "Project A" })]);

    const result = await DashboardHomePage();

    const statCards = findAllComponents(result, StatCard);
    expect(statCards).toHaveLength(6);
    const byLabel = Object.fromEntries(
      statCards.map((card) => [(card.props as { label: string }).label, (card.props as { value: unknown }).value]),
    );
    expect(byLabel["Money Added"]).toBe("700000");
    expect(byLabel["Money Withdrawn"]).toBe("200000");
    expect(byLabel["Available Balance"]).toBe("50000");
    expect(byLabel["Pending"]).toBe("30000");
    expect(byLabel["Extra Paid"]).toBe("5000");
    expect(byLabel["Withdrawal Keep for Later"]).toBe("15000");
    // Extra Taken is deliberately not one of the rendered stat cards (this story's Implementation Notes).
    expect(Object.keys(byLabel)).not.toContain("Extra Taken");

    const shareRows = findAllComponents(result, ShareRow);
    expect(shareRows).toHaveLength(2); // 1 "My Projects" row + 1 "My Sub-partners" row
    const names = shareRows.map((row) => (row.props as { name: string }).name);
    expect(names).toContain("Project A");
    expect(names).toContain("Bala — Project A");

    // "My Share %" (one of the frozen AC's 9 named data points): proves the
    // ACTUAL rendered badge text, not just that a ShareRow exists -- both
    // fixtures above used Postgres's own `numeric(7,4)` round-trip shape
    // ("70.0000"/"50.0000"), so this locks in `formatSharePercent()`'s
    // trailing-zero trim end-to-end, not just at the unit level.
    const myProjectsRow = shareRows.find((row) => (row.props as { name: string }).name === "Project A");
    const mySubPartnerRow = shareRows.find((row) => (row.props as { name: string }).name === "Bala — Project A");
    expect(myProjectsRow && shareRowInputText(myProjectsRow)).toBe("70%");
    expect(mySubPartnerRow && shareRowInputText(mySubPartnerRow)).toBe("50%");

    // Story 5.10: "My Projects" gets a "View Structure" action linking to
    // this Partner's own scoped structure view; "My Sub-partners" does not
    // (this story's Code Map -- that action slot stays unused there).
    expect(myProjectsRow && shareRowActionHref(myProjectsRow)).toBe("/structure/project-a?partnerId=partner-1");
    expect(mySubPartnerRow && shareRowActionHref(mySubPartnerRow)).toBeUndefined();

    expect(findAllComponents(result, EmptyState)).toHaveLength(0);
  });

  it("multi-Project case: myProjects shows one row per linked Project; the 6 aggregate totals sum across all of them", async () => {
    partnerShareListAll.mockResolvedValue([
      makePartnerShare({ id: "s1", partnerId: "partner-1", projectId: "project-a", userId: "user-1" }),
      makePartnerShare({ id: "s2", partnerId: "partner-2", projectId: "project-b", userId: "user-1" }),
    ]);
    investmentListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "inv-1", projectId: "project-a", shareId: "partner-1", amount: "100000" as Money }),
      makeInvestmentTransaction({ id: "inv-2", projectId: "project-b", shareId: "partner-2", amount: "250000" as Money }),
    ]);
    listProjects.mockResolvedValue([
      makeProject({ id: "project-a", name: "Project A" }),
      makeProject({ id: "project-b", name: "Project B" }),
    ]);

    const result = await DashboardHomePage();

    const shareRows = findAllComponents(result, ShareRow);
    const projectRowNames = shareRows.map((row) => (row.props as { name: string }).name);
    expect(projectRowNames).toEqual(expect.arrayContaining(["Project A", "Project B"]));

    const statCards = findAllComponents(result, StatCard);
    const byLabel = Object.fromEntries(
      statCards.map((card) => [(card.props as { label: string }).label, (card.props as { value: unknown }).value]),
    );
    expect(byLabel["Money Added"]).toBe("350000");
  });
});

describe("DashboardHomePage role resolution (Story 5.5)", () => {
  it("redirects to / when the actor can no longer be found (defense-in-depth; the layout's own guard should already have caught this)", async () => {
    findUserById.mockResolvedValue(null);

    await expect(DashboardHomePage()).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("redirects to / for a resolvable but unauthorized role (e.g. project_admin) rather than silently rendering the Owner/Admin dashboard", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "project_admin", active: true });

    await expect(DashboardHomePage()).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/");
  });
});

describe("DashboardHomePage (Sub-partner Dashboard, Story 5.6)", () => {
  beforeEach(() => {
    findUserById.mockResolvedValue({ id: "user-1", role: "sub_partner", active: true });
  });

  it("empty case: zero linked Sub-partner Shares -- all 6 stat cards at '0', EmptyState renders, not a crash", async () => {
    const result = await DashboardHomePage();

    const statCards = findAllComponents(result, StatCard);
    expect(statCards).toHaveLength(6);
    for (const card of statCards) {
      expect((card.props as { value: unknown }).value).toBe("0");
    }

    expect(findAllComponents(result, EmptyState)).toHaveLength(1);
    expect(findAllComponents(result, ShareRow)).toHaveLength(0);
  });

  it("populated case: one linked Sub-partner Share with activity -- correct numbers, scoped to this actor only, no My Sub-partners section", async () => {
    subPartnerShareListAll.mockResolvedValue([
      {
        id: "sub-share-1",
        subPartnerId: "sub-1",
        partnerId: "partner-1",
        projectId: "project-a",
        name: "Bala",
        // "40.0000" (not the bare "40" a hand-typed fixture would use)
        // deliberately mirrors Postgres's own `numeric(7,4)` round-trip
        // shape, proving `formatSharePercent()`'s trailing-zero trim is
        // actually wired into the rendered "My Share %" badge here too.
        sharePercent: "40.0000" as Percent,
        userId: "user-1",
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } satisfies SubPartnerShare,
      // A sibling Sub-partner (different userId, same parent Partner) --
      // must never leak into this actor's totals or My Projects list.
      {
        id: "sub-share-2",
        subPartnerId: "sub-2",
        partnerId: "partner-1",
        projectId: "project-a",
        name: "Chetan",
        sharePercent: "10" as Percent,
        userId: "someone-else",
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } satisfies SubPartnerShare,
    ]);
    investmentListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "inv-1", partyType: "sub_partner", shareId: "sub-1", amount: "500000" as Money }),
      // The parent Partner's own activity -- must never leak into totals (Decisions #4).
      makeInvestmentTransaction({ id: "inv-parent", partyType: "partner", shareId: "partner-1", amount: "9999999" as Money }),
      // A sibling Sub-partner's own activity -- must never leak into totals (Decisions #4).
      makeInvestmentTransaction({ id: "inv-sibling", partyType: "sub_partner", shareId: "sub-2", amount: "888888" as Money }),
    ]);
    withdrawalListAll.mockResolvedValue([
      makeWithdrawalTransaction({ id: "wd-1", partyType: "sub_partner", shareId: "sub-1", amount: "150000" as Money }),
    ]);
    availableBalanceListAll.mockResolvedValue([
      makeAvailableBalance({ id: "bal-1", partyType: "sub_partner", shareId: "sub-1", balance: "25000" as Money }),
    ]);
    investmentAdjustmentListAll.mockResolvedValue([
      makeInvestmentAdjustment({ id: "adj-1", partyType: "sub_partner", shareId: "sub-1", adjustmentType: "pending", adjustmentAmount: "20000" as Money }),
      makeInvestmentAdjustment({ id: "adj-2", partyType: "sub_partner", shareId: "sub-1", requirementId: "req-2", adjustmentType: "extra_paid", adjustmentAmount: "3000" as Money }),
    ]);
    withdrawalAdjustmentListAll.mockResolvedValue([
      makeWithdrawalAdjustment({ id: "wadj-1", partyType: "sub_partner", shareId: "sub-1", adjustmentType: "keep_for_later", adjustmentAmount: "8000" as Money }),
    ]);
    listProjects.mockResolvedValue([makeProject({ id: "project-a", name: "Project A" })]);

    const result = await DashboardHomePage();

    const statCards = findAllComponents(result, StatCard);
    expect(statCards).toHaveLength(6);
    const byLabel = Object.fromEntries(
      statCards.map((card) => [(card.props as { label: string }).label, (card.props as { value: unknown }).value]),
    );
    expect(byLabel["Money Added"]).toBe("500000");
    expect(byLabel["Money Withdrawn"]).toBe("150000");
    expect(byLabel["Available Balance"]).toBe("25000");
    expect(byLabel["Pending"]).toBe("20000");
    expect(byLabel["Extra Paid"]).toBe("3000");
    expect(byLabel["Withdrawal Keep for Later"]).toBe("8000");
    expect(Object.keys(byLabel)).not.toContain("Extra Taken");

    const shareRows = findAllComponents(result, ShareRow);
    expect(shareRows).toHaveLength(1); // Only "My Projects" -- no "My Sub-partners" section for this role (Decisions #3)
    expect((shareRows[0]?.props as { name: string }).name).toBe("Project A");
    expect(shareRowInputText(shareRows[0]!)).toBe("40%");

    // Story 5.10: links to this Sub-partner's own scoped structure view --
    // `?subPartnerId=`, never `?partnerId=` (their own even-narrower slice).
    expect(shareRowActionHref(shareRows[0]!)).toBe("/structure/project-a?subPartnerId=sub-1");

    expect(findAllComponents(result, EmptyState)).toHaveLength(0);
  });

  it("multi-Project/multi-Partner case: myProjects shows one row per linked Project; the 6 aggregate totals sum across all of them", async () => {
    subPartnerShareListAll.mockResolvedValue([
      {
        id: "s1",
        subPartnerId: "sub-1",
        partnerId: "partner-1",
        projectId: "project-a",
        name: "Bala",
        sharePercent: "40" as Percent,
        userId: "user-1",
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } satisfies SubPartnerShare,
      {
        id: "s2",
        subPartnerId: "sub-2",
        partnerId: "partner-2",
        projectId: "project-b",
        name: "Bala",
        sharePercent: "25" as Percent,
        userId: "user-1",
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } satisfies SubPartnerShare,
    ]);
    investmentListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "inv-1", projectId: "project-a", partyType: "sub_partner", shareId: "sub-1", amount: "100000" as Money }),
      makeInvestmentTransaction({ id: "inv-2", projectId: "project-b", partyType: "sub_partner", shareId: "sub-2", amount: "250000" as Money }),
    ]);
    listProjects.mockResolvedValue([
      makeProject({ id: "project-a", name: "Project A" }),
      makeProject({ id: "project-b", name: "Project B" }),
    ]);

    const result = await DashboardHomePage();

    const shareRows = findAllComponents(result, ShareRow);
    const projectRowNames = shareRows.map((row) => (row.props as { name: string }).name);
    expect(projectRowNames).toEqual(expect.arrayContaining(["Project A", "Project B"]));

    const statCards = findAllComponents(result, StatCard);
    const byLabel = Object.fromEntries(
      statCards.map((card) => [(card.props as { label: string }).label, (card.props as { value: unknown }).value]),
    );
    expect(byLabel["Money Added"]).toBe("350000");
  });
});

/**
 * Review finding (2026-09-25): "My Share %" -- one of the frozen AC's 9
 * named data points -- previously had zero assertions on its actual
 * formatted output anywhere; `ShareRow`'s `input` prop was never inspected.
 * Direct unit coverage of `formatSharePercent()` itself, plus
 * `shareRowInputText()`-based assertions in the Partner-dashboard tests
 * above, close that gap. Postgres's `numeric(7,4)` column always
 * round-trips at its full declared scale (a stored `"33.33"` reads back as
 * `"33.3300"`) -- these cases exercise that exact trailing-zero trim.
 */
describe("formatSharePercent", () => {
  it("trims trailing fractional zeros, and the trailing decimal point if every fractional digit was zero", () => {
    expect(formatSharePercent("33.3300")).toBe("33.33");
    expect(formatSharePercent("25.0000")).toBe("25");
    expect(formatSharePercent("12.5000")).toBe("12.5");
  });

  it("leaves a whole-number value with no decimal point untouched", () => {
    expect(formatSharePercent("70")).toBe("70");
    expect(formatSharePercent("100")).toBe("100");
  });
});

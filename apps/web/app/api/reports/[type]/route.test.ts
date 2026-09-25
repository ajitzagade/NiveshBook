import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();

const partnerSharesListAll = vi.fn();
const subPartnerSharesListAll = vi.fn();
const listProjects = vi.fn();
const investmentTransactionsListAll = vi.fn();
const withdrawalTransactionsListAll = vi.fn();
const withdrawalDestinationAllocationsListAll = vi.fn();
const moneyMovementsListAll = vi.fn();
const availableBalancesListAll = vi.fn();
const availableBalanceSpendsListAll = vi.fn();
const adjustmentNettingsListAll = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    findSessionByTokenHash,
    touchSession,
    listSessionsByUser: vi.fn(),
    deleteSessionById: vi.fn(),
  }),
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById,
    listAllUsers: vi.fn(),
  }),
  createPartnerSharePort: () => ({
    createPartnerShare: vi.fn(),
    findLatestByPartnerId: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: partnerSharesListAll,
  }),
  createSubPartnerSharePort: () => ({
    createSubPartnerShare: vi.fn(),
    findLatestBySubPartnerId: vi.fn(),
    listByPartnerId: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: subPartnerSharesListAll,
  }),
  createProjectPort: () => ({
    createProject: vi.fn(),
    updateProject: vi.fn(),
    findProjectById: vi.fn(),
    listProjects,
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    cancelTransaction: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    listAll: investmentTransactionsListAll,
  }),
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    cancelTransaction: vi.fn(),
    listAll: withdrawalTransactionsListAll,
  }),
  createWithdrawalDestinationAllocationPort: () => ({
    recordAllocation: vi.fn(),
    listByWithdrawalTransactionId: vi.fn(),
    hasConflictingAllocation: vi.fn(),
    findById: vi.fn(),
    listAll: withdrawalDestinationAllocationsListAll,
  }),
  createMoneyMovementPort: () => ({
    record: vi.fn(),
    listByDestinationProjectId: vi.fn(),
    findByDestinationInvestmentTransactionId: vi.fn(),
    findByWithdrawalDestinationAllocationId: vi.fn(),
    findByAvailableBalanceSpendId: vi.fn(),
    listAll: moneyMovementsListAll,
  }),
  createAvailableBalancePort: () => ({
    creditBalance: vi.fn(),
    debitBalance: vi.fn(),
    listBalancesByProjectId: vi.fn(),
    findBalance: vi.fn(),
    listAll: availableBalancesListAll,
  }),
  createAvailableBalanceSpendPort: () => ({
    recordSpend: vi.fn(),
    findById: vi.fn(),
    listAll: availableBalanceSpendsListAll,
  }),
  createAdjustmentNettingPort: () => ({
    recordNetting: vi.fn(),
    listAll: adjustmentNettingsListAll,
  }),
}));

function makeRequest(type: string, query = "", cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/reports/${type}${query}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function callGet(type: string, query = "", cookie?: string) {
  return GET(makeRequest(type, query, cookie), { params: Promise.resolve({ type }) });
}

const LIVE_SESSION = {
  id: "session-1",
  userId: "owner-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "owner-1",
    email: "owner@niveshbook.test",
    passwordHash: "hash-should-never-leave-server",
    role: "owner_admin",
    active: true,
    canApproveExtraWithdrawal: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const OWNER_USER = makeUser();
const PARTNER_USER = makeUser({ id: "partner-user-a", email: "partner-a@niveshbook.test", role: "partner" });
const SUB_PARTNER_USER = makeUser({ id: "sub-partner-user-a", email: "sub-a@niveshbook.test", role: "sub_partner" });
const OTHER_ROLE_USER = makeUser({ id: "pa-1", email: "pa@niveshbook.test", role: "project_admin" });

const PARTNER_SHARE_PROJECT_A = {
  id: "row-1",
  partnerId: "partner-1",
  projectId: "project-a",
  name: "Partner A",
  sharePercent: "100",
  userId: "partner-user-a",
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const OTHER_PARTNER_SHARE = {
  id: "row-3",
  partnerId: "partner-3",
  projectId: "project-a",
  name: "Someone Else",
  sharePercent: "100",
  userId: "someone-else",
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const SUB_PARTNER_SHARE_PROJECT_A = {
  id: "sub-row-1",
  subPartnerId: "sub-partner-1",
  partnerId: "partner-1",
  projectId: "project-a",
  name: "Sub-partner A",
  sharePercent: "50",
  userId: "sub-partner-user-a",
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const OTHER_SUB_PARTNER_SHARE = {
  id: "sub-row-2",
  subPartnerId: "sub-partner-2",
  partnerId: "partner-3",
  projectId: "project-a",
  name: "Sub-partner B",
  sharePercent: "10",
  userId: "someone-else",
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

function makeInvestmentTransaction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inv-1",
    requirementId: "req-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "100",
    shouldPaySnapshot: "1000000",
    amount: "1000000",
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

function makeWithdrawalTransaction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "wd-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "100",
    canTakeSnapshot: "1000000",
    amount: "500000",
    transactionDate: "2026-09-10",
    paymentMode: "upi",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAvailableBalance(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "bal-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    balance: "500",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLeg(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "leg-1",
    withdrawalTransactionId: "wd-1",
    destinationType: "project",
    amount: "100000",
    destinationProjectId: null,
    personName: null,
    notes: null,
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAdjustmentNetting(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "netting-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    investmentRequirementId: "req-1",
    amount: "50000",
    notes: null,
    actorUserId: "owner-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  partnerSharesListAll.mockReset();
  subPartnerSharesListAll.mockReset();
  listProjects.mockReset();
  investmentTransactionsListAll.mockReset();
  withdrawalTransactionsListAll.mockReset();
  withdrawalDestinationAllocationsListAll.mockReset();
  moneyMovementsListAll.mockReset();
  availableBalancesListAll.mockReset();
  availableBalanceSpendsListAll.mockReset();
  adjustmentNettingsListAll.mockReset();

  partnerSharesListAll.mockResolvedValue([]);
  subPartnerSharesListAll.mockResolvedValue([]);
  listProjects.mockResolvedValue([
    { id: "project-a", name: "Project A", description: null, createdAt: "", updatedAt: "" },
    { id: "project-b", name: "Project B", description: null, createdAt: "", updatedAt: "" },
  ]);
  investmentTransactionsListAll.mockResolvedValue([]);
  withdrawalTransactionsListAll.mockResolvedValue([]);
  withdrawalDestinationAllocationsListAll.mockResolvedValue([]);
  moneyMovementsListAll.mockResolvedValue([]);
  availableBalancesListAll.mockResolvedValue([]);
  availableBalanceSpendsListAll.mockResolvedValue([]);
  adjustmentNettingsListAll.mockResolvedValue([]);
}

function sessionFor(user: ReturnType<typeof makeUser>) {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: user.id });
  findUserById.mockResolvedValue(user);
}

describe("GET /api/reports/[type] (Story 5.7, FR38/FR39)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie, before any data read", async () => {
    const response = await callGet("money-history");

    expect(response.status).toBe(401);
    expect(investmentTransactionsListAll).not.toHaveBeenCalled();
  });

  it("returns 404 for an unrecognized report type slug, not a crash or an empty 200", async () => {
    sessionFor(OWNER_USER);

    const response = await callGet("not-a-real-type", "", `${SESSION_COOKIE_NAME}=t`);

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(investmentTransactionsListAll).not.toHaveBeenCalled();
  });

  // Review finding (Low, real bug): `ACTION_BY_SLUG`/`ENTRY_TYPE_BY_SLUG`
  // used to be plain `{}` object literals, so a slug matching an
  // `Object.prototype` member name resolved to that (truthy) inherited
  // value via the prototype chain -- bypassing the `if (!action)` 404 guard
  // and crashing with an unhandled 500 inside `authorizeScope()` instead.
  // Fixed via `Object.create(null)`-based lookup tables; this proves the
  // fix, for every prototype member name an attacker could plausibly probe.
  it.each(["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"])(
    "returns 404, not a 500, for the prototype-chain probe slug %s",
    async (slug) => {
      sessionFor(OWNER_USER);

      const response = await callGet(slug, "", `${SESSION_COOKIE_NAME}=t`);

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("not_found");
      expect(investmentTransactionsListAll).not.toHaveBeenCalled();
    },
  );

  // Every one of the 10 slugs, run through the shared dispatch, proves
  // authorizeScope() runs before any port read (AD-1) -- not just for one
  // representative branch.
  const ALL_SLUGS = [
    "project-money",
    "partner",
    "sub-partner",
    "money-added",
    "withdrawal",
    "available-balance",
    "money-movement",
    "payment-mode",
    "adjustment",
    "money-history",
  ];

  it.each(ALL_SLUGS)("returns 403 for project_admin (granted nothing) on %s, before any data read", async (slug) => {
    sessionFor(OTHER_ROLE_USER);

    const response = await callGet(slug, "", `${SESSION_COOKIE_NAME}=t`);

    expect(response.status).toBe(403);
    expect(investmentTransactionsListAll).not.toHaveBeenCalled();
    expect(availableBalancesListAll).not.toHaveBeenCalled();
    expect(partnerSharesListAll).not.toHaveBeenCalled();
  });

  describe("reports:money_movement — owner_admin-only (the single most security-sensitive grant in this story)", () => {
    it("200s for owner_admin", async () => {
      sessionFor(OWNER_USER);

      const response = await callGet("money-movement", "", `${SESSION_COOKIE_NAME}=t`);

      expect(response.status).toBe(200);
    });

    it("403s for partner, before any data read", async () => {
      sessionFor(PARTNER_USER);

      const response = await callGet("money-movement", "", `${SESSION_COOKIE_NAME}=t`);

      expect(response.status).toBe(403);
      expect(investmentTransactionsListAll).not.toHaveBeenCalled();
    });

    it("403s for sub_partner, before any data read", async () => {
      sessionFor(SUB_PARTNER_USER);

      const response = await callGet("money-movement", "", `${SESSION_COOKIE_NAME}=t`);

      expect(response.status).toBe(403);
      expect(investmentTransactionsListAll).not.toHaveBeenCalled();
    });
  });

  describe("money-history-based report types (Decision #3)", () => {
    it("money-added narrows to type === money_added only", async () => {
      sessionFor(OWNER_USER);
      investmentTransactionsListAll.mockResolvedValue([makeInvestmentTransaction({ id: "inv-1" })]);
      withdrawalTransactionsListAll.mockResolvedValue([makeWithdrawalTransaction({ id: "wd-1" })]);

      const response = await callGet("money-added", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].type).toBe("money_added");
    });

    it("withdrawal narrows to type === money_withdrawn only", async () => {
      sessionFor(OWNER_USER);
      investmentTransactionsListAll.mockResolvedValue([makeInvestmentTransaction({ id: "inv-1" })]);
      withdrawalTransactionsListAll.mockResolvedValue([makeWithdrawalTransaction({ id: "wd-1" })]);

      const response = await callGet("withdrawal", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].type).toBe("money_withdrawn");
    });

    it("money-history returns every entry, unfiltered by type", async () => {
      sessionFor(OWNER_USER);
      investmentTransactionsListAll.mockResolvedValue([makeInvestmentTransaction({ id: "inv-1" })]);
      withdrawalTransactionsListAll.mockResolvedValue([makeWithdrawalTransaction({ id: "wd-1" })]);

      const response = await callGet("money-history", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toHaveLength(2);
    });

    it("payment-mode groups entries by paymentMode, summing amount", async () => {
      sessionFor(OWNER_USER);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({ id: "inv-1", paymentMode: "neft", amount: "1000" }),
        makeInvestmentTransaction({ id: "inv-2", paymentMode: "neft", amount: "2000" }),
      ]);

      const response = await callGet("payment-mode", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toEqual([{ paymentMode: "neft", totalAmount: "3000", entryCount: 2 }]);
    });

    it("a partner only sees their own entries -- money-added report", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({ id: "mine", shareId: "partner-1" }),
        makeInvestmentTransaction({ id: "not-mine", shareId: "partner-3" }),
      ]);

      const response = await callGet("money-added", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["mine"]);
    });
  });

  describe("Project Money report (aggregate)", () => {
    it("owner_admin sees every Project system-wide", async () => {
      sessionFor(OWNER_USER);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({ id: "inv-a", projectId: "project-a", shareId: "partner-1" }),
        makeInvestmentTransaction({ id: "inv-b", projectId: "project-b", shareId: "partner-2" }),
      ]);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A]);

      const response = await callGet("project-money", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows.map((r: { projectId: string }) => r.projectId).sort()).toEqual(["project-a", "project-b"]);
    });

    it("a partner never sees another partner's money on a shared Project", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({ id: "mine", projectId: "project-a", shareId: "partner-1", amount: "111" }),
        makeInvestmentTransaction({
          id: "not-mine",
          projectId: "project-a",
          shareId: "partner-3",
          amount: "999999",
        }),
      ]);

      const response = await callGet("project-money", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toEqual([
        { projectId: "project-a", projectName: "Project A", totalAdded: "111", totalWithdrawn: "0", totalAvailableBalance: "0" },
      ]);
    });

    // Review finding (High): the spec's own I/O matrix explicitly names
    // `sub_partner` for this report type ("3 rows for partner/sub_partner"),
    // but no test anywhere previously populated `subPartnerSharesListAll`
    // and confirmed a `sub_partner` actor gets correctly-scoped rows at
    // this (real Postgres-backed, mocked-at-the-port-boundary) route layer
    // -- mirrors the partner case immediately above, one role down.
    it("a sub_partner never sees another party's money on a shared Project", async () => {
      sessionFor(SUB_PARTNER_USER);
      subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({
          id: "mine",
          projectId: "project-a",
          partyType: "sub_partner",
          shareId: "sub-partner-1",
          amount: "222",
        }),
        makeInvestmentTransaction({
          id: "not-mine",
          projectId: "project-a",
          partyType: "sub_partner",
          shareId: "sub-partner-2",
          amount: "999999",
        }),
      ]);

      const response = await callGet("project-money", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toEqual([
        { projectId: "project-a", projectName: "Project A", totalAdded: "222", totalWithdrawn: "0", totalAvailableBalance: "0" },
      ]);
    });
  });

  describe("Partner report (aggregate)", () => {
    it("a sub_partner generating the Partner report gets zero rows -- falls out naturally, not a special case (Decision #5 regression)", async () => {
      sessionFor(SUB_PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);

      const response = await callGet("partner", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.rows).toEqual([]);
    });

    it("a partner sees only their own current Partner Share row, never another Partner's", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);

      const response = await callGet("partner", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows.map((r: { partnerId: string }) => r.partnerId)).toEqual(["partner-1"]);
    });
  });

  describe("Sub-partner report (aggregate)", () => {
    it("a partner sees rows for both of their own linked Sub-partners, never a sibling Partner's Sub-partner", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A]);
      subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);

      const response = await callGet("sub-partner", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows.map((r: { subPartnerId: string }) => r.subPartnerId)).toEqual(["sub-partner-1"]);
    });

    it("a sub_partner sees exactly their own one row", async () => {
      sessionFor(SUB_PARTNER_USER);
      subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);

      const response = await callGet("sub-partner", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows.map((r: { subPartnerId: string }) => r.subPartnerId)).toEqual(["sub-partner-1"]);
    });
  });

  describe("Available Balance report (aggregate)", () => {
    it("a partner never sees another party's balance even on a shared Project", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
      availableBalancesListAll.mockResolvedValue([
        makeAvailableBalance({ id: "mine", shareId: "partner-1", balance: "500" }),
        makeAvailableBalance({ id: "theirs", shareId: "partner-3", balance: "999999" }),
      ]);

      const response = await callGet("available-balance", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].shareId).toBe("partner-1");
      expect(body.rows[0].balance).toBe("500");
    });

    // Review finding (Medium): the test above only ever exercises `partner`
    // -- this is the genuinely distinct `sub_partner`-role case at the
    // route layer, mirroring it one role down.
    it("a sub_partner never sees another party's balance even on a shared Project", async () => {
      sessionFor(SUB_PARTNER_USER);
      subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);
      availableBalancesListAll.mockResolvedValue([
        makeAvailableBalance({ id: "mine", partyType: "sub_partner", shareId: "sub-partner-1", balance: "500" }),
        makeAvailableBalance({ id: "theirs", partyType: "sub_partner", shareId: "sub-partner-2", balance: "999999" }),
      ]);

      const response = await callGet("available-balance", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].shareId).toBe("sub-partner-1");
      expect(body.rows[0].balance).toBe("500");
    });
  });

  describe("Money Movement / Adjustment row-filtering correctness (review finding, Medium -- these 2 previously only asserted status, never that rows were actually narrowed by type)", () => {
    it("money-movement narrows to type === moved_to_project only, not just any owner_admin-visible entry", async () => {
      sessionFor(OWNER_USER);
      withdrawalDestinationAllocationsListAll.mockResolvedValue([
        makeLeg({ id: "leg-project", withdrawalTransactionId: "wd-1", destinationType: "project", destinationProjectId: "project-b" }),
        makeLeg({ id: "leg-person", withdrawalTransactionId: "wd-1", destinationType: "person", personName: "Someone" }),
      ]);
      withdrawalTransactionsListAll.mockResolvedValue([makeWithdrawalTransaction({ id: "wd-1" })]);

      const response = await callGet("money-movement", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].type).toBe("moved_to_project");
      expect(body.rows[0].id).toBe("leg-project");
    });

    it("adjustment narrows to type === adjustment only, not just any owner_admin-visible entry", async () => {
      sessionFor(OWNER_USER);
      investmentTransactionsListAll.mockResolvedValue([makeInvestmentTransaction({ id: "inv-1" })]);
      adjustmentNettingsListAll.mockResolvedValue([makeAdjustmentNetting({ id: "netting-1" })]);

      const response = await callGet("adjustment", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].type).toBe("adjustment");
      expect(body.rows[0].id).toBe("netting-1");
    });
  });

  describe("Partner self-scoping across every Money-History-based report type (review finding, Medium -- matrix row 2 was only proven for money-added)", () => {
    it("withdrawal", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
      withdrawalTransactionsListAll.mockResolvedValue([
        makeWithdrawalTransaction({ id: "mine", shareId: "partner-1" }),
        makeWithdrawalTransaction({ id: "not-mine", shareId: "partner-3" }),
      ]);

      const response = await callGet("withdrawal", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["mine"]);
    });

    it("adjustment", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
      adjustmentNettingsListAll.mockResolvedValue([
        makeAdjustmentNetting({ id: "mine", shareId: "partner-1" }),
        makeAdjustmentNetting({ id: "not-mine", shareId: "partner-3" }),
      ]);

      const response = await callGet("adjustment", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["mine"]);
    });

    it("payment-mode", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({ id: "mine", shareId: "partner-1", paymentMode: "neft", amount: "5000" }),
        makeInvestmentTransaction({ id: "not-mine", shareId: "partner-3", paymentMode: "cash", amount: "999999" }),
      ]);

      const response = await callGet("payment-mode", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows).toEqual([{ paymentMode: "neft", totalAmount: "5000", entryCount: 1 }]);
    });

    it("money-history", async () => {
      sessionFor(PARTNER_USER);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({ id: "mine", shareId: "partner-1" }),
        makeInvestmentTransaction({ id: "not-mine", shareId: "partner-3" }),
      ]);
      withdrawalTransactionsListAll.mockResolvedValue([
        makeWithdrawalTransaction({ id: "mine-wd", shareId: "partner-1" }),
        makeWithdrawalTransaction({ id: "not-mine-wd", shareId: "partner-3" }),
      ]);

      const response = await callGet("money-history", "", `${SESSION_COOKIE_NAME}=t`);
      const body = await response.json();

      expect(body.rows.map((r: { id: string }) => r.id).sort()).toEqual(["mine", "mine-wd"]);
    });
  });

  describe("query-parameter filters (review finding, Medium-High -- the frozen I/O matrix's date-filter rows were previously entirely unverified at the route layer)", () => {
    it("dateFrom/dateTo narrows an entry-based report type (money-added)", async () => {
      sessionFor(OWNER_USER);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({ id: "too-early", transactionDate: "2026-08-01" }),
        makeInvestmentTransaction({ id: "in-range", transactionDate: "2026-09-15" }),
        makeInvestmentTransaction({ id: "too-late", transactionDate: "2026-10-01" }),
      ]);

      const response = await callGet(
        "money-added",
        "?dateFrom=2026-09-01&dateTo=2026-09-30",
        `${SESSION_COOKIE_NAME}=t`,
      );
      const body = await response.json();

      expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["in-range"]);
    });

    it("dateFrom/dateTo is silently ignored (not erroring, not narrowing) on an aggregate report type (Decision #8)", async () => {
      sessionFor(OWNER_USER);
      investmentTransactionsListAll.mockResolvedValue([
        makeInvestmentTransaction({ id: "inv-a", projectId: "project-a", transactionDate: "2020-01-01" }),
      ]);
      partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A]);

      const response = await callGet(
        "project-money",
        "?dateFrom=2026-09-01&dateTo=2026-09-30",
        `${SESSION_COOKIE_NAME}=t`,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      // The 2020-dated transaction still counts -- a date filter on an
      // aggregate type is a documented no-op, never a 400 and never a
      // narrowing.
      expect(body.rows.find((r: { projectId: string }) => r.projectId === "project-a")?.totalAdded).toBe(
        "1000000",
      );
    });

    it("projectId/personName narrows an aggregate report type (Partner)", async () => {
      sessionFor(OWNER_USER);
      partnerSharesListAll.mockResolvedValue([
        PARTNER_SHARE_PROJECT_A,
        { ...OTHER_PARTNER_SHARE, projectId: "project-b", name: "Zed" },
      ]);

      const byProject = await callGet("partner", "?projectId=project-a", `${SESSION_COOKIE_NAME}=t`);
      const byProjectBody = await byProject.json();
      expect(byProjectBody.rows.map((r: { partnerId: string }) => r.partnerId)).toEqual(["partner-1"]);

      const byName = await callGet("partner", "?personName=zed", `${SESSION_COOKIE_NAME}=t`);
      const byNameBody = await byName.json();
      expect(byNameBody.rows.map((r: { partnerId: string }) => r.partnerId)).toEqual(["partner-3"]);
    });
  });
});

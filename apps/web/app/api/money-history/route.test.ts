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

function makeRequest(query = "", cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/money-history${query}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });
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
const OTHER_ROLE_USER = makeUser({ id: "pa-1", email: "pa@niveshbook.test", role: "project_admin" });

const PARTNER_SHARE_PROJECT_A = {
  id: "row-1",
  partnerId: "partner-1",
  projectId: "project-a",
  name: "Partner A (Project A)",
  sharePercent: "100",
  userId: "partner-user-a",
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const PARTNER_SHARE_PROJECT_B = {
  id: "row-2",
  partnerId: "partner-2",
  projectId: "project-b",
  name: "Partner A (Project B)",
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

function makeMovement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "mv-1",
    withdrawalDestinationAllocationId: null,
    availableBalanceSpendId: null,
    sourceProjectId: "project-a",
    destinationProjectId: "project-b",
    destinationInvestmentTransactionId: "inv-dest",
    amount: "100000",
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

function makeSpend(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "spend-1",
    sourceProjectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    destinationType: "person",
    destinationProjectId: null,
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    personName: "Ramesh",
    amount: "30000",
    notes: null,
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
  availableBalanceSpendsListAll.mockResolvedValue([]);
  adjustmentNettingsListAll.mockResolvedValue([]);
}

function sessionFor(user: ReturnType<typeof makeUser>) {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: user.id });
  findUserById.mockResolvedValue(user);
}

describe("GET /api/money-history (Story 5.1, FR31)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie, before any data read", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(investmentTransactionsListAll).not.toHaveBeenCalled();
  });

  it("returns 403 for a role not granted money_history:list (project_admin), before any data read", async () => {
    sessionFor(OTHER_ROLE_USER);

    const response = await GET(makeRequest("", `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(investmentTransactionsListAll).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for an invalid partyType filter", async () => {
    sessionFor(OWNER_USER);

    const response = await GET(makeRequest("?partyType=nonsense", `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("owner_admin (unrestricted) sees every entry across every Project", async () => {
    sessionFor(OWNER_USER);
    investmentTransactionsListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "inv-a", projectId: "project-a", shareId: "partner-1" }),
      makeInvestmentTransaction({ id: "inv-b", projectId: "project-b", shareId: "partner-2" }),
    ]);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, PARTNER_SHARE_PROJECT_B, OTHER_PARTNER_SHARE]);

    const response = await GET(makeRequest("", `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries.map((e: { id: string }) => e.id).sort()).toEqual(["inv-a", "inv-b"]);
  });

  it("a Partner sees only entries matching their own current Partner Shares, across ALL their Projects -- excluding another partner's entries", async () => {
    sessionFor(PARTNER_USER);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, PARTNER_SHARE_PROJECT_B, OTHER_PARTNER_SHARE]);
    investmentTransactionsListAll.mockResolvedValue([
      makeInvestmentTransaction({ id: "own-project-a", projectId: "project-a", shareId: "partner-1" }),
      makeInvestmentTransaction({ id: "own-project-b", projectId: "project-b", shareId: "partner-2" }),
      makeInvestmentTransaction({ id: "not-mine", projectId: "project-a", shareId: "partner-3" }),
    ]);

    const response = await GET(makeRequest("", `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries.map((e: { id: string }) => e.id).sort()).toEqual(["own-project-a", "own-project-b"]);
  });

  // Review round 2 (verification-gap finding #5): every test above only
  // populates `investmentTransactionsListAll` -- the other 5 source-table
  // mocks stay `[]`, so the spec's "route test covers the full I/O matrix"
  // claim wasn't actually backed by this file. This test populates all 6
  // `listAll()` mocks in one pass (a manual Add Money entry, a cross-project
  // "project" leg with its linked movement + auto-created destination
  // investment row, and an Available Balance spend), proving the route
  // actually wires all 6 DB ports through to `assembleMoneyHistory()` and
  // back out as one unified response -- not just core's own pure-function
  // logic (already exhaustively covered by `money-history.test.ts`).
  it("wires all 6 source tables through end to end -- one full-matrix pass covering a manual Add Money entry, a cross-project movement (leg + movement + destination), and an Available Balance spend", async () => {
    sessionFor(OWNER_USER);
    const manualAdd = makeInvestmentTransaction({ id: "inv-manual", projectId: "project-a", shareId: "partner-1" });
    const destinationInvestment = makeInvestmentTransaction({
      id: "inv-dest",
      projectId: "project-b",
      shareId: "partner-2",
    });
    const withdrawal = makeWithdrawalTransaction({ id: "wd-1", projectId: "project-a", shareId: "partner-1" });
    const projectLeg = makeLeg({
      id: "leg-project",
      withdrawalTransactionId: "wd-1",
      destinationType: "project",
      destinationProjectId: "project-b",
    });
    const movement = makeMovement({
      id: "mv-1",
      withdrawalDestinationAllocationId: "leg-project",
      sourceProjectId: "project-a",
      destinationProjectId: "project-b",
      destinationInvestmentTransactionId: "inv-dest",
    });
    const spend = makeSpend({ id: "spend-1", sourceProjectId: "project-a", shareId: "partner-1" });

    investmentTransactionsListAll.mockResolvedValue([manualAdd, destinationInvestment]);
    withdrawalTransactionsListAll.mockResolvedValue([withdrawal]);
    withdrawalDestinationAllocationsListAll.mockResolvedValue([projectLeg]);
    moneyMovementsListAll.mockResolvedValue([movement]);
    availableBalanceSpendsListAll.mockResolvedValue([spend]);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, PARTNER_SHARE_PROJECT_B]);

    const response = await GET(makeRequest("", `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    const byId = new Map(body.entries.map((e: { id: string }) => [e.id, e]));

    expect(byId.size).toBe(5); // manual add + withdrawal + leg + destination investment + spend
    expect(byId.get("inv-manual")).toMatchObject({ type: "money_added", from: null });
    expect(byId.get("wd-1")).toMatchObject({ type: "money_withdrawn" });
    expect(byId.get("leg-project")).toMatchObject({ type: "moved_to_project", to: "Project B" });
    expect(byId.get("inv-dest")).toMatchObject({ type: "money_added", from: "Project A" });
    expect(byId.get("spend-1")).toMatchObject({
      type: "used_from_available_balance",
      from: "Available Balance",
      to: "Ramesh",
    });

    expect(investmentTransactionsListAll).toHaveBeenCalledTimes(1);
    expect(withdrawalTransactionsListAll).toHaveBeenCalledTimes(1);
    expect(withdrawalDestinationAllocationsListAll).toHaveBeenCalledTimes(1);
    expect(moneyMovementsListAll).toHaveBeenCalledTimes(1);
    expect(availableBalanceSpendsListAll).toHaveBeenCalledTimes(1);
  });

  // Story 5.3 (FR33/FR34, AD-4): proves the route actually wires the new
  // `createAdjustmentNettingPort().listAll()` fetch through to
  // `assembleMoneyHistory()` and back out as an `"adjustment"`-type entry --
  // not just core's own pure-function logic (already covered by
  // `money-history.test.ts`).
  it("wires adjustment_nettings through end to end -- an 'adjustment' entry appears alongside the other 6 source tables", async () => {
    sessionFor(OWNER_USER);
    adjustmentNettingsListAll.mockResolvedValue([makeAdjustmentNetting({ id: "netting-1" })]);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A]);

    const response = await GET(makeRequest("", `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      id: "netting-1",
      type: "adjustment",
      from: null,
      to: null,
      personName: "Partner A (Project A)",
    });
    expect(adjustmentNettingsListAll).toHaveBeenCalledTimes(1);
  });

  it("returns 403 if the authorized session's user row can no longer be found", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValueOnce(OWNER_USER).mockResolvedValueOnce(null);

    const response = await GET(makeRequest("", `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(403);
  });
});

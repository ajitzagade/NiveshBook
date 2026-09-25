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
const investmentAdjustmentsListAll = vi.fn();
const withdrawalAdjustmentsListAll = vi.fn();

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
  createInvestmentAdjustmentPort: () => ({
    upsert: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: investmentAdjustmentsListAll,
  }),
  createWithdrawalAdjustmentPort: () => ({
    upsert: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: withdrawalAdjustmentsListAll,
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/adjust-next-time", {
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
  id: "row-2",
  partnerId: "partner-2",
  projectId: "project-a",
  name: "Partner B",
  sharePercent: "100",
  userId: "someone-else",
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

// Story 5.6 (FR37): mirrors PARTNER_SHARE_PROJECT_A/OTHER_PARTNER_SHARE's
// own shape one role over -- proves `sub_partner` scoping (own share only,
// sibling excluded) all the way through this route, not just at
// `resolveMoneyHistoryScope()`'s own pure-function level.
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
  partnerId: "partner-1",
  projectId: "project-a",
  name: "Sub-partner B",
  sharePercent: "10",
  userId: "someone-else",
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

function makeInvestmentAdjustment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ia-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    requirementId: "req-1",
    shouldPay: "200000",
    actualPaid: "0",
    adjustmentType: "pending",
    adjustmentAmount: "200000",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWithdrawalAdjustment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "wa-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    canTake: "150000",
    taken: "0",
    adjustmentType: "keep_for_later",
    adjustmentAmount: "150000",
    updatedAt: new Date().toISOString(),
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
  investmentAdjustmentsListAll.mockReset();
  withdrawalAdjustmentsListAll.mockReset();

  partnerSharesListAll.mockResolvedValue([]);
  subPartnerSharesListAll.mockResolvedValue([]);
  listProjects.mockResolvedValue([
    { id: "project-a", name: "Project A", description: null, createdAt: "", updatedAt: "" },
  ]);
  investmentAdjustmentsListAll.mockResolvedValue([]);
  withdrawalAdjustmentsListAll.mockResolvedValue([]);
}

function sessionFor(user: ReturnType<typeof makeUser>) {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: user.id });
  findUserById.mockResolvedValue(user);
}

describe("GET /api/adjust-next-time (Story 5.3, FR33/FR34)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie, before any data read", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(investmentAdjustmentsListAll).not.toHaveBeenCalled();
  });

  it("returns 403 for a role not granted adjust_next_time:view (project_admin), before any data read", async () => {
    sessionFor(OTHER_ROLE_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(investmentAdjustmentsListAll).not.toHaveBeenCalled();
  });

  it("owner_admin (unrestricted) sees every Investment/Withdrawal Adjustment row, with canNet: true", async () => {
    sessionFor(OWNER_USER);
    investmentAdjustmentsListAll.mockResolvedValue([
      makeInvestmentAdjustment({ id: "ia-a", shareId: "partner-1" }),
      makeInvestmentAdjustment({ id: "ia-b", shareId: "partner-2" }),
    ]);
    withdrawalAdjustmentsListAll.mockResolvedValue([makeWithdrawalAdjustment({ id: "wa-a", shareId: "partner-1" })]);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.investmentAdjustments.map((row: { id: string }) => row.id).sort()).toEqual(["ia-a", "ia-b"]);
    expect(body.withdrawalAdjustments.map((row: { id: string }) => row.id)).toEqual(["wa-a"]);
    expect(body.canNet).toBe(true);
    // personName/projectName resolved at the route layer.
    const iaA = body.investmentAdjustments.find((row: { id: string }) => row.id === "ia-a");
    expect(iaA.personName).toBe("Partner A");
    expect(iaA.projectName).toBe("Project A");
  });

  it("a Partner sees only rows matching their own current Partner Shares, across ALL their Projects -- excluding another partner's rows, with canNet: false", async () => {
    sessionFor(PARTNER_USER);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
    investmentAdjustmentsListAll.mockResolvedValue([
      makeInvestmentAdjustment({ id: "own", shareId: "partner-1" }),
      makeInvestmentAdjustment({ id: "not-mine", shareId: "partner-2" }),
    ]);
    withdrawalAdjustmentsListAll.mockResolvedValue([
      makeWithdrawalAdjustment({ id: "own-withdrawal", shareId: "partner-1" }),
      makeWithdrawalAdjustment({ id: "not-mine-withdrawal", shareId: "partner-2" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.investmentAdjustments.map((row: { id: string }) => row.id)).toEqual(["own"]);
    expect(body.withdrawalAdjustments.map((row: { id: string }) => row.id)).toEqual(["own-withdrawal"]);
    expect(body.canNet).toBe(false);
  });

  // Story 5.6 (FR37): previously zero coverage for `sub_partner` at this
  // route -- this story is what first makes `/adjust-next-time` reachable
  // via the UI for that role. Mirrors the Partner case immediately above,
  // one role over: own Sub-partner Share's rows only, a sibling
  // Sub-partner's rows on the same Project excluded, canNet: false.
  it("a Sub-partner sees only rows matching their own current Sub-partner Share -- excluding a sibling Sub-partner's rows, with canNet: false", async () => {
    sessionFor(SUB_PARTNER_USER);
    subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);
    investmentAdjustmentsListAll.mockResolvedValue([
      makeInvestmentAdjustment({ id: "own", partyType: "sub_partner", shareId: "sub-partner-1" }),
      makeInvestmentAdjustment({ id: "not-mine", partyType: "sub_partner", shareId: "sub-partner-2" }),
    ]);
    withdrawalAdjustmentsListAll.mockResolvedValue([
      makeWithdrawalAdjustment({ id: "own-withdrawal", partyType: "sub_partner", shareId: "sub-partner-1" }),
      makeWithdrawalAdjustment({ id: "not-mine-withdrawal", partyType: "sub_partner", shareId: "sub-partner-2" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.investmentAdjustments.map((row: { id: string }) => row.id)).toEqual(["own"]);
    expect(body.withdrawalAdjustments.map((row: { id: string }) => row.id)).toEqual(["own-withdrawal"]);
    expect(body.canNet).toBe(false);
  });

  it("returns 403 if the authorized session's user row can no longer be found", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValueOnce(OWNER_USER).mockResolvedValueOnce(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(403);
  });
});

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
const requirementsListByProjectId = vi.fn();
const transactionsListByRequirementId = vi.fn();
const recommendedFindByRequirementId = vi.fn();
const adjustmentUpsert = vi.fn();

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
  createInvestmentRequirementPort: () => ({
    createInvestmentRequirement: vi.fn(),
    listByProjectId: requirementsListByProjectId,
    findById: vi.fn(),
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: transactionsListByRequirementId,
    findById: vi.fn(),
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    cancelTransaction: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    listAll: vi.fn(),
  }),
  createInvestmentAdjustmentPort: () => ({
    upsert: adjustmentUpsert,
    listByProjectId: vi.fn(),
    listAll: vi.fn(),
  }),
  createRecommendedAmountPort: () => ({
    snapshotAll: vi.fn(),
    findByRequirementId: recommendedFindByRequirementId,
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/my-investments", {
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
  sharePercent: "60",
  userId: "partner-user-a",
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const OTHER_PARTNER_SHARE = {
  id: "row-2",
  partnerId: "partner-2",
  projectId: "project-a",
  name: "Someone Else",
  sharePercent: "40",
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
  sharePercent: "30",
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

const REQUIREMENT = {
  id: "req-1",
  projectId: "project-a",
  amount: "1000000",
  requirementDate: "2026-09-01",
  createdAt: new Date().toISOString(),
};

function makeTransaction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inv-1",
    requirementId: "req-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "60",
    shouldPaySnapshot: "600000",
    amount: "400000",
    transactionDate: "2026-09-02",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset().mockResolvedValue(1);
  findUserById.mockReset();
  partnerSharesListAll.mockReset().mockResolvedValue([]);
  subPartnerSharesListAll.mockReset().mockResolvedValue([]);
  listProjects.mockReset().mockResolvedValue([
    { id: "project-a", name: "Project A", description: null, createdAt: "", updatedAt: "" },
    { id: "project-b", name: "Project B", description: null, createdAt: "", updatedAt: "" },
  ]);
  requirementsListByProjectId.mockReset().mockResolvedValue([]);
  transactionsListByRequirementId.mockReset().mockResolvedValue([]);
  recommendedFindByRequirementId.mockReset().mockResolvedValue([]);
  // Echoes the upsert input back as the persisted row, mirroring
  // `computeInvestmentAdjustment`'s "the persisted row's values are
  // returned" contract -- same fake shape as `my-investments.test.ts`'s.
  adjustmentUpsert
    .mockReset()
    .mockImplementation(async (input: Record<string, unknown>) => ({
      id: `adj-${String(input.partyType)}-${String(input.shareId)}`,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      ...input,
    }));
}

function sessionFor(user: ReturnType<typeof makeUser>) {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: user.id });
  findUserById.mockResolvedValue(user);
}

describe("GET /api/my-investments (All Investments, founder feedback 2026-09-26)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie, before any data read", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(partnerSharesListAll).not.toHaveBeenCalled();
  });

  it("returns 403 for a role not granted my_investments:list (project_admin), before any data read (AD-1)", async () => {
    sessionFor(OTHER_ROLE_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(partnerSharesListAll).not.toHaveBeenCalled();
  });

  it("a Partner gets only their own projects/entries -- zero other-party names or amounts (FR10)", async () => {
    sessionFor(PARTNER_USER);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
    subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);
    requirementsListByProjectId.mockResolvedValue([REQUIREMENT]);
    transactionsListByRequirementId.mockResolvedValue([
      makeTransaction({ id: "own", shareId: "partner-1", amount: "300000" }),
      makeTransaction({ id: "not-mine", shareId: "partner-2", amount: "999999" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      projectId: "project-a",
      projectName: "Project A",
      role: "partner",
      shareId: "partner-1",
      name: "Partner A",
      sharePercent: "60",
    });
    // Own status: ownShouldPay = 60% of 1000000 (600000) minus the two
    // nested Sub-partners' own slices (30% -> 300000, 10% -> 100000) =
    // 200000; 300000 paid -> extra_paid 100000.
    expect(body.entries[0].requirements[0].status).toMatchObject({
      shouldPay: "200000",
      actualPaid: "300000",
      adjustmentType: "extra_paid",
      adjustmentAmount: "100000",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Someone Else");
    expect(serialized).not.toContain("Sub-partner B");
    expect(serialized).not.toContain("999999");
  });

  it("a Sub-partner gets only their own slice -- no sibling or parent figures (FR10)", async () => {
    sessionFor(SUB_PARTNER_USER);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
    subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);
    requirementsListByProjectId.mockResolvedValue([REQUIREMENT]);
    transactionsListByRequirementId.mockResolvedValue([
      makeTransaction({ id: "own", partyType: "sub_partner", shareId: "sub-partner-1", amount: "300000" }),
      makeTransaction({ id: "parent", shareId: "partner-1", amount: "111111" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      role: "sub_partner",
      shareId: "sub-partner-1",
      name: "Sub-partner A",
      sharePercent: "30",
    });
    // 30% of 1000000 = 300000 should-pay, 300000 paid -> none.
    expect(body.entries[0].requirements[0].status).toMatchObject({
      shouldPay: "300000",
      actualPaid: "300000",
      adjustmentType: "none",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Partner A");
    expect(serialized).not.toContain("Sub-partner B");
    expect(serialized).not.toContain("111111");
  });

  it("owner_admin sees every project and every party", async () => {
    sessionFor(OWNER_USER);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
    subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.entries.map((entry: { role: string; shareId: string }) => `${entry.role}:${entry.shareId}`).sort(),
    ).toEqual([
      "partner:partner-1",
      "partner:partner-2",
      "sub_partner:sub-partner-1",
      "sub_partner:sub-partner-2",
    ]);
  });

  it("an authenticated user with zero current shares gets an empty list (the page's EmptyState case)", async () => {
    sessionFor(PARTNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    expect((await response.json()).entries).toEqual([]);
  });
});

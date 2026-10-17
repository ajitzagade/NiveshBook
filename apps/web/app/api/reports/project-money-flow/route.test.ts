import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const listProjects = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const investmentListAll = vi.fn();
const investmentSumActiveAmountByProjectId = vi.fn();
const withdrawalListByProjectId = vi.fn();
const withdrawalSumActiveAmountByProjectId = vi.fn();
const destinationAllocationListAll = vi.fn();
const moneyMovementListByDestinationProjectId = vi.fn();
const availableBalanceSpendListAll = vi.fn();
const investmentRequirementListByProjectId = vi.fn();
const reallocationListActiveByProjectId = vi.fn();
const reallocationListActiveAllocationsByProjectId = vi.fn();

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
  createProjectPort: () => ({
    createProject: vi.fn(),
    updateProject: vi.fn(),
    findProjectById: vi.fn(),
    listProjects,
  }),
  createPartnerSharePort: () => ({
    createPartnerShare: vi.fn(),
    findLatestByPartnerId: vi.fn(),
    listByProjectId: listPartnerSharesByProjectId,
    listAll: vi.fn(),
  }),
  createSubPartnerSharePort: () => ({
    createSubPartnerShare: vi.fn(),
    findLatestBySubPartnerId: vi.fn(),
    listByPartnerId: vi.fn(),
    listByProjectId: listSubPartnerSharesByProjectId,
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    recordTransactionBatch: vi.fn(),
    listByRequirementId: vi.fn(),
    listAll: investmentListAll,
    sumActiveAmountByProjectId: investmentSumActiveAmountByProjectId,
  }),
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    recordTransactionBatch: vi.fn(),
    listByProjectId: withdrawalListByProjectId,
    sumActiveAmountByProjectId: withdrawalSumActiveAmountByProjectId,
  }),
  createWithdrawalDestinationAllocationPort: () => ({
    recordAllocation: vi.fn(),
    listAll: destinationAllocationListAll,
  }),
  createMoneyMovementPort: () => ({
    listByDestinationProjectId: moneyMovementListByDestinationProjectId,
  }),
  createAvailableBalanceSpendPort: () => ({
    listAll: availableBalanceSpendListAll,
  }),
  createInvestmentRequirementPort: () => ({
    createInvestmentRequirement: vi.fn(),
    listByProjectId: investmentRequirementListByProjectId,
    findById: vi.fn(),
    listAll: vi.fn(),
  }),
  createWithdrawalReallocationPort: () => ({
    listActiveByProjectId: reallocationListActiveByProjectId,
    listActiveAllocationsByProjectId: reallocationListActiveAllocationsByProjectId,
  }),
}));

const PROJECT_A_ID = "0192f5a0-1111-7000-8000-000000000001";
const PROJECT_B_ID = "0192f5a0-2222-7000-8000-000000000002";

function makeRequest(options: { cookie?: string; body?: unknown } = {}): NextRequest {
  const { cookie, body } = options;
  return new NextRequest("http://localhost/api/reports/project-money-flow", {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const LIVE_SESSION = {
  id: "session-1",
  userId: "owner-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

const OWNER_USER = {
  id: "owner-1",
  email: "owner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "owner_admin" as const,
  active: true,
  canApproveExtraWithdrawal: true,
  createdAt: new Date().toISOString(),
};

const PARTNER_USER = {
  id: "partner-user-a",
  email: "partner-a@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

function makeProject(id: string, name: string) {
  return { id, name, description: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function makePartnerShareRow(projectId: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: `share-${projectId}`,
    partnerId: "partner-a",
    projectId,
    name: "Partner A",
    sharePercent: "100",
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeRequirement(projectId: string) {
  return {
    id: `req-${projectId}`,
    projectId,
    amount: "1000000",
    requirementDate: "2026-01-01",
    createdAt: new Date().toISOString(),
  };
}

/** Full-100% Partner Shares, one Investment Requirement, no withdrawals/reallocations -- a project whose Should Pay/Can Take compute cleanly. */
function wirePortsForCleanProject(projectId: string) {
  listPartnerSharesByProjectId.mockImplementation((id: string) =>
    Promise.resolve(id === projectId ? [makePartnerShareRow(projectId)] : []),
  );
  investmentRequirementListByProjectId.mockImplementation((id: string) =>
    Promise.resolve(id === projectId ? [makeRequirement(projectId)] : []),
  );
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  listProjects.mockReset();
  listProjects.mockResolvedValue([makeProject(PROJECT_A_ID, "Project A")]);
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([makePartnerShareRow(PROJECT_A_ID)]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  investmentListAll.mockReset();
  investmentListAll.mockResolvedValue([]);
  investmentSumActiveAmountByProjectId.mockReset();
  investmentSumActiveAmountByProjectId.mockResolvedValue("1000000");
  withdrawalListByProjectId.mockReset();
  withdrawalListByProjectId.mockResolvedValue([]);
  withdrawalSumActiveAmountByProjectId.mockReset();
  withdrawalSumActiveAmountByProjectId.mockResolvedValue("0");
  destinationAllocationListAll.mockReset();
  destinationAllocationListAll.mockResolvedValue([]);
  moneyMovementListByDestinationProjectId.mockReset();
  moneyMovementListByDestinationProjectId.mockResolvedValue([]);
  availableBalanceSpendListAll.mockReset();
  availableBalanceSpendListAll.mockResolvedValue([]);
  investmentRequirementListByProjectId.mockReset();
  investmentRequirementListByProjectId.mockResolvedValue([makeRequirement(PROJECT_A_ID)]);
  reallocationListActiveByProjectId.mockReset();
  reallocationListActiveByProjectId.mockResolvedValue([]);
  reallocationListActiveAllocationsByProjectId.mockReset();
  reallocationListActiveAllocationsByProjectId.mockResolvedValue([]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

function partnerSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
  findUserById.mockResolvedValue(PARTNER_USER);
}

describe("POST /api/reports/project-money-flow", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makeRequest({ body: { projectIds: [PROJECT_A_ID] } }));

    expect(response.status).toBe(401);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("returns 403 for a partner (owner_admin-only)", async () => {
    partnerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: { projectIds: [PROJECT_A_ID] } }),
    );

    expect(response.status).toBe(403);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed JSON body", async () => {
    ownerSession();
    const request = new NextRequest("http://localhost/api/reports/project-money-flow", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE_NAME}=t` },
      body: "{not valid json",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 invalid_request when projectIds is an empty array", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: { projectIds: [] } }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 404 when a requested Project doesn't exist", async () => {
    ownerSession();
    listProjects.mockResolvedValue([makeProject(PROJECT_A_ID, "Project A")]);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: { projectIds: [PROJECT_A_ID, PROJECT_B_ID] } }),
    );

    expect(response.status).toBe(404);
  });

  it("returns a full 200 report for a single clean Project", async () => {
    ownerSession();
    wirePortsForCleanProject(PROJECT_A_ID);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: { projectIds: [PROJECT_A_ID] } }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toHaveLength(1);
    const project = body.projects[0];
    expect(project.projectId).toBe(PROJECT_A_ID);
    expect(project.projectName).toBe("Project A");
    expect(project.status.available).toBe(true);
    expect(project.status.shouldPayByRequirement).toHaveLength(1);
    expect(project.status.canTake.availableToWithdraw).toBe("1000000");
    expect(project.tree).toBeTruthy();
    expect(Array.isArray(project.entries)).toBe(true);
    expect(Array.isArray(project.moneyFlowEdges)).toBe(true);
  });

  it("returns a 200 report combining multiple Projects", async () => {
    ownerSession();
    listProjects.mockResolvedValue([
      makeProject(PROJECT_A_ID, "Project A"),
      makeProject(PROJECT_B_ID, "Project B"),
    ]);
    listPartnerSharesByProjectId.mockImplementation((id: string) =>
      Promise.resolve([makePartnerShareRow(id)]),
    );
    investmentRequirementListByProjectId.mockImplementation((id: string) =>
      Promise.resolve([makeRequirement(id)]),
    );

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: { projectIds: [PROJECT_A_ID, PROJECT_B_ID] },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toHaveLength(2);
    expect(body.projects.map((p: { projectId: string }) => p.projectId)).toEqual([PROJECT_A_ID, PROJECT_B_ID]);
    expect(body.projects.every((p: { status: { available: boolean } }) => p.status.available)).toBe(true);
  });

  it("marks one Project's status unavailable (incomplete Partner Shares) without failing the other Project's section -- the confirmed partial-failure decision", async () => {
    ownerSession();
    listProjects.mockResolvedValue([
      makeProject(PROJECT_A_ID, "Clean Project"),
      makeProject(PROJECT_B_ID, "Broken Project"),
    ]);
    listPartnerSharesByProjectId.mockImplementation((id: string) => {
      if (id === PROJECT_A_ID) {
        return Promise.resolve([makePartnerShareRow(PROJECT_A_ID)]);
      }
      // Only 60% allocated -- `computeShouldPay`/`computeCanTake` both throw for this Project.
      return Promise.resolve([makePartnerShareRow(PROJECT_B_ID, { sharePercent: "60" })]);
    });
    investmentRequirementListByProjectId.mockImplementation((id: string) => Promise.resolve([makeRequirement(id)]));

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: { projectIds: [PROJECT_A_ID, PROJECT_B_ID] },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toHaveLength(2);

    const clean = body.projects.find((p: { projectId: string }) => p.projectId === PROJECT_A_ID);
    const broken = body.projects.find((p: { projectId: string }) => p.projectId === PROJECT_B_ID);

    expect(clean.status.available).toBe(true);
    expect(broken.status.available).toBe(false);
    expect(typeof broken.status.reason).toBe("string");
    // The broken Project's other sections (transactions/tree) still render --
    // only its Should Pay/Can Take status is marked unavailable.
    expect(broken.tree).toBeTruthy();
    expect(Array.isArray(broken.entries)).toBe(true);
  });
});

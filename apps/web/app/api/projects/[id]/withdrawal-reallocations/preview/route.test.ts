import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const sumActiveAmountByProjectId = vi.fn();
const withdrawalSumActiveAmountByProjectId = vi.fn();
const listActiveByProjectId = vi.fn();
const listActiveAllocationsByProjectId = vi.fn();

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
    findProjectById,
    listProjects: vi.fn(),
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
    listByRequirementId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    cancelTransaction: vi.fn(),
    sumActiveAmountByProjectId,
  }),
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: withdrawalSumActiveAmountByProjectId,
  }),
  createWithdrawalReallocationPort: () => ({
    record: vi.fn(),
    listActiveByProjectId,
    listActiveAllocationsByProjectId,
    listAllocationsByReallocationId: vi.fn(),
    cancel: vi.fn(),
    consumeAllocationLegs: vi.fn(),
    findById: vi.fn(),
    listAll: vi.fn(),
    listAllAllocations: vi.fn(),
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeRequest(query: Record<string, string>, cookie?: string): NextRequest {
  const params = new URLSearchParams(query).toString();
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/withdrawal-reallocations/preview?${params}`,
    { method: "GET", headers: cookie ? { Cookie: cookie } : undefined },
  );
}

function makeContext(id: string = PROJECT_ID) {
  return { params: Promise.resolve({ id }) };
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
  id: "partner-user-1",
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const EXISTING_PROJECT = {
  id: PROJECT_ID,
  name: "Verification Project",
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makePartnerShareRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "share-row-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
    name: "A",
    sharePercent: "50",
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findUserById.mockResolvedValue(OWNER_USER);
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50" }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "30" }),
    makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "20" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  sumActiveAmountByProjectId.mockReset();
  sumActiveAmountByProjectId.mockResolvedValue("500000");
  withdrawalSumActiveAmountByProjectId.mockReset();
  withdrawalSumActiveAmountByProjectId.mockResolvedValue("0");
  listActiveByProjectId.mockReset();
  listActiveByProjectId.mockResolvedValue([]);
  listActiveAllocationsByProjectId.mockReset();
  listActiveAllocationsByProjectId.mockResolvedValue([]);
}

describe("GET /api/projects/[id]/withdrawal-reallocations/preview", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest({ partyType: "partner", shareId: "a", declinedAmount: "100000" }), makeContext());
    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-owner_admin, checked before any DB read", async () => {
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(
      makeRequest(
        { partyType: "partner", shareId: "a", declinedAmount: "100000" },
        `${SESSION_COOKIE_NAME}=some-token`,
      ),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    findProjectById.mockResolvedValue(null);

    const response = await GET(
      makeRequest(
        { partyType: "partner", shareId: "a", declinedAmount: "100000" },
        `${SESSION_COOKIE_NAME}=some-token`,
      ),
      makeContext(),
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 invalid_request when a required query param is missing", async () => {
    const response = await GET(
      makeRequest({ partyType: "partner", shareId: "a" }, `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_request");
  });

  it("returns 404 not_found when the declining shareId isn't a current Partner/Sub-partner", async () => {
    const response = await GET(
      makeRequest(
        { partyType: "partner", shareId: "not-a-real-share", declinedAmount: "100000" },
        `${SESSION_COOKIE_NAME}=some-token`,
      ),
      makeContext(),
    );

    expect(response.status).toBe(404);
  });

  it("returns the computed pro-rata split without writing anything -- 200 with effectiveCanTake and allocationLegs", async () => {
    const response = await GET(
      makeRequest(
        { partyType: "partner", shareId: "a", declinedAmount: "100000" },
        `${SESSION_COOKIE_NAME}=some-token`,
      ),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.effectiveCanTake).toBe("250000");
    const byShareId = Object.fromEntries(
      body.allocationLegs.map((leg: { shareId: string; allocatedAmount: string }) => [leg.shareId, leg.allocatedAmount]),
    );
    expect(byShareId.b).toBe("60000");
    expect(byShareId.c).toBe("40000");
  });

  it("returns 409 no_recipients when the declining leaf is the only current leaf in the Project", async () => {
    listPartnerSharesByProjectId.mockResolvedValue([makePartnerShareRow({ partnerId: "a", sharePercent: "100" })]);

    const response = await GET(
      makeRequest(
        { partyType: "partner", shareId: "a", declinedAmount: "1000" },
        `${SESSION_COOKIE_NAME}=some-token`,
      ),
      makeContext(),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("no_recipients");
  });

  it("returns 400 validation_error for a malformed declinedAmount", async () => {
    const response = await GET(
      makeRequest(
        { partyType: "partner", shareId: "a", declinedAmount: "not-a-number" },
        `${SESSION_COOKIE_NAME}=some-token`,
      ),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
  });
});

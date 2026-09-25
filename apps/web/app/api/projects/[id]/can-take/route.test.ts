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
const sumActiveWithdrawnAmountByProjectId = vi.fn();

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
    sumActiveAmountByProjectId: sumActiveWithdrawnAmountByProjectId,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/can-take`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
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

function makeSubPartnerShareRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "sub-row-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
    name: "Sub1",
    sharePercent: "12.5",
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
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
  sumActiveWithdrawnAmountByProjectId.mockReset();
  // Story 4.9 (FR29, Can Take fix): defaults to "0" so pre-existing test
  // expectations (availableToWithdraw = the raw invested total) stay
  // unchanged unless a test explicitly overrides it -- a dedicated test
  // below exercises the actual subtraction.
  sumActiveWithdrawnAmountByProjectId.mockResolvedValue("0");
}

describe("GET /api/projects/[id]/can-take", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin, checked before any DB read", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(findProjectById).not.toHaveBeenCalled();
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
    expect(sumActiveAmountByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 200 with the Can Take breakdown for an owner_admin (AC: 50/30/20 split of ₹5,00,000)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.availableToWithdraw).toBe("500000");
    expect(body.partners).toHaveLength(3);
    const a = body.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(a.canTake).toBe("250000");
    const b = body.partners.find((p: { partnerId: string }) => p.partnerId === "b");
    expect(b.canTake).toBe("150000");
    const c = body.partners.find((p: { partnerId: string }) => p.partnerId === "c");
    expect(c.canTake).toBe("100000");
  });

  it("groups Sub-partner Shares by partnerId, nested under the right Partner", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "12.5" }),
      makeSubPartnerShareRow({ subPartnerId: "sub2", partnerId: "a", name: "Sub2", sharePercent: "12.5" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const a = body.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(a.ownCanTake).toBe("125000");
    expect(a.subPartners).toHaveLength(2);
    expect(a.canTake).toBe("250000");
  });

  it("returns availableToWithdraw = 0 and every Can Take value = 0 when no money has ever been invested", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    sumActiveAmountByProjectId.mockResolvedValue("0");

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.availableToWithdraw).toBe("0");
    for (const partner of body.partners) {
      expect(partner.canTake).toBe("0");
    }
  });

  it("returns values that sum to exactly the available amount for an uneven split (33.33/33.33/33.34), largest-remainder allocated", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "33.33" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "33.33" }),
      makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "33.34" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const total = (body.partners as Array<{ canTake: string }>).reduce(
      (sum, p) => sum + Number(p.canTake),
      0,
    );
    expect(total).toBe(500000);
  });

  it("returns 409 shares_not_fully_allocated when Partner Shares sum under 100% (90%)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "40" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("shares_not_fully_allocated");
    expect(body.message).toBe("Can Take isn't available until Partner Shares total 100%.");
  });

  it("returns 409 shares_not_fully_allocated when Partner Shares sum over 100% (110%)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "60" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "50" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("shares_not_fully_allocated");
  });

  it("Story 4.9 (FR29): availableToWithdraw shrinks by the amount already withdrawn (₹10,00,000 invested, ₹2,00,000 withdrawn -> ₹8,00,000)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    sumActiveAmountByProjectId.mockResolvedValue("1000000");
    sumActiveWithdrawnAmountByProjectId.mockResolvedValue("200000");

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.availableToWithdraw).toBe("800000");
  });

  it("review finding: returns 200 with availableToWithdraw = '0' (not a 500) when active-withdrawn exceeds active-invested (invest 10,00,000, withdraw 8,00,000, then cancel 5,00,000 of the original investment -- Story 3.8's cancel path has no withdrawal-side counterpart yet)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    // Active-invested dropped below active-withdrawn after the cancel.
    sumActiveAmountByProjectId.mockResolvedValue("500000");
    sumActiveWithdrawnAmountByProjectId.mockResolvedValue("800000");

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.availableToWithdraw).toBe("0");
    for (const partner of body.partners) {
      expect(partner.canTake).toBe("0");
    }
  });

  it("returns 409 sub_partner_shares_over_allocated when a Partner's Sub-partners exceed their own share", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub1", partnerId: "a", sharePercent: "30" }),
      makeSubPartnerShareRow({ subPartnerId: "sub2", partnerId: "a", sharePercent: "30" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("sub_partner_shares_over_allocated");
    expect(body.message).toBe(
      "Can Take isn't available -- A's Sub-partner Shares add up to more than A's own Share %.",
    );
  });
});

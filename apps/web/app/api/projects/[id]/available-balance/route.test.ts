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
const listBalancesByProjectId = vi.fn();

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
  createAvailableBalancePort: () => ({
    creditBalance: vi.fn(),
    debitBalance: vi.fn(),
    listBalancesByProjectId,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/available-balance`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
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
  id: "partner-user-a",
  email: "partner-a@niveshbook.test",
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
    partnerId: "partner-a",
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
    partnerId: "partner-a",
    projectId: PROJECT_ID,
    name: "Sub1",
    sharePercent: "12.5",
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeBalance(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "balance-1",
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "partner-a",
    balance: "50000.00",
    updatedAt: now,
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
  listPartnerSharesByProjectId.mockResolvedValue([makePartnerShareRow()]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  listBalancesByProjectId.mockReset();
  listBalancesByProjectId.mockResolvedValue([]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

function partnerSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: PARTNER_USER.id });
  findUserById.mockResolvedValue(PARTNER_USER);
}

describe("GET .../available-balance (Story 4.9, FR29)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-Owner/Admin session", async () => {
    partnerSession();

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(listBalancesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext());

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("defaults a Partner's balance to '0' when no available_balances row exists yet", async () => {
    ownerSession();

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.partners).toHaveLength(1);
    expect(body.partners[0].balance).toBe("0");
  });

  it("returns the credited balance for a Partner with an available_balances row (AC1's worked example)", async () => {
    ownerSession();
    listBalancesByProjectId.mockResolvedValue([makeBalance({ shareId: "partner-a", balance: "50000.00" })]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.partners[0].balance).toBe("50000.00");
  });

  it("nests a Sub-partner's balance under their parent Partner, defaulting to '0' when uncredited", async () => {
    ownerSession();
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "partner-a", name: "Sub One" }),
    ]);
    listBalancesByProjectId.mockResolvedValue([makeBalance({ partyType: "sub_partner", shareId: "sub-1", balance: "5000.00" })]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.partners[0].subPartners).toHaveLength(1);
    expect(body.partners[0].subPartners[0].balance).toBe("5000.00");
    // The Partner's own row is unaffected by their Sub-partner's balance.
    expect(body.partners[0].balance).toBe("0");
  });

  it("returns an empty partners list for a Project with no current Partner Shares", async () => {
    ownerSession();
    listPartnerSharesByProjectId.mockResolvedValue([]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext());

    expect(response.status).toBe(200);
    expect((await response.json()).partners).toEqual([]);
  });
});

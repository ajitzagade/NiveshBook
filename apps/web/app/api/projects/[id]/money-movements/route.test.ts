import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const listByDestinationProjectId = vi.fn();

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
  createMoneyMovementPort: () => ({
    record: vi.fn(),
    listByDestinationProjectId,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/money-movements`, {
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

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  listByDestinationProjectId.mockReset();
  listByDestinationProjectId.mockResolvedValue([]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

function partnerSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: PARTNER_USER.id });
  findUserById.mockResolvedValue(PARTNER_USER);
}

describe("GET .../money-movements (Story 4.8, FR28)", () => {
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
    expect(listByDestinationProjectId).not.toHaveBeenCalled();
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

  it("returns every money movement landing at this Project", async () => {
    ownerSession();
    const movement = {
      id: "movement-1",
      withdrawalDestinationAllocationId: "alloc-1",
      sourceProjectId: "0192f5a0-5555-7000-8000-000000000005",
      destinationProjectId: PROJECT_ID,
      destinationInvestmentTransactionId: "tx-1",
      amount: "150000",
      createdAt: new Date().toISOString(),
    };
    listByDestinationProjectId.mockResolvedValue([movement]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.moneyMovements).toEqual([movement]);
    expect(listByDestinationProjectId).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("returns [] for a Project with no money movements", async () => {
    ownerSession();

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`), makeContext());

    expect(response.status).toBe(200);
    expect((await response.json()).moneyMovements).toEqual([]);
  });
});

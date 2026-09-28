import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  WithdrawalReallocationAlreadyCancelledError,
  WithdrawalReallocationAlreadyConsumedError,
} from "@niveshbook/core";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findById = vi.fn();
const cancel = vi.fn();

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
  createWithdrawalReallocationPort: () => ({
    record: vi.fn(),
    listActiveByProjectId: vi.fn(),
    listActiveAllocationsByProjectId: vi.fn(),
    listAllocationsByReallocationId: vi.fn(),
    cancel,
    consumeAllocationLegs: vi.fn(),
    findById,
    listAll: vi.fn(),
    listAllAllocations: vi.fn(),
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const REALLOCATION_ID = "0192f5a0-8888-7000-8000-000000000008";

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/withdrawal-reallocations/${REALLOCATION_ID}/cancel`,
    {
      method: "POST",
      headers: cookie ? { Cookie: cookie } : undefined,
    },
  );
}

function makeContext(id: string = PROJECT_ID, reallocationId: string = REALLOCATION_ID) {
  return { params: Promise.resolve({ id, reallocationId }) };
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

const EXISTING_REALLOCATION = {
  id: REALLOCATION_ID,
  projectId: PROJECT_ID,
  partyType: "partner" as const,
  shareId: "a",
  declinedAmount: "100000",
  notes: null,
  status: "active" as const,
  createdByUserId: "owner-1",
  createdAt: new Date().toISOString(),
};

function resetMocks() {
  findSessionByTokenHash.mockReset();
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findUserById.mockResolvedValue(OWNER_USER);
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  findById.mockReset();
  findById.mockResolvedValue(EXISTING_REALLOCATION);
  cancel.mockReset();
  cancel.mockResolvedValue({ ...EXISTING_REALLOCATION, status: "cancelled" });
}

describe("POST /api/projects/[id]/withdrawal-reallocations/[reallocationId]/cancel", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin, checked before any DB read", async () => {
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(403);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    findProjectById.mockResolvedValue(null);

    const response = await POST(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
  });

  it("returns 404 for a malformed reallocationId", async () => {
    const response = await POST(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PROJECT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the reallocation doesn't exist", async () => {
    findById.mockResolvedValue(null);

    const response = await POST(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("returns 404 when the reallocation belongs to a different Project", async () => {
    findById.mockResolvedValue({ ...EXISTING_REALLOCATION, projectId: OTHER_PROJECT_ID });

    const response = await POST(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels an unconsumed reallocation -- 200", async () => {
    const response = await POST(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith(REALLOCATION_ID, "owner-1");
    const body = await response.json();
    expect(body.reallocation.status).toBe("cancelled");
  });

  it("returns 409 already_cancelled", async () => {
    cancel.mockRejectedValue(new WithdrawalReallocationAlreadyCancelledError());

    const response = await POST(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("already_cancelled");
  });

  it("returns 409 already_consumed once any leg has been drawn on", async () => {
    cancel.mockRejectedValue(new WithdrawalReallocationAlreadyConsumedError());

    const response = await POST(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("already_consumed");
  });
});

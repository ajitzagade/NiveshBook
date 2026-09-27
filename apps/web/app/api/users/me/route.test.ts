import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();

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
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/users/me", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

const PARTNER_ID = "0192f5a0-2222-7000-8000-000000000002";

function makeLiveSession(userId: string) {
  return {
    id: "session-1",
    userId,
    tokenHash: "irrelevant",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
}

const PARTNER_USER = {
  id: PARTNER_ID,
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

describe("GET /api/users/me (spec-user-reset-deactivate)", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("returns the caller's own sanitized profile, regardless of role -- no authorize() call needed", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      id: PARTNER_USER.id,
      email: PARTNER_USER.email,
      role: PARTNER_USER.role,
      active: PARTNER_USER.active,
      createdAt: PARTNER_USER.createdAt,
    });
    expect(body.passwordHash).toBeUndefined();
    expect(findUserById).toHaveBeenCalledWith(PARTNER_ID);
  });

  it("returns 404 if the session's own user row is somehow gone", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    findUserById.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(404);
  });
});

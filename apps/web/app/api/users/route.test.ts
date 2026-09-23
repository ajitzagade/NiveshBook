import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const listAllUsers = vi.fn();

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
    listAllUsers,
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/users", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
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
  createdAt: new Date().toISOString(),
};

const PARTNER_USER = {
  id: "partner-1",
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  createdAt: new Date().toISOString(),
};

describe("GET /api/users", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    listAllUsers.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(listAllUsers).not.toHaveBeenCalled();
  });

  it("returns 401 when the session cookie doesn't resolve", async () => {
    findSessionByTokenHash.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(401);
    expect(listAllUsers).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(403);
    expect(listAllUsers).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("returns 200 with a sanitized user list for an owner_admin, never passwordHash", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listAllUsers.mockResolvedValue([OWNER_USER, PARTNER_USER]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([
      {
        id: OWNER_USER.id,
        email: OWNER_USER.email,
        role: OWNER_USER.role,
        active: OWNER_USER.active,
        createdAt: OWNER_USER.createdAt,
      },
      {
        id: PARTNER_USER.id,
        email: PARTNER_USER.email,
        role: PARTNER_USER.role,
        active: PARTNER_USER.active,
        createdAt: PARTNER_USER.createdAt,
      },
    ]);
    for (const user of body) {
      expect(user.passwordHash).toBeUndefined();
    }
  });
});

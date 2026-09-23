import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const listSessionsByUser = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    findSessionByTokenHash,
    touchSession,
    listSessionsByUser,
    deleteSessionById: vi.fn(),
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/sessions", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

const LIVE_SESSION = {
  id: "session-1",
  userId: "user-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

describe("GET /api/auth/sessions", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    listSessionsByUser.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(listSessionsByUser).not.toHaveBeenCalled();
  });

  it("returns 401 when the session cookie doesn't resolve", async () => {
    findSessionByTokenHash.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(401);
    expect(listSessionsByUser).not.toHaveBeenCalled();
  });

  it("returns only the caller's own sessions, sanitized to id/createdAt/expiresAt", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    listSessionsByUser.mockResolvedValue([
      LIVE_SESSION,
      {
        id: "session-2",
        userId: "user-1",
        tokenHash: "irrelevant-2",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(200);
    expect(listSessionsByUser).toHaveBeenCalledWith("user-1");
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      id: "session-1",
      createdAt: LIVE_SESSION.createdAt,
      expiresAt: expect.any(String),
    });
    expect(body[0].tokenHash).toBeUndefined();
  });
});

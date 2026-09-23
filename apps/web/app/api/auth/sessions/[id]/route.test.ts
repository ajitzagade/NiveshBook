import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const deleteSessionById = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    findSessionByTokenHash,
    touchSession,
    listSessionsByUser: vi.fn(),
    deleteSessionById,
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/sessions/some-id", {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

const LIVE_SESSION = {
  id: "0192f5a0-1111-7000-8000-000000000001",
  userId: "user-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

const OTHER_SESSION_ID = "0192f5a0-2222-7000-8000-000000000002";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/auth/sessions/[id]", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    deleteSessionById.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await DELETE(makeRequest(), makeContext(OTHER_SESSION_ID));

    expect(response.status).toBe(401);
    expect(deleteSessionById).not.toHaveBeenCalled();
  });

  it("revokes a session the caller owns and returns 200", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    deleteSessionById.mockResolvedValue(1);

    const response = await DELETE(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(OTHER_SESSION_ID),
    );

    expect(response.status).toBe(200);
    expect(deleteSessionById).toHaveBeenCalledWith(OTHER_SESSION_ID, "user-1");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("revokes the caller's own currently-used session and returns 200", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    deleteSessionById.mockResolvedValue(1);

    const response = await DELETE(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(LIVE_SESSION.id),
    );

    expect(response.status).toBe(200);
    expect(deleteSessionById).toHaveBeenCalledWith(LIVE_SESSION.id, "user-1");
  });

  it("returns 404 when the session id belongs to another user or doesn't exist", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    deleteSessionById.mockResolvedValue(0);

    const response = await DELETE(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(OTHER_SESSION_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 404 for a malformed (non-UUID) id without querying the DB", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);

    const response = await DELETE(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(deleteSessionById).not.toHaveBeenCalled();
  });
});

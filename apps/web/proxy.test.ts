import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    findSessionByTokenHash,
    touchSession,
    listSessionsByUser: vi.fn(),
    deleteSessionById: vi.fn(),
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/", {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

describe("proxy", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
  });

  it("passes requests through untouched when there is no session cookie", async () => {
    const response = await proxy(makeRequest());

    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not re-issue the cookie for an invalid/expired session", async () => {
    findSessionByTokenHash.mockResolvedValue(null);

    const response = await proxy(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("re-issues the cookie with a refreshed Max-Age for a still-valid session", async () => {
    findSessionByTokenHash.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      tokenHash: "irrelevant",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const response = await proxy(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=some-token`);
    expect(setCookie).toMatch(/Max-Age=1800/i);
    // The DB row itself was also renewed (sliding window) via getSession().
    expect(touchSession).toHaveBeenCalled();
  });
});

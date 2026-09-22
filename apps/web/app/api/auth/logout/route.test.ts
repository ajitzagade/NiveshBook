import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hashToken } from "@niveshbook/core";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const deleteSession = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession,
    findSessionByTokenHash: vi.fn(),
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    deleteSession.mockReset();
  });

  it("reads the session cookie and deletes the session by its token hash", async () => {
    const token = "some-raw-session-token";
    const response = await POST(makeRequest(`${SESSION_COOKIE_NAME}=${token}`));

    expect(response.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledWith(hashToken(token));

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it("is a no-op (still 200) when there is no session cookie", async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(deleteSession).not.toHaveBeenCalled();
  });
});

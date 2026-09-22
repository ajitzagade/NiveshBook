import { describe, it, expect, vi, beforeEach } from "vitest";
import * as argon2 from "argon2";
import { NextRequest } from "next/server";
import type { User } from "@niveshbook/types";
import { POST } from "./route";

const findUserByEmail = vi.fn();
const createSession = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createUserPort: () => ({ findUserByEmail }),
  createSessionPort: () => ({
    createSession,
    deleteSession: vi.fn(),
    findSessionByTokenHash: vi.fn(),
  }),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    findUserByEmail.mockReset();
    createSession.mockReset();
  });

  it("sets the session cookie on successful login", async () => {
    const user: User = {
      id: "user-1",
      email: "owner@niveshbook.test",
      passwordHash: await argon2.hash("correct-password"),
      role: "owner_admin",
      active: true,
      createdAt: new Date().toISOString(),
    };
    findUserByEmail.mockResolvedValue(user);
    createSession.mockResolvedValue({
      id: "session-1",
      userId: user.id,
      tokenHash: "irrelevant",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const response = await POST(
      makeRequest({ email: "owner@niveshbook.test", password: "correct-password" }),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("niveshbook_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
  });

  it("returns the identical invalid_credentials response for a missing password", async () => {
    const response = await POST(makeRequest({ email: "owner@niveshbook.test" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "invalid_credentials",
      message: "Incorrect email or password",
    });
    expect(findUserByEmail).not.toHaveBeenCalled();
  });

  it("returns the identical invalid_credentials response for an empty email", async () => {
    const response = await POST(makeRequest({ email: "", password: "something" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "invalid_credentials",
      message: "Incorrect email or password",
    });
    expect(findUserByEmail).not.toHaveBeenCalled();
  });

  it("returns a generic invalid_request 400 for a non-object body", async () => {
    const response = await POST(makeRequest(null));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });
});

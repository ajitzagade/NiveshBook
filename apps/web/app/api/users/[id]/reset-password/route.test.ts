import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import * as argon2 from "argon2";
import type { User } from "@niveshbook/types";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const updatePassword = vi.fn();
const deleteAllSessionsForUser = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    findSessionByTokenHash,
    touchSession,
    listSessionsByUser: vi.fn(),
    deleteSessionById: vi.fn(),
    deleteAllSessionsForUser,
  }),
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById,
    listAllUsers: vi.fn(),
    setUserActive: vi.fn(),
    updatePassword,
  }),
}));

function makeRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest("http://localhost/api/users/some-id/reset-password", {
    method: "POST",
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const OWNER_ID = "0192f5a0-1111-7000-8000-000000000001";
const PARTNER_ID = "0192f5a0-2222-7000-8000-000000000002";
const OTHER_PARTNER_ID = "0192f5a0-3333-7000-8000-000000000003";
const UNKNOWN_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeLiveSession(userId: string) {
  return {
    id: "session-1",
    userId,
    tokenHash: "irrelevant",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
}

const OWNER_USER = {
  id: OWNER_ID,
  email: "owner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "owner_admin" as const,
  active: true,
  canApproveExtraWithdrawal: true,
  createdAt: new Date().toISOString(),
};

const PARTNER_USER = {
  id: PARTNER_ID,
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const OTHER_PARTNER_USER = {
  id: OTHER_PARTNER_ID,
  email: "other-partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

/** Wires findUserById/updatePassword against a mutable in-memory user store, mirroring `[id]/route.test.ts`'s `wireUserStore`. */
function wireUserStore(initialUsers: Record<string, User>) {
  const store = new Map(Object.entries(initialUsers));
  findUserById.mockImplementation(async (id: string) => store.get(id) ?? null);
  updatePassword.mockImplementation(async (id: string, passwordHash: string) => {
    const existing = store.get(id);
    if (!existing) return null;
    const updated = { ...existing, passwordHash };
    store.set(id, updated);
    return updated;
  });
  return store;
}

describe("POST /api/users/[id]/reset-password (spec-user-reset-deactivate)", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    updatePassword.mockReset();
    deleteAllSessionsForUser.mockReset();
  });

  it("returns 401 with no session cookie, before any read", async () => {
    const response = await POST(
      makeRequest({ body: { password: "a-fine-password" } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(401);
    expect(findUserById).not.toHaveBeenCalled();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin, before the body is ever parsed (AD-1 ordering)", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    wireUserStore({ [PARTNER_ID]: PARTNER_USER, [OTHER_PARTNER_ID]: OTHER_PARTNER_USER });

    // A deliberately malformed body -- if this were parsed before
    // authorize(), it would 400 instead of 403.
    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(OTHER_PARTNER_ID),
    );

    expect(response.status).toBe(403);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s resetting another user's password — 403, no self-access override",
    async (role) => {
      const actor = { ...PARTNER_USER, id: PARTNER_ID, role };
      findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
      wireUserStore({ [PARTNER_ID]: actor, [OTHER_PARTNER_ID]: OTHER_PARTNER_USER });

      const response = await POST(
        makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { password: "a-fine-password" } }),
        makeContext(OTHER_PARTNER_ID),
      );

      expect(response.status).toBe(403);
      expect(updatePassword).not.toHaveBeenCalled();
    },
  );

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s resetting their OWN password — 403, no self-access override",
    async (role) => {
      const actor = { ...PARTNER_USER, id: PARTNER_ID, role };
      findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
      wireUserStore({ [PARTNER_ID]: actor });

      const response = await POST(
        makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { password: "a-fine-password" } }),
        makeContext(PARTNER_ID),
      );

      expect(response.status).toBe(403);
      expect(updatePassword).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown target id", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { password: "a-fine-password" } }),
      makeContext(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 404 for a malformed, non-UUID id", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { password: "a-fine-password" } }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("returns 400 when password is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: {} }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("returns 400 when password is a non-string", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { password: 12345678 } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("returns 400 for a password under 8 characters, never calling updatePassword", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { password: "short" } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(body.message).toMatch(/at least 8 characters/i);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("returns 400 for a password over 128 characters, never calling updatePassword", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { password: "a".repeat(129) },
      }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(body.message).toMatch(/at most 128 characters/i);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("Owner/Admin resets another user's password: 200, sanitized (no passwordHash), target's sessions deleted", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { password: "a-fine-password" } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(PARTNER_ID);
    expect(body.passwordHash).toBeUndefined();
    expect(updatePassword).toHaveBeenCalledWith(PARTNER_ID, expect.any(String));
    const storedHash = updatePassword.mock.calls[0]?.[1] as string;
    expect(await argon2.verify(storedHash, "a-fine-password")).toBe(true);
    expect(deleteAllSessionsForUser).toHaveBeenCalledWith(PARTNER_ID);
  });

  it("Owner/Admin resets their own password (normal role check, not blocked)", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { password: "a-fine-password" } }),
      makeContext(OWNER_ID),
    );

    expect(response.status).toBe(200);
    expect(deleteAllSessionsForUser).toHaveBeenCalledWith(OWNER_ID);
  });
});

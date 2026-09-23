import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@niveshbook/types";
import { GET, PATCH } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const setUserActive = vi.fn();
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
    setUserActive,
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/users/some-id", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function makePatchRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest("http://localhost/api/users/some-id", {
    method: "PATCH",
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
  createdAt: new Date().toISOString(),
};

const PARTNER_USER = {
  id: PARTNER_ID,
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  createdAt: new Date().toISOString(),
};

const OTHER_PARTNER_USER = {
  id: OTHER_PARTNER_ID,
  email: "other-partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  createdAt: new Date().toISOString(),
};

describe("GET /api/users/[id]", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    setUserActive.mockReset();
    deleteAllSessionsForUser.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext(PARTNER_ID));

    expect(response.status).toBe(401);
    expect(findUserById).not.toHaveBeenCalledWith(PARTNER_ID);
  });

  it("returns 200 with the owner_admin's view of any target user", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    // First call resolves the actor's own live role, second resolves the target.
    findUserById.mockImplementation(async (id: string) =>
      id === OWNER_ID ? OWNER_USER : id === PARTNER_ID ? PARTNER_USER : null,
    );

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PARTNER_ID),
    );

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
  });

  it("returns 200 for a user viewing their own profile, regardless of role", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    findUserById.mockImplementation(async (id: string) => (id === PARTNER_ID ? PARTNER_USER : null));

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(PARTNER_ID);
  });

  it("returns 403 for a non-owner_admin viewing someone else's profile", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    findUserById.mockImplementation(async (id: string) =>
      id === PARTNER_ID ? PARTNER_USER : id === OTHER_PARTNER_ID ? OTHER_PARTNER_USER : null,
    );

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(OTHER_PARTNER_ID),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).not.toHaveProperty("passwordHash");
    expect(body).not.toHaveProperty("email");
  });

  it("returns 404 (not 403) for a nonexistent id when called by an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockImplementation(async (id: string) => (id === OWNER_ID ? OWNER_USER : null));

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 403, not 404, for a nonexistent id when called by a non-owner_admin (existence never leaks to an unauthorized caller)", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    findUserById.mockImplementation(async (id: string) => (id === PARTNER_ID ? PARTNER_USER : null));

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(UNKNOWN_ID),
    );

    expect(response.status).toBe(403);
  });

  it("returns 404 for a malformed, non-UUID id when called by an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockImplementation(async (id: string) => (id === OWNER_ID ? OWNER_USER : null));

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });
});

describe("PATCH /api/users/[id]", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    setUserActive.mockReset();
    deleteAllSessionsForUser.mockReset();
  });

  /** Wires findUserById/setUserActive against a mutable in-memory user store. */
  function wireUserStore(initialUsers: Record<string, User>) {
    const store = new Map(Object.entries(initialUsers));
    findUserById.mockImplementation(async (id: string) => store.get(id) ?? null);
    setUserActive.mockImplementation(async (id: string, active: boolean) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, active };
      store.set(id, updated);
      return updated;
    });
    return store;
  }

  it("returns 401 with no session cookie", async () => {
    const response = await PATCH(
      makePatchRequest({ body: { active: false } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(401);
    expect(setUserActive).not.toHaveBeenCalled();
  });

  it("Owner/Admin deactivates a user: 200, sanitized active:false, target's sessions deleted", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { active: false } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.active).toBe(false);
    expect(body.id).toBe(PARTNER_ID);
    expect(body.passwordHash).toBeUndefined();
    expect(deleteAllSessionsForUser).toHaveBeenCalledWith(PARTNER_ID);
  });

  it("Owner/Admin reactivates a user: 200, sanitized active:true, target can log in again", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({
      [OWNER_ID]: OWNER_USER,
      [PARTNER_ID]: { ...PARTNER_USER, active: false },
    });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { active: true } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.active).toBe(true);
    expect(deleteAllSessionsForUser).not.toHaveBeenCalled();
  });

  it("setting the same status again is a 200 idempotent no-op with no session deletion", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { active: true } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.active).toBe(true);
    expect(deleteAllSessionsForUser).not.toHaveBeenCalled();
  });

  it("Owner/Admin deactivates own account: 200, own sessions deleted including the one making this request", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { active: false } }),
      makeContext(OWNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.active).toBe(false);
    expect(deleteAllSessionsForUser).toHaveBeenCalledWith(OWNER_ID);
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s deactivating another user — 403, no self-access override",
    async (role) => {
      const actor = { ...PARTNER_USER, id: PARTNER_ID, role };
      findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
      wireUserStore({ [PARTNER_ID]: actor, [OTHER_PARTNER_ID]: OTHER_PARTNER_USER });

      const response = await PATCH(
        makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { active: false } }),
        makeContext(OTHER_PARTNER_ID),
      );

      expect(response.status).toBe(403);
      expect(setUserActive).not.toHaveBeenCalled();
    },
  );

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s deactivating their OWN account — 403, no self-access override",
    async (role) => {
      const actor = { ...PARTNER_USER, id: PARTNER_ID, role };
      findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
      wireUserStore({ [PARTNER_ID]: actor });

      const response = await PATCH(
        makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { active: false } }),
        makeContext(PARTNER_ID),
      );

      expect(response.status).toBe(403);
      expect(setUserActive).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown target id", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { active: false } }),
      makeContext(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when active is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: {} }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
  });

  it("ignores extra/unexpected body fields — only `active` is ever read", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { active: true, role: "owner_admin" },
      }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.active).toBe(true);
    expect(body.role).toBe(PARTNER_USER.role);
    expect(setUserActive).toHaveBeenCalledWith(PARTNER_ID, true);
    expect(deleteAllSessionsForUser).not.toHaveBeenCalled();
  });

  it("returns 400 when active is a non-boolean", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { active: "false" } }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
    expect(setUserActive).not.toHaveBeenCalled();
  });
});

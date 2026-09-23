import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@niveshbook/types";
import { PATCH } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const setApprovalAuthority = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    findSessionByTokenHash,
    touchSession,
    listSessionsByUser: vi.fn(),
    deleteSessionById: vi.fn(),
    deleteAllSessionsForUser: vi.fn(),
  }),
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById,
    listAllUsers: vi.fn(),
    setUserActive: vi.fn(),
    setApprovalAuthority,
  }),
}));

function makePatchRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest("http://localhost/api/permissions/some-id", {
    method: "PATCH",
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeContext(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

const OWNER_ID = "0192f5a0-1111-7000-8000-000000000001";
const TARGET_OWNER_ID = "0192f5a0-2222-7000-8000-000000000002";
const PARTNER_ID = "0192f5a0-3333-7000-8000-000000000003";
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

const OWNER_USER: User = {
  id: OWNER_ID,
  email: "owner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "owner_admin",
  active: true,
  canApproveExtraWithdrawal: true,
  createdAt: new Date().toISOString(),
};

const TARGET_OWNER_USER: User = {
  id: TARGET_OWNER_ID,
  email: "target-owner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "owner_admin",
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const PARTNER_USER: User = {
  id: PARTNER_ID,
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner",
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

describe("PATCH /api/permissions/[userId]", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    setApprovalAuthority.mockReset();
  });

  /** Wires findUserById/setApprovalAuthority against a mutable in-memory user store. */
  function wireUserStore(initialUsers: Record<string, User>) {
    const store = new Map(Object.entries(initialUsers));
    findUserById.mockImplementation(async (id: string) => store.get(id) ?? null);
    setApprovalAuthority.mockImplementation(async (id: string, granted: boolean) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, canApproveExtraWithdrawal: granted };
      store.set(id, updated);
      return updated;
    });
    return store;
  }

  it("returns 401 with no session cookie", async () => {
    const response = await PATCH(
      makePatchRequest({ body: { canApproveExtraWithdrawal: true } }),
      makeContext(TARGET_OWNER_ID),
    );

    expect(response.status).toBe(401);
    expect(setApprovalAuthority).not.toHaveBeenCalled();
  });

  it("Owner/Admin grants approval authority: 200, updated grant returned", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [TARGET_OWNER_ID]: TARGET_OWNER_USER });

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { canApproveExtraWithdrawal: true },
      }),
      makeContext(TARGET_OWNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      id: TARGET_OWNER_ID,
      email: TARGET_OWNER_USER.email,
      canApproveExtraWithdrawal: true,
    });
    expect(setApprovalAuthority).toHaveBeenCalledWith(TARGET_OWNER_ID, true);
  });

  it("Owner/Admin revokes approval authority: 200, revoked immediately", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({
      [OWNER_ID]: OWNER_USER,
      [TARGET_OWNER_ID]: { ...TARGET_OWNER_USER, canApproveExtraWithdrawal: true },
    });

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { canApproveExtraWithdrawal: false },
      }),
      makeContext(TARGET_OWNER_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canApproveExtraWithdrawal).toBe(false);
  });

  it("returns 400 when the target isn't owner_admin, and makes no change", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [PARTNER_ID]: PARTNER_USER });

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { canApproveExtraWithdrawal: true },
      }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_request");
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s reaching this endpoint — 403, no self-access override",
    async (role) => {
      const actor = { ...PARTNER_USER, id: PARTNER_ID, role };
      findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
      wireUserStore({ [PARTNER_ID]: actor, [TARGET_OWNER_ID]: TARGET_OWNER_USER });

      const response = await PATCH(
        makePatchRequest({
          cookie: `${SESSION_COOKIE_NAME}=some-token`,
          body: { canApproveExtraWithdrawal: true },
        }),
        makeContext(TARGET_OWNER_ID),
      );

      expect(response.status).toBe(403);
      expect(setApprovalAuthority).not.toHaveBeenCalled();
    },
  );

  it("returns 401 for an unauthenticated caller even against a non-owner_admin target", async () => {
    findSessionByTokenHash.mockResolvedValue(null);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { canApproveExtraWithdrawal: true },
      }),
      makeContext(PARTNER_ID),
    );

    expect(response.status).toBe(401);
    expect(setApprovalAuthority).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown target id", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER });

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { canApproveExtraWithdrawal: true },
      }),
      makeContext(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 404 for a malformed, non-UUID id", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER });

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { canApproveExtraWithdrawal: true },
      }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(setApprovalAuthority).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [TARGET_OWNER_ID]: TARGET_OWNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(TARGET_OWNER_ID),
    );

    expect(response.status).toBe(400);
    expect(setApprovalAuthority).not.toHaveBeenCalled();
  });

  it("returns 400 when canApproveExtraWithdrawal is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [TARGET_OWNER_ID]: TARGET_OWNER_USER });

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: {} }),
      makeContext(TARGET_OWNER_ID),
    );

    expect(response.status).toBe(400);
    expect(setApprovalAuthority).not.toHaveBeenCalled();
  });

  it("returns 400 when canApproveExtraWithdrawal is a non-boolean", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    wireUserStore({ [OWNER_ID]: OWNER_USER, [TARGET_OWNER_ID]: TARGET_OWNER_USER });

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { canApproveExtraWithdrawal: "true" },
      }),
      makeContext(TARGET_OWNER_ID),
    );

    expect(response.status).toBe(400);
    expect(setApprovalAuthority).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@niveshbook/types";
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
    deleteAllSessionsForUser: vi.fn(),
  }),
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById,
    listAllUsers,
    setUserActive: vi.fn(),
    setApprovalAuthority: vi.fn(),
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/permissions", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

const OWNER_ID = "0192f5a0-1111-7000-8000-000000000001";
const OTHER_OWNER_ID = "0192f5a0-2222-7000-8000-000000000002";
const PARTNER_ID = "0192f5a0-3333-7000-8000-000000000003";
const PROJECT_ADMIN_ID = "0192f5a0-4444-7000-8000-000000000004";

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

const OTHER_OWNER_USER: User = {
  id: OTHER_OWNER_ID,
  email: "other-owner@niveshbook.test",
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

const PROJECT_ADMIN_USER: User = {
  id: PROJECT_ADMIN_ID,
  email: "project-admin@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "project_admin",
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

describe("GET /api/permissions", () => {
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

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "returns 403 for a %s",
    async (role) => {
      const actor = { ...PARTNER_USER, role };
      findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
      findUserById.mockResolvedValue(actor);

      const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

      expect(response.status).toBe(403);
      expect(listAllUsers).not.toHaveBeenCalled();
    },
  );

  it("returns 200 with enabledRoles.project_admin: true and every owner_admin as an approver", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);
    listAllUsers.mockResolvedValue([
      OWNER_USER,
      OTHER_OWNER_USER,
      PARTNER_USER,
      PROJECT_ADMIN_USER,
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      enabledRoles: { project_admin: true },
      approvers: [
        { id: OWNER_ID, email: OWNER_USER.email, canApproveExtraWithdrawal: true },
        { id: OTHER_OWNER_ID, email: OTHER_OWNER_USER.email, canApproveExtraWithdrawal: false },
      ],
    });
  });

  it("returns enabledRoles.project_admin: false when no active project_admin exists", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);
    listAllUsers.mockResolvedValue([OWNER_USER]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.enabledRoles.project_admin).toBe(false);
  });

  it("reflects the last project_admin being deactivated on the very next GET (never caches)", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);
    listAllUsers.mockResolvedValue([OWNER_USER, PROJECT_ADMIN_USER]);

    const before = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));
    expect((await before.json()).enabledRoles.project_admin).toBe(true);

    listAllUsers.mockResolvedValue([OWNER_USER, { ...PROJECT_ADMIN_USER, active: false }]);

    const after = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));
    expect((await after.json()).enabledRoles.project_admin).toBe(false);
  });
});

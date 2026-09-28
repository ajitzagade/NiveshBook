import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();

const partnerSharesListAll = vi.fn();
const subPartnerSharesListAll = vi.fn();
const listProjects = vi.fn();

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
    listAllUsers: vi.fn(),
  }),
  createPartnerSharePort: () => ({
    createPartnerShare: vi.fn(),
    findLatestByPartnerId: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: partnerSharesListAll,
  }),
  createSubPartnerSharePort: () => ({
    createSubPartnerShare: vi.fn(),
    findLatestBySubPartnerId: vi.fn(),
    listByPartnerId: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: subPartnerSharesListAll,
  }),
  createProjectPort: () => ({
    createProject: vi.fn(),
    updateProject: vi.fn(),
    findProjectById: vi.fn(),
    listProjects,
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/my-projects", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

const LIVE_SESSION = {
  id: "session-1",
  userId: "owner-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "owner-1",
    email: "owner@niveshbook.test",
    passwordHash: "hash-should-never-leave-server",
    role: "owner_admin",
    active: true,
    canApproveExtraWithdrawal: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const OWNER_USER = makeUser();
const PARTNER_USER = makeUser({ id: "partner-user-a", email: "partner-a@niveshbook.test", role: "partner" });
const SUB_PARTNER_USER = makeUser({ id: "sub-partner-user-a", email: "sub-a@niveshbook.test", role: "sub_partner" });
const OTHER_ROLE_USER = makeUser({ id: "pa-1", email: "pa@niveshbook.test", role: "project_admin" });

const PROJECT_A = { id: "project-a", name: "Project A", description: null, createdAt: "", updatedAt: "" };
const PROJECT_B = { id: "project-b", name: "Project B", description: null, createdAt: "", updatedAt: "" };

const PARTNER_SHARE_PROJECT_A = {
  id: "row-1",
  partnerId: "partner-1",
  projectId: "project-a",
  name: "Partner A",
  sharePercent: "60",
  userId: "partner-user-a",
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const OTHER_PARTNER_SHARE = {
  id: "row-2",
  partnerId: "partner-2",
  projectId: "project-b",
  name: "Someone Else",
  sharePercent: "40",
  userId: "someone-else",
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const SUB_PARTNER_SHARE_PROJECT_A = {
  id: "sub-row-1",
  subPartnerId: "sub-partner-1",
  partnerId: "partner-1",
  projectId: "project-a",
  name: "Sub-partner A",
  sharePercent: "30",
  userId: "sub-partner-user-a",
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const OTHER_SUB_PARTNER_SHARE = {
  id: "sub-row-2",
  subPartnerId: "sub-partner-2",
  partnerId: "partner-1",
  projectId: "project-b",
  name: "Sub-partner B",
  sharePercent: "10",
  userId: "someone-else",
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset().mockResolvedValue(1);
  findUserById.mockReset();
  partnerSharesListAll.mockReset().mockResolvedValue([]);
  subPartnerSharesListAll.mockReset().mockResolvedValue([]);
  listProjects.mockReset().mockResolvedValue([PROJECT_A, PROJECT_B]);
}

function sessionFor(user: ReturnType<typeof makeUser>) {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: user.id });
  findUserById.mockResolvedValue(user);
}

describe("GET /api/my-projects (spec-partner-project-list-self-access)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie, before any data read", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("returns 403 for a role not granted my_projects:list (project_admin), before any data read (AD-1)", async () => {
    sessionFor(OTHER_ROLE_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(listProjects).not.toHaveBeenCalled();
    expect(partnerSharesListAll).not.toHaveBeenCalled();
    expect(subPartnerSharesListAll).not.toHaveBeenCalled();
  });

  it("Owner/Admin session: returns every Project -- same set the switcher shows today", async () => {
    sessionFor(OWNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects.map((p: { id: string }) => p.id).sort()).toEqual(["project-a", "project-b"]);
  });

  it("Partner with a current Partner Share: returns exactly that Project, never a 403", async () => {
    sessionFor(PARTNER_USER);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
    subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toEqual([{ id: "project-a", name: "Project A" }]);
  });

  it("Sub-partner with a current Sub-partner Share: returns exactly that Project", async () => {
    sessionFor(SUB_PARTNER_USER);
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_PROJECT_A, OTHER_PARTNER_SHARE]);
    subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_PROJECT_A, OTHER_SUB_PARTNER_SHARE]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toEqual([{ id: "project-a", name: "Project A" }]);
  });

  it("Partner/Sub-partner with zero current shares: returns [] -- the switcher's 'No Projects yet' case", async () => {
    sessionFor(PARTNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(200);
    expect((await response.json()).projects).toEqual([]);
  });
});

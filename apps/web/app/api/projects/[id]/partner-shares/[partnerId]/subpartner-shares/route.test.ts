import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findLatestByPartnerId = vi.fn();
const createSubPartnerShare = vi.fn();
const findLatestBySubPartnerId = vi.fn();
const listByPartnerId = vi.fn();

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
  createProjectPort: () => ({
    createProject: vi.fn(),
    updateProject: vi.fn(),
    findProjectById,
    listProjects: vi.fn(),
  }),
  createPartnerSharePort: () => ({
    createPartnerShare: vi.fn(),
    findLatestByPartnerId,
    listByProjectId: vi.fn(),
  }),
  createSubPartnerSharePort: () => ({
    createSubPartnerShare,
    findLatestBySubPartnerId,
    listByPartnerId,
  }),
}));

const PROJECT_ID = "0192f5a0-3333-7000-8000-000000000003";
const OTHER_PROJECT_ID = "0192f5a0-7777-7000-8000-000000000007";
const PARTNER_ID = "0192f5a0-5555-7000-8000-000000000005";
const UNKNOWN_PARTNER_ID = "0192f5a0-6666-7000-8000-000000000006";

function makeGetRequest(cookie?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/partner-shares/${PARTNER_ID}/subpartner-shares`,
    {
      method: "GET",
      headers: cookie ? { Cookie: cookie } : undefined,
    },
  );
}

function makePostRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/partner-shares/${PARTNER_ID}/subpartner-shares`,
    {
      method: "POST",
      headers,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
}

function makeContext(id: string = PROJECT_ID, partnerId: string = PARTNER_ID) {
  return { params: Promise.resolve({ id, partnerId }) };
}

const LIVE_SESSION = {
  id: "session-1",
  userId: "owner-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

const OWNER_USER = {
  id: "owner-1",
  email: "owner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "owner_admin" as const,
  active: true,
  canApproveExtraWithdrawal: true,
  createdAt: new Date().toISOString(),
};

const PARTNER_USER = {
  id: "partner-user-1",
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const EXISTING_PROJECT = {
  id: PROJECT_ID,
  name: "Verification Project",
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makePartnerShare(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "partner-row-1",
    partnerId: PARTNER_ID,
    projectId: PROJECT_ID,
    name: "Partner A",
    sharePercent: "50",
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeSubShare(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    subPartnerId: "subpartner-1",
    partnerId: PARTNER_ID,
    projectId: PROJECT_ID,
    name: "Sub1",
    sharePercent: "12.5",
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  findLatestByPartnerId.mockReset();
  findLatestByPartnerId.mockResolvedValue(makePartnerShare());
  createSubPartnerShare.mockReset();
  findLatestBySubPartnerId.mockReset();
  listByPartnerId.mockReset();
}

describe("GET /api/projects/[id]/partner-shares/[partnerId]/subpartner-shares", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(listByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-owner_admin, no data leaked", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(listByPartnerId).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("returns 200 with an empty list and total '0' for a partner with zero sub-partners", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByPartnerId.mockResolvedValue([]);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ shares: [], total: "0" });
  });

  it("returns 200 with a computed total under the parent partner's share", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByPartnerId.mockResolvedValue([
      makeSubShare({ subPartnerId: "a", sharePercent: "12.5" }),
    ]);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe("12.5");
    expect(body.shares).toHaveLength(1);
  });

  it("returns 200 with an over-allocated computed total against the parent partner's 50% share, nothing blocks it", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByPartnerId.mockResolvedValue([
      makeSubShare({ subPartnerId: "a", sharePercent: "30" }),
      makeSubShare({ subPartnerId: "b", sharePercent: "30" }),
    ]);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    const body = await response.json();
    expect(body.total).toBe("60");
  });

  it("reduces multiple version rows to the latest per subPartnerId", async () => {
    listByPartnerId.mockResolvedValue([
      makeSubShare({
        id: "row-1",
        subPartnerId: "a",
        sharePercent: "12.5",
        effectiveFrom: new Date(1000).toISOString(),
      }),
      makeSubShare({
        id: "row-2",
        subPartnerId: "a",
        sharePercent: "20",
        effectiveFrom: new Date(2000).toISOString(),
      }),
    ]);
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    const body = await response.json();
    expect(body.shares).toHaveLength(1);
    expect(body.shares[0].sharePercent).toBe("20");
    expect(body.total).toBe("20");
  });

  it("returns 404 for a nonexistent project", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(listByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid", PARTNER_ID),
    );

    expect(response.status).toBe(404);
    expect(listByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PROJECT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(listByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(null);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PROJECT_ID, UNKNOWN_PARTNER_ID),
    );

    expect(response.status).toBe(404);
    expect(listByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 when the partnerId belongs to a different project than the URL's project id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makePartnerShare({ projectId: OTHER_PROJECT_ID }));

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PROJECT_ID, PARTNER_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(listByPartnerId).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[id]/partner-shares/[partnerId]/subpartner-shares", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(
      makePostRequest({ body: { name: "Sub1", sharePercent: "12.5" } }),
      makeContext(),
    );

    expect(response.status).toBe(401);
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("adds a sub-partner -- 201, row created", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createSubPartnerShare.mockResolvedValue(
      makeSubShare({ name: "Sub1", sharePercent: "12.5" }),
    );

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "12.5" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe("Sub1");
    expect(body.sharePercent).toBe("12.5");
    expect(createSubPartnerShare).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: PARTNER_ID,
        projectId: PROJECT_ID,
        name: "Sub1",
        sharePercent: "12.5",
      }),
    );
  });

  it("adds a second sub-partner with an independently valid share -- both succeed even though together they don't reconcile to the parent's share", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createSubPartnerShare.mockResolvedValue(
      makeSubShare({ subPartnerId: "b", name: "Sub2", sharePercent: "30" }),
    );

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub2", sharePercent: "30" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
  });

  it.each(["0", "150", "-5"])(
    "blocks an out-of-range share (%j) with a 400 validation_error, before save",
    async (sharePercent) => {
      findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
      findUserById.mockResolvedValue(OWNER_USER);

      const response = await POST(
        makePostRequest({
          cookie: `${SESSION_COOKIE_NAME}=some-token`,
          body: { name: "Sub1", sharePercent },
        }),
        makeContext(),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("validation_error");
      expect(createSubPartnerShare).not.toHaveBeenCalled();
    },
  );

  it("blocks an empty name with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "", sharePercent: "12.5" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin with an otherwise-valid body -- no row created, checked before body validation", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "12.5" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 403, not 400, for a non-owner_admin sending a malformed body -- authorization checked before body shape", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: 12345 } }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 400 when sharePercent is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: "Sub1" } }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "12.5" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(null);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "12.5" },
      }),
      makeContext(PROJECT_ID, UNKNOWN_PARTNER_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 when the partnerId belongs to a different project than the URL's project id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makePartnerShare({ projectId: OTHER_PROJECT_ID }));

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "12.5" },
      }),
      makeContext(PROJECT_ID, PARTNER_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });
});

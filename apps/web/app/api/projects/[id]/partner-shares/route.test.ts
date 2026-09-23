import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const createPartnerShare = vi.fn();
const findLatestByPartnerId = vi.fn();
const listByProjectId = vi.fn();

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
    createPartnerShare,
    findLatestByPartnerId,
    listByProjectId,
  }),
}));

const PROJECT_ID = "0192f5a0-3333-7000-8000-000000000003";

function makeGetRequest(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/partner-shares`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function makePostRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/partner-shares`, {
    method: "POST",
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeContext(id: string = PROJECT_ID) {
  return { params: Promise.resolve({ id }) };
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

function makeShare(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
    name: "Partner A",
    sharePercent: "50",
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

const EXISTING_PROJECT = {
  id: PROJECT_ID,
  name: "Verification Project",
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  createPartnerShare.mockReset();
  findLatestByPartnerId.mockReset();
  listByProjectId.mockReset();
}

describe("GET /api/projects/[id]/partner-shares", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(listByProjectId).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-owner_admin, no data leaked", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(403);
    expect(listByProjectId).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("returns 200 with an empty list and total '0' for a project with zero partners", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByProjectId.mockResolvedValue([]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ shares: [], total: "0" });
  });

  it("returns 200 with a partial (under-100) computed total", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByProjectId.mockResolvedValue([
      makeShare({ partnerId: "a", sharePercent: "50" }),
      makeShare({ partnerId: "b", sharePercent: "30" }),
    ]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe("80");
    expect(body.shares).toHaveLength(2);
  });

  it("returns 200 with an over-allocated (over-100) computed total", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByProjectId.mockResolvedValue([
      makeShare({ partnerId: "a", sharePercent: "60" }),
      makeShare({ partnerId: "b", sharePercent: "50" }),
    ]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    const body = await response.json();
    expect(body.total).toBe("110");
  });

  it("reduces multiple version rows to the latest per partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByProjectId.mockResolvedValue([
      makeShare({
        id: "row-1",
        partnerId: "a",
        sharePercent: "50",
        effectiveFrom: new Date(1000).toISOString(),
      }),
      makeShare({
        id: "row-2",
        partnerId: "a",
        sharePercent: "70",
        effectiveFrom: new Date(2000).toISOString(),
      }),
    ]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    const body = await response.json();
    expect(body.shares).toHaveLength(1);
    expect(body.shares[0].sharePercent).toBe("70");
    expect(body.total).toBe("70");
  });

  it("returns 404 for a nonexistent project, rather than silently returning an empty list", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(listByProjectId).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[id]/partner-shares", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(
      makePostRequest({ body: { name: "Partner A", sharePercent: "50" } }),
      makeContext(),
    );

    expect(response.status).toBe(401);
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("adds a partner -- 201, row created", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createPartnerShare.mockResolvedValue(makeShare({ name: "Partner A", sharePercent: "50" }));

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe("Partner A");
    expect(body.sharePercent).toBe("50");
    expect(createPartnerShare).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, name: "Partner A", sharePercent: "50" }),
    );
  });

  it("accepts a 2-decimal share (33.33), stored exactly", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createPartnerShare.mockResolvedValue(makeShare({ name: "Partner A", sharePercent: "33.33" }));

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "33.33" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.sharePercent).toBe("33.33");
  });

  it.each(["0", "150", "-5"])(
    "blocks an out-of-range share (%j) with a 400 validation_error, before save",
    async (sharePercent) => {
      findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
      findUserById.mockResolvedValue(OWNER_USER);

      const response = await POST(
        makePostRequest({
          cookie: `${SESSION_COOKIE_NAME}=some-token`,
          body: { name: "Partner A", sharePercent },
        }),
        makeContext(),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("validation_error");
      expect(createPartnerShare).not.toHaveBeenCalled();
    },
  );

  it("blocks an empty name with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "", sharePercent: "50" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin with an otherwise-valid body -- no row created", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 403, not 400, for a non-owner_admin sending a malformed body -- authorization checked before body shape", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: 12345 } }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 400 when sharePercent is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: "Partner A" } }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project, rather than letting the insert fail on the FK constraint", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createPartnerShare).not.toHaveBeenCalled();
  });
});

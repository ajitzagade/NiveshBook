import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const createInvestmentRequirement = vi.fn();
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
  createInvestmentRequirementPort: () => ({
    createInvestmentRequirement,
    listByProjectId,
  }),
}));

const PROJECT_ID = "0192f5a0-3333-7000-8000-000000000003";

function makeGetRequest(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/investment-requirements`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function makePostRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/investment-requirements`, {
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

function makeRequirement(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    projectId: PROJECT_ID,
    amount: "1000000",
    requirementDate: "2026-10-01",
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
  createInvestmentRequirement.mockReset();
  listByProjectId.mockReset();
  listByProjectId.mockResolvedValue([]);
}

describe("GET /api/projects/[id]/investment-requirements", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(listByProjectId).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin, no data leaked", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(listByProjectId).not.toHaveBeenCalled();
  });

  it("returns 200 with an empty list for a project with no requirements yet", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByProjectId.mockResolvedValue([]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ requirements: [] });
  });

  it("returns 200 with the full list for an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByProjectId.mockResolvedValue([makeRequirement(), makeRequirement({ id: "row-2" })]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requirements).toHaveLength(2);
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

describe("POST /api/projects/[id]/investment-requirements", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(
      makePostRequest({ body: { amount: "1000000", requirementDate: "2026-10-01" } }),
      makeContext(),
    );

    expect(response.status).toBe(401);
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("creates a requirement -- 201, saved", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createInvestmentRequirement.mockResolvedValue(makeRequirement());

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.amount).toBe("1000000");
    expect(body.requirementDate).toBe("2026-10-01");
    expect(createInvestmentRequirement).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, amount: "1000000", requirementDate: "2026-10-01" }),
    );
  });

  it("returns 403 for a non-owner_admin with an otherwise-valid body -- no row created", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 403, not 400, for a non-owner_admin sending a malformed body -- authorization checked before body shape", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { amount: 12345 } }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_request");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 400 when requirementDate is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { amount: "1000000" } }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_request");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("blocks amount '0' with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "0", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("blocks a negative amount with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "-500", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("blocks an amount with more than 2 decimal places with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000.999", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("blocks a malformed date with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "not-a-date" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project, rather than letting the insert fail on the FK constraint", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });
});

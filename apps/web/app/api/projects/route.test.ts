import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const listProjects = vi.fn();
const createProject = vi.fn();

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
    createProject,
    updateProject: vi.fn(),
    findProjectById: vi.fn(),
    listProjects,
  }),
}));

function makeGetRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/projects", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function makePostRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest("http://localhost/api/projects", {
    method: "POST",
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
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
  id: "partner-1",
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const SAMPLE_PROJECT = {
  id: "project-1",
  name: "Project A",
  description: "Residential development at Pune",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("GET /api/projects", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    listProjects.mockReset();
    createProject.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest());

    expect(response.status).toBe(401);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-owner_admin, no project data leaked", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(403);
    expect(listProjects).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("returns 200 with the project list for an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listProjects.mockResolvedValue([SAMPLE_PROJECT]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([SAMPLE_PROJECT]);
  });
});

describe("POST /api/projects", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    listProjects.mockReset();
    createProject.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makePostRequest({ body: { name: "Project A" } }));

    expect(response.status).toBe(401);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("creates a project with just a name and description — 201, no partner info required", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createProject.mockResolvedValue(SAMPLE_PROJECT);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Project A", description: "Residential development at Pune" },
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual(SAMPLE_PROJECT);
    expect(createProject).toHaveBeenCalledWith({
      name: "Project A",
      description: "Residential development at Pune",
    });
  });

  it("blocks an empty name with a 400 validation_error naming the field, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: "" } }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createProject).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin with an otherwise-valid body — no project created", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Project A", description: "Something" },
      }),
    );

    expect(response.status).toBe(403);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("returns 403, not 400, for a non-owner_admin sending a malformed body — authorization is checked before body shape", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: 12345 } }),
    );

    expect(response.status).toBe(403);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
    );

    expect(response.status).toBe(400);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: {} }),
    );

    expect(response.status).toBe(400);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("returns 400 when description is a non-string, non-null value", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Project A", description: 12345 },
      }),
    );

    expect(response.status).toBe(400);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("stores a missing description as null", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createProject.mockResolvedValue(SAMPLE_PROJECT);

    await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: "Project A" } }),
    );

    expect(createProject).toHaveBeenCalledWith({ name: "Project A", description: null });
  });
});

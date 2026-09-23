import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Project } from "@niveshbook/types";
import { GET, PATCH } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const updateProject = vi.fn();

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
    updateProject,
    findProjectById,
    listProjects: vi.fn(),
  }),
}));

function makeGetRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/projects/some-id", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function makePatchRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest("http://localhost/api/projects/some-id", {
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
const PROJECT_ID = "0192f5a0-3333-7000-8000-000000000003";
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

const EXISTING_PROJECT: Project = {
  id: PROJECT_ID,
  name: "Project A",
  description: "Residential development at Pune",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("GET /api/projects/[id]", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    findProjectById.mockReset();
    updateProject.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest(), makeContext(PROJECT_ID));

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 200 with the project for an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(EXISTING_PROJECT);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(EXISTING_PROJECT);
  });

  it("returns 403 for a non-owner_admin, no project data leaked", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(403);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent id when called by an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 404 (not 400) for a malformed, non-UUID id when called by an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/projects/[id]", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    findProjectById.mockReset();
    updateProject.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await PATCH(
      makePatchRequest({ body: { name: "New Name" } }),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(401);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("Owner/Admin edits name/description: 200, change reflected immediately", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);
    const updated = { ...EXISTING_PROJECT, name: "New Name", description: "New description" };
    updateProject.mockResolvedValue(updated);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "New Name", description: "New description" },
      }),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(updated);
    expect(updateProject).toHaveBeenCalledWith(PROJECT_ID, {
      name: "New Name",
      description: "New description",
    });
  });

  it("returns 404 for editing a nonexistent project", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);
    updateProject.mockResolvedValue(null);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: "New Name" } }),
      makeContext(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 403 for a non-owner_admin editing an existing project — no changes persisted", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "New Name" },
      }),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(403);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("returns 403, not 400, for a non-owner_admin sending a malformed body — authorization is checked before body shape", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(PARTNER_ID));
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: 12345 } }),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(403);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("returns 404 (not 400) for a malformed, non-UUID id when called by an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: "New Name" } }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("blocks an empty name with a 400 validation_error — packages/core's real domain validation runs before the port is ever touched", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: "" } }),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(400);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing from the body", async () => {
    findSessionByTokenHash.mockResolvedValue(makeLiveSession(OWNER_ID));
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: {} }),
      makeContext(PROJECT_ID),
    );

    expect(response.status).toBe(400);
    expect(updateProject).not.toHaveBeenCalled();
  });
});

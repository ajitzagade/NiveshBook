import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findUserByEmail = vi.fn();
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
    findUserByEmail,
    findUserById,
    listAllUsers: vi.fn(),
  }),
  createPartnerSharePort: () => ({
    createPartnerShare,
    findLatestByPartnerId,
    listByProjectId,
  }),
}));

const PROJECT_ID = "0192f5a0-3333-7000-8000-000000000003";
const OTHER_PROJECT_ID = "0192f5a0-7777-7000-8000-000000000007";
const PARTNER_ID = "0192f5a0-5555-7000-8000-000000000005";
const UNKNOWN_PARTNER_ID = "0192f5a0-6666-7000-8000-000000000006";

function makePatchRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/partner-shares/${PARTNER_ID}`,
    {
      method: "PATCH",
      headers,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
}

function makeContext(partnerId: string = PARTNER_ID, id: string = PROJECT_ID) {
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

function makeShare(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    partnerId: PARTNER_ID,
    projectId: PROJECT_ID,
    name: "Partner A",
    sharePercent: "50",
    userId: null,
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
  findUserByEmail.mockReset();
  createPartnerShare.mockReset();
  findLatestByPartnerId.mockReset();
  listByProjectId.mockReset();
}

describe("PATCH /api/projects/[id]/partner-shares/[partnerId]", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await PATCH(
      makePatchRequest({ body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "" } }),
      makeContext(),
    );

    expect(response.status).toBe(401);
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("Owner/Admin edits the share: 200, a new versioned row is created (new id/effectiveFrom, same partnerId) -- old row untouched", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    const existing = makeShare({ id: "row-1", sharePercent: "50" });
    findLatestByPartnerId.mockResolvedValue(existing);
    const newVersion = makeShare({ id: "row-2", sharePercent: "60" });
    createPartnerShare.mockResolvedValue(newVersion);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(newVersion);
    expect(createPartnerShare).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: PARTNER_ID,
        projectId: PROJECT_ID,
        sharePercent: "60",
        userId: null,
      }),
    );
  });

  it("unlinks an already-linked Partner Share -- 200, new versioned row with userId null", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    const existing = makeShare({ id: "row-1", sharePercent: "50", userId: PARTNER_USER.id });
    findLatestByPartnerId.mockResolvedValue(existing);
    const newVersion = makeShare({ id: "row-2", sharePercent: "50", userId: null });
    createPartnerShare.mockResolvedValue(newVersion);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.userId).toBeNull();
    expect(createPartnerShare).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it("links a Partner Share to a user via email on edit -- 200, userId set", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(PARTNER_USER);
    const existing = makeShare({ id: "row-1", sharePercent: "50" });
    findLatestByPartnerId.mockResolvedValue(existing);
    createPartnerShare.mockResolvedValue(
      makeShare({ id: "row-2", sharePercent: "50", userId: PARTNER_USER.id }),
    );

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: PARTNER_USER.email },
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.userId).toBe(PARTNER_USER.id);
  });

  it("blocks a linkedUserEmail that resolves to no user on edit -- 400 validation_error, no new version created", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(null);
    findLatestByPartnerId.mockResolvedValue(makeShare());

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: "nobody@x.test" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("blocks a linkedUserEmail that resolves to a non-partner role on edit -- 400 validation_error, no new version created", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare());

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: OWNER_USER.email },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(null);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "" },
      }),
      makeContext(UNKNOWN_PARTNER_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 (not 400) for a malformed, non-UUID partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "" },
      }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 (not 400) for a malformed, non-UUID project id in the URL", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "" },
      }),
      makeContext(PARTNER_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 when the partnerId belongs to a different project than the URL's project id -- cannot edit a Partner Share through another project's URL", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare({ projectId: OTHER_PROJECT_ID }));

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "" },
      }),
      makeContext(PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin -- no new version created", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(createPartnerShare).not.toHaveBeenCalled();
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 403, not 400, for a non-owner_admin sending a malformed body -- authorization checked before body shape", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: 12345 } }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("blocks an out-of-range share with a 400 validation_error -- no new version created", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare());

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "150", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(createPartnerShare).not.toHaveBeenCalled();
  });
});

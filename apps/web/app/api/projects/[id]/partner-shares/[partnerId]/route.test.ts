import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findUserByEmail = vi.fn();
const createPartnerShare = vi.fn();
const findLatestByPartnerId = vi.fn();
const listByProjectId = vi.fn();
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
    findUserByEmail,
    findUserById,
    listAllUsers: vi.fn(),
  }),
  createPartnerSharePort: () => ({
    createPartnerShare,
    findLatestByPartnerId,
    listByProjectId,
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
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/partner-shares/${PARTNER_ID}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

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
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

const SUB_PARTNER_USER = {
  id: "sub-partner-user-1",
  email: "subpartner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "sub_partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const OTHER_SUB_PARTNER_USER = {
  id: "other-sub-partner-user-1",
  email: "othersubpartner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "sub_partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

function makeSubShare(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "sub-row-1",
    subPartnerId: "sub-partner-1",
    partnerId: PARTNER_ID,
    projectId: PROJECT_ID,
    name: "Sub-partner A",
    sharePercent: "20",
    userId: SUB_PARTNER_USER.id,
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
  createSubPartnerShare.mockReset();
  findLatestBySubPartnerId.mockReset();
  listByPartnerId.mockReset();
  listByPartnerId.mockResolvedValue([]);
}

describe("GET /api/projects/[id]/partner-shares/[partnerId] (Story 2.6)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });

  it("Owner/Admin gets 200 with the full row, unconditionally, regardless of grant state", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    const share = makeShare({ subPartnerVisibilityGrant: false });
    findLatestByPartnerId.mockResolvedValue(share);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(share);
  });

  it("returns 403, not data, for a linked Sub-partner when the grant is off", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare({ subPartnerVisibilityGrant: false }));
    listByPartnerId.mockResolvedValue([makeSubShare()]);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("returns 200 with only { sharePercent } for a linked Sub-partner when the grant is on -- no name/userId/id/effectiveFrom", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(
      makeShare({ subPartnerVisibilityGrant: true, sharePercent: "50" }),
    );
    listByPartnerId.mockResolvedValue([makeSubShare()]);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ sharePercent: "50" });
  });

  it("returns 403 for a different Partner's Sub-partner, even though the grant is on", async () => {
    findSessionByTokenHash.mockResolvedValue({
      ...LIVE_SESSION,
      userId: OTHER_SUB_PARTNER_USER.id,
    });
    findUserById.mockResolvedValue(OTHER_SUB_PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare({ subPartnerVisibilityGrant: true }));
    // This Sub-partner is linked, but under a *different* Partner -- not
    // among this Partner's own current Sub-partner Shares.
    listByPartnerId.mockResolvedValue([makeSubShare({ userId: SUB_PARTNER_USER.id })]);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("forbidden");
  });

  it("immediately reverts to 403 once the grant is toggled back off", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    listByPartnerId.mockResolvedValue([makeSubShare()]);

    findLatestByPartnerId.mockResolvedValue(makeShare({ subPartnerVisibilityGrant: true }));
    const onResponse = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );
    expect(onResponse.status).toBe(200);

    findLatestByPartnerId.mockResolvedValue(makeShare({ subPartnerVisibilityGrant: false }));
    const offResponse = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );
    expect(offResponse.status).toBe(403);
  });

  it("returns 403 for a Partner-role caller -- this endpoint's grant projection is Sub-partner-only", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: PARTNER_USER.id });
    findUserById.mockResolvedValue(PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare({ subPartnerVisibilityGrant: true }));
    listByPartnerId.mockResolvedValue([]);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(403);
  });

  it("returns 403, not 404, for a Sub-partner probing a nonexistent partnerId -- no existence oracle", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(null);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(UNKNOWN_PARTNER_ID),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("forbidden");
  });

  it("returns 403, not 404, for a Sub-partner probing a malformed partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(403);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 (existing granular precedent) for Owner/Admin requesting a nonexistent partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(null);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(UNKNOWN_PARTNER_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 404 for Owner/Admin requesting a malformed partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 for Owner/Admin when the partnerId belongs to a different project than the URL's project id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare({ projectId: OTHER_PROJECT_ID }));

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 403 (not 404) for a Sub-partner when the partnerId belongs to a different project than the URL's project id", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare({ projectId: OTHER_PROJECT_ID }));

    const response = await GET(
      makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("forbidden");
  });
});

describe("PATCH /api/projects/[id]/partner-shares/[partnerId]", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await PATCH(
      makePatchRequest({ body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "", subPartnerVisibilityGrant: false } }),
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
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "", subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: "", subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: PARTNER_USER.email, subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: "nobody@x.test", subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: OWNER_USER.email, subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "", subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "", subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "", subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "", subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "", subPartnerVisibilityGrant: false },
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
        body: { name: "Partner A", sharePercent: "150", linkedUserEmail: "", subPartnerVisibilityGrant: false },
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

  it("returns 400 when subPartnerVisibilityGrant is missing entirely -- required field (Story 2.6)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "60", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_request");
    expect(createPartnerShare).not.toHaveBeenCalled();
  });

  it("toggles subPartnerVisibilityGrant on via edit -- 200, new versioned row with the grant on (Story 2.6)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare({ subPartnerVisibilityGrant: false }));
    createPartnerShare.mockResolvedValue(
      makeShare({ id: "row-2", subPartnerVisibilityGrant: true }),
    );

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: "", subPartnerVisibilityGrant: true },
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subPartnerVisibilityGrant).toBe(true);
    expect(createPartnerShare).toHaveBeenCalledWith(
      expect.objectContaining({ subPartnerVisibilityGrant: true }),
    );
  });

  it("toggles subPartnerVisibilityGrant back off via edit -- 200, new versioned row with the grant off", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makeShare({ subPartnerVisibilityGrant: true }));
    createPartnerShare.mockResolvedValue(
      makeShare({ id: "row-2", subPartnerVisibilityGrant: false }),
    );

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Partner A", sharePercent: "50", linkedUserEmail: "", subPartnerVisibilityGrant: false },
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subPartnerVisibilityGrant).toBe(false);
  });
});

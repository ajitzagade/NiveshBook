import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findUserByEmail = vi.fn();
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
    findUserByEmail,
    findUserById,
    listAllUsers: vi.fn(),
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
const OTHER_PARTNER_ID = "0192f5a0-8888-7000-8000-000000000008";
const SUBPARTNER_ID = "0192f5a0-9999-7000-8000-000000000009";
const UNKNOWN_SUBPARTNER_ID = "0192f5a0-aaaa-7000-8000-00000000000a";

function makePatchRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/partner-shares/${PARTNER_ID}/subpartner-shares/${SUBPARTNER_ID}`,
    {
      method: "PATCH",
      headers,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
}

function makeGetRequest(options: {
  cookie?: string;
  subPartnerId?: string;
  partnerId?: string;
  projectId?: string;
}): NextRequest {
  const {
    cookie,
    subPartnerId = SUBPARTNER_ID,
    partnerId = PARTNER_ID,
    projectId = PROJECT_ID,
  } = options;
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/partner-shares/${partnerId}/subpartner-shares/${subPartnerId}`,
    { method: "GET", headers },
  );
}

function makeContext(
  subPartnerId: string = SUBPARTNER_ID,
  partnerId: string = PARTNER_ID,
  id: string = PROJECT_ID,
) {
  return { params: Promise.resolve({ id, partnerId, subPartnerId }) };
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

const SUB_PARTNER_USER = {
  id: "sub-partner-user-1",
  email: "subpartner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "sub_partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const SUB_PARTNER_USER_2 = {
  id: "sub-partner-user-2",
  email: "subpartner2@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "sub_partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

function makePartnerShare(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "partner-row-1",
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

function makeSubShare(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    subPartnerId: SUBPARTNER_ID,
    partnerId: PARTNER_ID,
    projectId: PROJECT_ID,
    name: "Sub1",
    sharePercent: "12.5",
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
  findLatestByPartnerId.mockReset();
  findLatestByPartnerId.mockResolvedValue(makePartnerShare());
  createSubPartnerShare.mockReset();
  findLatestBySubPartnerId.mockReset();
  listByPartnerId.mockReset();
}

describe("GET .../subpartner-shares/[subPartnerId] (Story 2.5)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest({}), makeContext());

    expect(response.status).toBe(401);
  });

  it("Sub-partner views their own Share -- 200, their own row only", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    const own = makeSubShare({ userId: SUB_PARTNER_USER.id });
    findLatestBySubPartnerId.mockResolvedValue(own);

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(own);
  });

  it("Sub-partner reaches a different Sub-partner's Share (same Partner) -- 403, no data", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(
      makeSubShare({ userId: SUB_PARTNER_USER_2.id }),
    );

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("Sub-partner reaches a Sub-partner under a different Partner -- 403, no data", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(makePartnerShare({ partnerId: OTHER_PARTNER_ID }));
    findLatestBySubPartnerId.mockResolvedValue(
      makeSubShare({ partnerId: OTHER_PARTNER_ID, userId: SUB_PARTNER_USER_2.id }),
    );

    const response = await GET(
      makeGetRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        partnerId: OTHER_PARTNER_ID,
      }),
      makeContext(SUBPARTNER_ID, OTHER_PARTNER_ID),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("Owner/Admin views any Sub-partner's Share -- 200, full data, unconditional", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    const share = makeSubShare({ userId: SUB_PARTNER_USER.id });
    findLatestBySubPartnerId.mockResolvedValue(share);

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(share);
  });

  it("Parent Partner attempts single-detail view -- 403, list access only, not single-detail", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: PARTNER_USER.id });
    findUserById.mockResolvedValue(PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(makePartnerShare({ userId: PARTNER_USER.id }));
    findLatestBySubPartnerId.mockResolvedValue(makeSubShare({ userId: SUB_PARTNER_USER.id }));

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("Sub-partner probes a nonexistent subPartnerId -- 403, not 404, no existence oracle", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(null);

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(UNKNOWN_SUBPARTNER_ID),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("Sub-partner probes a malformed subPartnerId -- 403, not 404, same uniform response", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(403);
    expect(findLatestBySubPartnerId).not.toHaveBeenCalled();
  });

  it("Sub-partner probes a malformed partnerId -- 403, not 404", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(SUBPARTNER_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(403);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });

  it("Sub-partner probes a malformed project id -- 403, not 404", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(SUBPARTNER_ID, PARTNER_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(403);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });

  it("Sub-partner probes a partnerId that belongs to a different project than the URL's -- 403, not 404 (resolution-failure branch, not the ownership-denial branch)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestByPartnerId.mockResolvedValue(makePartnerShare({ projectId: OTHER_PROJECT_ID }));

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(SUBPARTNER_ID, PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(findLatestBySubPartnerId).not.toHaveBeenCalled();
  });

  it("Owner/Admin requests a partnerId that belongs to a different project than the URL's -- 404 (existing granular precedent, unchanged)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makePartnerShare({ projectId: OTHER_PROJECT_ID }));

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(SUBPARTNER_ID, PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(findLatestBySubPartnerId).not.toHaveBeenCalled();
  });

  it("Sub-partner probes a subPartnerId that belongs to a different partnerId than the URL's -- 403, not 404 (resolution-failure branch, not the ownership-denial branch)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(makeSubShare({ partnerId: OTHER_PARTNER_ID }));

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(SUBPARTNER_ID, PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
  });

  it("Owner/Admin requests a subPartnerId that belongs to a different partnerId than the URL's -- 404 (existing granular precedent, unchanged)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(makeSubShare({ partnerId: OTHER_PARTNER_ID }));

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(SUBPARTNER_ID, PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("Owner/Admin requests a nonexistent id -- 404 (existing granular precedent, unchanged)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(null);

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext(UNKNOWN_SUBPARTNER_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
  });

  it("Owner/Admin requests a malformed id -- 404 (existing granular precedent, unchanged)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeGetRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token` }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
  });
});

describe("PATCH .../subpartner-shares/[subPartnerId]", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await PATCH(
      makePatchRequest({ body: { name: "Sub1", sharePercent: "20" } }),
      makeContext(),
    );

    expect(response.status).toBe(401);
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("Owner/Admin edits the share: 200, a new versioned row is created (new id/effectiveFrom, same subPartnerId) -- old row untouched", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    const existing = makeSubShare({ id: "row-1", sharePercent: "12.5" });
    findLatestBySubPartnerId.mockResolvedValue(existing);
    const newVersion = makeSubShare({ id: "row-2", sharePercent: "20" });
    createSubPartnerShare.mockResolvedValue(newVersion);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "20", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(newVersion);
    expect(createSubPartnerShare).toHaveBeenCalledWith(
      expect.objectContaining({
        subPartnerId: SUBPARTNER_ID,
        partnerId: PARTNER_ID,
        projectId: PROJECT_ID,
        sharePercent: "20",
        userId: null,
      }),
    );
  });

  it("unlinks an already-linked Sub-partner Share -- 200, new versioned row with userId null", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    const existing = makeSubShare({ id: "row-1", sharePercent: "12.5", userId: SUB_PARTNER_USER.id });
    findLatestBySubPartnerId.mockResolvedValue(existing);
    createSubPartnerShare.mockResolvedValue(
      makeSubShare({ id: "row-2", sharePercent: "12.5", userId: null }),
    );

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "12.5", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.userId).toBeNull();
  });

  it("links a Sub-partner Share to a user via email on edit -- 200, userId set", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(SUB_PARTNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(makeSubShare({ id: "row-1" }));
    createSubPartnerShare.mockResolvedValue(
      makeSubShare({ id: "row-2", userId: SUB_PARTNER_USER.id }),
    );

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "12.5", linkedUserEmail: SUB_PARTNER_USER.email },
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.userId).toBe(SUB_PARTNER_USER.id);
  });

  it("blocks a linkedUserEmail that resolves to a non-sub_partner role on edit -- 400 validation_error, no new version created", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(PARTNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(makeSubShare());

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "12.5", linkedUserEmail: PARTNER_USER.email },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent subPartnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(null);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "20", linkedUserEmail: "" },
      }),
      makeContext(UNKNOWN_SUBPARTNER_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 (not 400) for a malformed, non-UUID subPartnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "20", linkedUserEmail: "" },
      }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findLatestBySubPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 (not 400) for a malformed, non-UUID partnerId", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "20", linkedUserEmail: "" },
      }),
      makeContext(SUBPARTNER_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
    expect(findLatestBySubPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 (not 400) for a malformed, non-UUID project id in the URL", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "20", linkedUserEmail: "" },
      }),
      makeContext(SUBPARTNER_ID, PARTNER_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findLatestByPartnerId).not.toHaveBeenCalled();
    expect(findLatestBySubPartnerId).not.toHaveBeenCalled();
  });

  it("returns 404 when partnerId belongs to a different project than the URL's project id -- same class of bug as Story 2.2's cross-project PATCH fix", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makePartnerShare({ projectId: OTHER_PROJECT_ID }));

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "20", linkedUserEmail: "" },
      }),
      makeContext(SUBPARTNER_ID, PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(findLatestBySubPartnerId).not.toHaveBeenCalled();
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 404 when subPartnerId belongs to a different partnerId than the URL's -- one level deeper than Story 2.2's cross-project bug", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestByPartnerId.mockResolvedValue(makePartnerShare());
    findLatestBySubPartnerId.mockResolvedValue(
      makeSubShare({ partnerId: OTHER_PARTNER_ID }),
    );

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "20", linkedUserEmail: "" },
      }),
      makeContext(SUBPARTNER_ID, PARTNER_ID, PROJECT_ID),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin -- no new version created", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "20", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(createSubPartnerShare).not.toHaveBeenCalled();
    expect(findLatestBySubPartnerId).not.toHaveBeenCalled();
  });

  it("returns 403, not 400, for a non-owner_admin sending a malformed body -- authorization checked before body shape", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { name: 12345 } }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("blocks an out-of-range share with a 400 validation_error -- no new version created", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findLatestBySubPartnerId.mockResolvedValue(makeSubShare());

    const response = await PATCH(
      makePatchRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { name: "Sub1", sharePercent: "150", linkedUserEmail: "" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await PATCH(
      makePatchRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(createSubPartnerShare).not.toHaveBeenCalled();
  });
});

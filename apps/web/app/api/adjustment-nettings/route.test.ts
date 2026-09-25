import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { AdjustmentNettingIdempotencyKeyConflictError } from "@niveshbook/core";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const investmentAdjustmentsListByProjectId = vi.fn();
const withdrawalAdjustmentsListByProjectId = vi.fn();
const recordNetting = vi.fn();

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
  createInvestmentAdjustmentPort: () => ({
    upsert: vi.fn(),
    listByProjectId: investmentAdjustmentsListByProjectId,
    listAll: vi.fn(),
  }),
  createWithdrawalAdjustmentPort: () => ({
    upsert: vi.fn(),
    listByProjectId: withdrawalAdjustmentsListByProjectId,
    listAll: vi.fn(),
  }),
  createAdjustmentNettingPort: () => ({
    recordNetting,
    listAll: vi.fn(),
  }),
}));

const PROJECT_ID = "project-a";
const REQUIREMENT_ID = "req-1";
const SHARE_ID = "partner-1";

function makeRequest(options: { cookie?: string; body?: unknown } = {}): NextRequest {
  const { cookie, body } = options;
  return new NextRequest("http://localhost/api/adjustment-nettings", {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: SHARE_ID,
    investmentRequirementId: REQUIREMENT_ID,
    amount: "50000",
    notes: "Agreed over call",
    idempotencyKey: "idem-1",
    ...overrides,
  };
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
  id: "partner-user-a",
  email: "partner-a@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const EXISTING_PROJECT = {
  id: PROJECT_ID,
  name: "Project A",
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const EXISTING_INVESTMENT_ADJUSTMENT = {
  id: "ia-1",
  projectId: PROJECT_ID,
  partyType: "partner",
  shareId: SHARE_ID,
  requirementId: REQUIREMENT_ID,
  shouldPay: "200000",
  actualPaid: "0",
  adjustmentType: "pending",
  adjustmentAmount: "200000",
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const EXISTING_WITHDRAWAL_ADJUSTMENT = {
  id: "wa-1",
  projectId: PROJECT_ID,
  partyType: "partner",
  shareId: SHARE_ID,
  canTake: "150000",
  taken: "0",
  adjustmentType: "keep_for_later",
  adjustmentAmount: "150000",
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  investmentAdjustmentsListByProjectId.mockReset();
  withdrawalAdjustmentsListByProjectId.mockReset();
  recordNetting.mockReset();

  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  investmentAdjustmentsListByProjectId.mockResolvedValue([EXISTING_INVESTMENT_ADJUSTMENT]);
  withdrawalAdjustmentsListByProjectId.mockResolvedValue([EXISTING_WITHDRAWAL_ADJUSTMENT]);
}

function sessionFor(user: typeof OWNER_USER | typeof PARTNER_USER) {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: user.id });
  findUserById.mockResolvedValue(user);
}

describe("POST /api/adjustment-nettings (Story 5.3, FR33/FR34, AD-4)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie, before any data read", async () => {
    const response = await POST(makeRequest({ body: validBody() }));

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-Owner/Admin role (Partner), before any data read -- no self-access", async () => {
    sessionFor(PARTNER_USER);

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(findProjectById).not.toHaveBeenCalled();
    expect(recordNetting).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed body (missing shareId)", async () => {
    sessionFor(OWNER_USER);
    const body = validBody() as Record<string, unknown>;
    delete body.shareId;

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 validation_error for an invalid amount", async () => {
    sessionFor(OWNER_USER);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody({ amount: "not-a-number" }) }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 404 not_found when the project doesn't exist", async () => {
    sessionFor(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(404);
    expect(recordNetting).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when no matching investment_adjustments row exists for (partyType, shareId, investmentRequirementId)", async () => {
    sessionFor(OWNER_USER);
    investmentAdjustmentsListByProjectId.mockResolvedValue([]);

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(404);
    expect(recordNetting).not.toHaveBeenCalled();
  });

  // Review round 2 (verification-gap finding): the two `mockResolvedValue([])`
  // tests above only prove the route 404s on an EMPTY list -- neither
  // exercises the actual `.find()` predicate in `route.ts` that matches on
  // `partyType`/`shareId`/`investmentRequirementId` together. A bug like
  // "forgot to compare one of the three fields" would still pass an
  // empty-list test, since an empty array has nothing to wrongly match. These
  // three tests instead return a NON-empty list containing a row for a
  // DIFFERENT shareId/requirementId/partyType than the request body
  // specifies -- the only way to actually catch a dropped-field comparison
  // bug (an IDOR-style IDs-that-don't-belong-together check).
  it("returns 404 not_found when investment_adjustments has a row for a DIFFERENT shareId than the request body -- not just an empty list", async () => {
    sessionFor(OWNER_USER);
    investmentAdjustmentsListByProjectId.mockResolvedValue([
      { ...EXISTING_INVESTMENT_ADJUSTMENT, shareId: "some-other-share-id" },
    ]);

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(404);
    expect(recordNetting).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when investment_adjustments has a row for a DIFFERENT investmentRequirementId than the request body", async () => {
    sessionFor(OWNER_USER);
    investmentAdjustmentsListByProjectId.mockResolvedValue([
      { ...EXISTING_INVESTMENT_ADJUSTMENT, requirementId: "some-other-requirement-id" },
    ]);

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(404);
    expect(recordNetting).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when investment_adjustments has a row for a DIFFERENT partyType than the request body", async () => {
    sessionFor(OWNER_USER);
    investmentAdjustmentsListByProjectId.mockResolvedValue([
      { ...EXISTING_INVESTMENT_ADJUSTMENT, partyType: "sub_partner" },
    ]);

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(404);
    expect(recordNetting).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when no matching withdrawal_adjustments row exists for (partyType, shareId)", async () => {
    sessionFor(OWNER_USER);
    withdrawalAdjustmentsListByProjectId.mockResolvedValue([]);

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(404);
    expect(recordNetting).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when withdrawal_adjustments has a row for a DIFFERENT shareId than the request body -- not just an empty list", async () => {
    sessionFor(OWNER_USER);
    withdrawalAdjustmentsListByProjectId.mockResolvedValue([
      { ...EXISTING_WITHDRAWAL_ADJUSTMENT, shareId: "some-other-share-id" },
    ]);

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(404);
    expect(recordNetting).not.toHaveBeenCalled();
  });

  it("calls recordNetting with the validated input and returns 201 on genuine create", async () => {
    sessionFor(OWNER_USER);
    const netting = {
      id: "netting-1",
      projectId: PROJECT_ID,
      partyType: "partner",
      shareId: SHARE_ID,
      investmentRequirementId: REQUIREMENT_ID,
      amount: "50000.00",
      notes: "Agreed over call",
      actorUserId: OWNER_USER.id,
      createdAt: new Date().toISOString(),
    };
    recordNetting.mockResolvedValue({ netting, created: true });

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.netting).toEqual(netting);
    expect(recordNetting).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        partyType: "partner",
        shareId: SHARE_ID,
        investmentRequirementId: REQUIREMENT_ID,
        amount: "50000",
        notes: "Agreed over call",
      }),
      "idem-1",
      OWNER_USER.id,
    );
  });

  it("returns 200 (not 201) on an idempotent replay -- created: false", async () => {
    sessionFor(OWNER_USER);
    recordNetting.mockResolvedValue({
      netting: { id: "netting-1", projectId: PROJECT_ID },
      created: false,
    });

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(200);
  });

  it("maps AdjustmentNettingIdempotencyKeyConflictError to 409 idempotency_key_conflict", async () => {
    sessionFor(OWNER_USER);
    recordNetting.mockRejectedValue(new AdjustmentNettingIdempotencyKeyConflictError());

    const response = await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody() }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });

  it("notes: null/omitted is passed through as null, not an empty string", async () => {
    sessionFor(OWNER_USER);
    recordNetting.mockResolvedValue({ netting: { id: "netting-1" }, created: true });

    await POST(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: validBody({ notes: "   " }) }));

    expect(recordNetting).toHaveBeenCalledWith(
      expect.objectContaining({ notes: null }),
      expect.any(String),
      expect.any(String),
    );
  });
});

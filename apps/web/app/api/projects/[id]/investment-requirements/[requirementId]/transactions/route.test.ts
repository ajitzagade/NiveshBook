import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { IdempotencyKeyConflictError } from "@niveshbook/core";
import { GET, POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const recordTransaction = vi.fn();
const listByRequirementId = vi.fn();

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
    findLatestByPartnerId: vi.fn(),
    listByProjectId: listPartnerSharesByProjectId,
    listAll: vi.fn(),
  }),
  createSubPartnerSharePort: () => ({
    createSubPartnerShare: vi.fn(),
    findLatestBySubPartnerId: vi.fn(),
    listByPartnerId: vi.fn(),
    listByProjectId: listSubPartnerSharesByProjectId,
  }),
  createInvestmentRequirementPort: () => ({
    createInvestmentRequirement: vi.fn(),
    listByProjectId: vi.fn(),
    findById,
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction,
    listByRequirementId,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const REQUIREMENT_ID = "0192f5a0-6666-7000-8000-000000000006";

function makeRequest(
  options: { cookie?: string; method?: string; body?: unknown; requirementId?: string } = {},
): NextRequest {
  const { cookie, method = "GET", body, requirementId = REQUIREMENT_ID } = options;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${requirementId}/transactions`,
    {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
}

function makeContext(id: string = PROJECT_ID, requirementId: string = REQUIREMENT_ID) {
  return { params: Promise.resolve({ id, requirementId }) };
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

const PARTNER_A_USER = {
  id: "partner-user-a",
  email: "partner-a@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const PARTNER_B_USER = {
  id: "partner-user-b",
  email: "partner-b@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const SUB_PARTNER_USER = {
  id: "sub-partner-user-1",
  email: "sub-1@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "sub_partner" as const,
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

const EXISTING_REQUIREMENT = {
  id: REQUIREMENT_ID,
  projectId: PROJECT_ID,
  amount: "1000000",
  requirementDate: "2026-10-01",
  createdAt: new Date().toISOString(),
};

function makePartnerShareRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "share-row-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
    name: "A",
    sharePercent: "50",
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeSubPartnerShareRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "sub-row-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
    name: "Sub1",
    sharePercent: "12.5",
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeTransactionBody(overrides: Record<string, unknown> = {}) {
  return {
    partyType: "partner",
    shareId: "a",
    amount: "700000",
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: "REF-1",
    notes: null,
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

const SAVED_TRANSACTION = {
  id: "tx-1",
  requirementId: REQUIREMENT_ID,
  projectId: PROJECT_ID,
  partyType: "partner",
  shareId: "a",
  sharePercentSnapshot: "50",
  shouldPaySnapshot: "500000",
  amount: "700000",
  transactionDate: "2026-10-05",
  paymentMode: "neft",
  referenceNumber: "REF-1",
  notes: null,
  createdAt: new Date().toISOString(),
};

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  findById.mockReset();
  findById.mockResolvedValue(EXISTING_REQUIREMENT);
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "30", userId: "partner-user-b" }),
    makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "20", userId: null }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([
    makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", userId: "sub-partner-user-1" }),
  ]);
  recordTransaction.mockReset();
  recordTransaction.mockResolvedValue({ transaction: SAVED_TRANSACTION, created: true });
  listByRequirementId.mockReset();
  listByRequirementId.mockResolvedValue([SAVED_TRANSACTION]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("POST .../investment-requirements/[requirementId]/transactions", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makeRequest({ method: "POST", body: makeTransactionBody() }), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project, before the requirement/shares/authorize steps", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeTransactionBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeTransactionBody() }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent requirement", async () => {
    ownerSession();
    findById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeTransactionBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 when the requirement belongs to a different project (cross-project mismatch)", async () => {
    ownerSession();
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, projectId: OTHER_PROJECT_ID });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeTransactionBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed JSON body", async () => {
    ownerSession();
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions`,
      {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=t`, "Content-Type": "application/json" },
        body: "{not-json",
      },
    );

    const response = await POST(request, makeContext());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when partyType is neither 'partner' nor 'sub_partner'", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ partyType: "owner" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 404 when shareId/partyType doesn't match any current share, before authorize() runs", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ shareId: "nonexistent" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it("returns 201 when an Owner/Admin records a payment on a Partner's behalf (AC: Partner A, Should Pay 5,00,000, amount 7,00,000)", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeTransactionBody() }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual(SAVED_TRANSACTION);
    expect(recordTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        requirementId: REQUIREMENT_ID,
        projectId: PROJECT_ID,
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "700000",
        actorUserId: "owner-1",
      }),
    );
  });

  it("returns 201 for a Partner recording their own payment (self-access)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeTransactionBody() }),
      makeContext(),
    );

    expect(response.status).toBe(201);
  });

  it("returns 201 for a Sub-partner recording their own payment (self-access)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ partyType: "sub_partner", shareId: "sub-1" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
  });

  it("returns 403 when a Partner attempts to record another Partner's payment", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-b" });
    findUserById.mockResolvedValue(PARTNER_B_USER);

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ partyType: "partner", shareId: "a" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it("returns 201 when amount is '0' -- no minimum payment enforced (AC2)", async () => {
    ownerSession();
    recordTransaction.mockResolvedValue({
      transaction: { ...SAVED_TRANSACTION, amount: "0" },
      created: true,
    });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ amount: "0" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    expect((await response.json()).amount).toBe("0");
  });

  it("returns 400 validation_error for a negative amount", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ amount: "-500" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for an unrecognized paymentMode", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ paymentMode: "bitcoin" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 400 validation_error when idempotencyKey is missing", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ idempotencyKey: "" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 409 shares_not_fully_allocated when Partner Shares don't total 100% at write time", async () => {
    ownerSession();
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "40", userId: "partner-user-b" }),
    ]);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeTransactionBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("shares_not_fully_allocated");
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it("returns 200 (not 201) for a repeated POST with the same idempotencyKey -- idempotent replay, exactly one row created", async () => {
    ownerSession();
    recordTransaction.mockResolvedValue({ transaction: SAVED_TRANSACTION, created: false });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeTransactionBody({ idempotencyKey: "idem-1" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAVED_TRANSACTION);
  });

  it("returns 409 idempotency_key_conflict when the port detects a genuine key collision between unrelated requests", async () => {
    ownerSession();
    recordTransaction.mockRejectedValue(new IdempotencyKeyConflictError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeTransactionBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });
});

describe("GET .../investment-requirements/[requirementId]/transactions", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-owner_admin, checked before any DB read", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(403);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent requirement", async () => {
    ownerSession();
    findById.mockResolvedValue(null);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(listByRequirementId).not.toHaveBeenCalled();
  });

  it("returns 404 when the requirement belongs to a different project", async () => {
    ownerSession();
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, projectId: OTHER_PROJECT_ID });

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(listByRequirementId).not.toHaveBeenCalled();
  });

  it("returns 200 with the transaction list for an owner_admin", async () => {
    ownerSession();

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactions: [SAVED_TRANSACTION] });
  });
});

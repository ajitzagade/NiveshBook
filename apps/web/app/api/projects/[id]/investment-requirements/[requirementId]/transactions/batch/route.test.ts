import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  IdempotencyKeyConflictError,
  InvalidTransactionAmountError,
  SharesNotFullyAllocatedError,
} from "@niveshbook/core";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const recordTransactionBatch = vi.fn();

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
    recordTransaction: vi.fn(),
    recordTransactionBatch,
    listByRequirementId: vi.fn(),
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const REQUIREMENT_ID = "0192f5a0-6666-7000-8000-000000000006";

function makeRequest(options: { cookie?: string; body?: unknown; requirementId?: string } = {}): NextRequest {
  const { cookie, body, requirementId = REQUIREMENT_ID } = options;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${requirementId}/transactions/batch`,
    {
      method: "POST",
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

const PARTNER_B_USER = {
  id: "partner-user-b",
  email: "partner-b@niveshbook.test",
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

function makeBatchBody(overrides: Record<string, unknown> = {}) {
  return {
    partyType: "partner",
    shareId: "a",
    transactionDate: "2026-10-05",
    rows: [
      { amount: "500000", paymentMode: "cash", referenceNumber: null, notes: null },
      { amount: "200000", paymentMode: "rtgs", referenceNumber: "UTR-1", notes: null },
    ],
    idempotencyKey: "batch-idem-1",
    ...overrides,
  };
}

const SAVED_TRANSACTIONS = [
  {
    id: "tx-1",
    requirementId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50",
    shouldPaySnapshot: "500000",
    amount: "500000",
    transactionDate: "2026-10-05",
    paymentMode: "cash",
    referenceNumber: null,
    notes: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tx-2",
    requirementId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50",
    shouldPaySnapshot: "500000",
    amount: "200000",
    transactionDate: "2026-10-05",
    paymentMode: "rtgs",
    referenceNumber: "UTR-1",
    notes: null,
    createdAt: new Date().toISOString(),
  },
];

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
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: null }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "50", userId: "partner-user-b" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  recordTransactionBatch.mockReset();
  recordTransactionBatch.mockResolvedValue({ transactions: SAVED_TRANSACTIONS, created: true });
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("POST .../investment-requirements/[requirementId]/transactions/batch", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makeRequest({ body: makeBatchBody() }), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when the requirement belongs to a different project", async () => {
    ownerSession();
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, projectId: "some-other-project" });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 invalid_request for a malformed JSON body", async () => {
    ownerSession();
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions/batch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE_NAME}=t` },
        body: "{not valid json",
      },
    );

    const response = await POST(request, makeContext());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 invalid_request when rows is an empty array", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody({ rows: [] }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
    expect(recordTransactionBatch).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when a row is missing its amount", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: makeBatchBody({ rows: [{ paymentMode: "cash", referenceNumber: null, notes: null }] }),
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
        body: makeBatchBody({ shareId: "does-not-exist" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(recordTransactionBatch).not.toHaveBeenCalled();
  });

  it("returns 403 when a Partner attempts to record another Partner's split payment", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-b" });
    findUserById.mockResolvedValue(PARTNER_B_USER);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody({ shareId: "a" }) }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(recordTransactionBatch).not.toHaveBeenCalled();
  });

  it("returns 201 with every row when an Owner/Admin records a split payment on a Partner's behalf", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.transactions).toEqual(SAVED_TRANSACTIONS);
    expect(recordTransactionBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        requirementId: REQUIREMENT_ID,
        projectId: PROJECT_ID,
        partyType: "partner",
        shareId: "a",
        rows: [
          { amount: "500000", paymentMode: "cash", referenceNumber: null, notes: null },
          { amount: "200000", paymentMode: "rtgs", referenceNumber: "UTR-1", notes: null },
        ],
        idempotencyKey: "batch-idem-1",
        actorUserId: "owner-1",
      }),
    );
  });

  it("returns 200 (not 201) for a repeated POST with the same idempotencyKey -- idempotent replay", async () => {
    ownerSession();
    recordTransactionBatch.mockResolvedValue({ transactions: SAVED_TRANSACTIONS, created: false });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext(),
    );

    expect(response.status).toBe(200);
  });

  it("returns 409 idempotency_key_conflict when the port detects a genuine batch key collision", async () => {
    ownerSession();
    recordTransactionBatch.mockRejectedValue(new IdempotencyKeyConflictError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });

  it("returns 400 validation_error when packages/core rejects a row (e.g. a negative amount) via InvalidTransactionAmountError", async () => {
    ownerSession();
    recordTransactionBatch.mockRejectedValue(new InvalidTransactionAmountError());

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: makeBatchBody({
          rows: [{ amount: "-500", paymentMode: "cash", referenceNumber: null, notes: null }],
        }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 409 shares_not_fully_allocated when Partner Shares don't total 100% at write time", async () => {
    ownerSession();
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: null }),
    ]);
    recordTransactionBatch.mockRejectedValue(new SharesNotFullyAllocatedError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("shares_not_fully_allocated");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { AlreadyCancelledError, IdempotencyKeyConflictError } from "@niveshbook/core";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findRequirementById = vi.fn();
const findTransactionById = vi.fn();
const cancelTransaction = vi.fn();

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
    createInvestmentRequirement: vi.fn(),
    listByProjectId: vi.fn(),
    findById: findRequirementById,
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: vi.fn(),
    findById: findTransactionById,
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    cancelTransaction,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const REQUIREMENT_ID = "0192f5a0-6666-7000-8000-000000000006";
const OTHER_REQUIREMENT_ID = "0192f5a0-7777-7000-8000-000000000007";
const TRANSACTION_ID = "0192f5a0-8888-7000-8000-000000000008";

function makeRequest(
  options: { cookie?: string; body?: unknown; transactionId?: string } = {},
): NextRequest {
  const { cookie, body, transactionId = TRANSACTION_ID } = options;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions/${transactionId}/cancel`,
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

function makeContext(
  id: string = PROJECT_ID,
  requirementId: string = REQUIREMENT_ID,
  transactionId: string = TRANSACTION_ID,
) {
  return { params: Promise.resolve({ id, requirementId, transactionId }) };
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

const EXISTING_TRANSACTION = {
  id: TRANSACTION_ID,
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
  status: "active",
  reversalOfTransactionId: null,
  createdAt: new Date().toISOString(),
};

const CANCELLED_ORIGINAL = { ...EXISTING_TRANSACTION, status: "cancelled" };
const REVERSAL_TRANSACTION = {
  ...EXISTING_TRANSACTION,
  id: "0192f5a0-9999-7000-8000-000000000009",
  status: "cancelled",
  reversalOfTransactionId: TRANSACTION_ID,
};

function makeCancelBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "cancel-idem-1",
    reason: "recorded by mistake",
    ...overrides,
  };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  findRequirementById.mockReset();
  findRequirementById.mockResolvedValue(EXISTING_REQUIREMENT);
  findTransactionById.mockReset();
  findTransactionById.mockResolvedValue(EXISTING_TRANSACTION);
  cancelTransaction.mockReset();
  cancelTransaction.mockResolvedValue({
    originalTransaction: CANCELLED_ORIGINAL,
    reversalTransaction: REVERSAL_TRANSACTION,
    cancelled: true,
  });
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("POST .../transactions/[transactionId]/cancel", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makeRequest({ body: makeCancelBody() }), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project, before requirement/transaction/authorize steps", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(findRequirementById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent requirement", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 when the requirement belongs to a different project (cross-project mismatch)", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue({ ...EXISTING_REQUIREMENT, projectId: OTHER_PROJECT_ID });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed transaction id", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(PROJECT_ID, REQUIREMENT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent transaction", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(cancelTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the transaction belongs to a different requirement (cross-requirement mismatch)", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue({ ...EXISTING_TRANSACTION, requirementId: OTHER_REQUIREMENT_ID });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(cancelTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the transaction belongs to a different project", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue({ ...EXISTING_TRANSACTION, projectId: OTHER_PROJECT_ID });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(cancelTransaction).not.toHaveBeenCalled();
  });

  it("returns 403 for a Partner/Sub-partner attempting to cancel -- Owner/Admin-only, no self-access, checked before body parsing (a malformed JSON body still yields 403, not 400)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions/${TRANSACTION_ID}/cancel`,
      {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=t`, "Content-Type": "application/json" },
        body: "{not-json",
      },
    );

    const response = await POST(request, makeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(cancelTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed JSON body (owner/admin, after authorize)", async () => {
    ownerSession();
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions/${TRANSACTION_ID}/cancel`,
      {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=t`, "Content-Type": "application/json" },
        body: "{not-json",
      },
    );

    const response = await POST(request, makeContext());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
    expect(cancelTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a structurally malformed body (idempotencyKey not a string)", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody({ idempotencyKey: 123 }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 200 with both the original (status: cancelled) and the reversal transaction for a valid Owner/Admin cancel", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.originalTransaction).toEqual(CANCELLED_ORIGINAL);
    expect(body.reversalTransaction).toEqual(REVERSAL_TRANSACTION);
    expect(cancelTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: TRANSACTION_ID,
        idempotencyKey: "cancel-idem-1",
        reason: "recorded by mistake",
        actorUserId: "owner-1",
      }),
    );
  });

  it("returns 400 validation_error when idempotencyKey is missing/blank", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody({ idempotencyKey: "   " }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("accepts a body with no reason (defaults to null)", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: { idempotencyKey: "cancel-idem-1" } }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(cancelTransaction).toHaveBeenCalledWith(expect.objectContaining({ reason: null }));
  });

  /**
   * Mirrors the PATCH route's identical real-idempotent-replay test one
   * level over -- issues TWO real `POST` requests with the SAME
   * `idempotencyKey` against a port mock that tracks applied cancels by key
   * itself, proving the route correctly threads a genuine replay through
   * (exactly one reversal row across two identical requests, per this
   * story's I/O matrix).
   */
  it("threads a real idempotent-replay scenario through two POST requests -- exactly one reversal row across two identical requests", async () => {
    ownerSession();
    let appliedCount = 0;
    const appliedKeys = new Set<string>();
    cancelTransaction.mockImplementation(async (input: { idempotencyKey: string }) => {
      if (appliedKeys.has(input.idempotencyKey)) {
        return {
          originalTransaction: CANCELLED_ORIGINAL,
          reversalTransaction: REVERSAL_TRANSACTION,
          cancelled: false,
        };
      }
      appliedCount += 1;
      appliedKeys.add(input.idempotencyKey);
      return {
        originalTransaction: CANCELLED_ORIGINAL,
        reversalTransaction: REVERSAL_TRANSACTION,
        cancelled: true,
      };
    });
    const body = makeCancelBody({ idempotencyKey: "route-replay-1" });

    const firstResponse = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body }),
      makeContext(),
    );
    const secondResponse = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body }),
      makeContext(),
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual(await secondResponse.json());
    expect(cancelTransaction).toHaveBeenCalledTimes(2);
    expect(appliedCount).toBe(1);
  });

  it("returns 409 already_cancelled when cancelling an already-cancelled transaction with a genuinely different idempotencyKey, no second reversal row", async () => {
    ownerSession();
    cancelTransaction.mockRejectedValue(new AlreadyCancelledError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_cancelled");
  });

  it("returns 409 idempotency_key_conflict when the port detects a genuine key collision between unrelated cancel requests", async () => {
    ownerSession();
    cancelTransaction.mockRejectedValue(new IdempotencyKeyConflictError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });
});

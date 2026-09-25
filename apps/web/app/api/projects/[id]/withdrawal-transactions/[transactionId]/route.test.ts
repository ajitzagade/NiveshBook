import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  WithdrawalAlreadyCancelledError,
  WithdrawalAmountLockedByAllocationError,
  WithdrawalIdempotencyKeyConflictError,
} from "@niveshbook/core";
import { PATCH } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findTransactionById = vi.fn();
const editTransaction = vi.fn();
const listByWithdrawalTransactionId = vi.fn();

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
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    findById: findTransactionById,
    editTransaction,
    cancelTransaction: vi.fn(),
  }),
  createWithdrawalDestinationAllocationPort: () => ({
    recordAllocation: vi.fn(),
    listByWithdrawalTransactionId,
    hasConflictingAllocation: vi.fn(),
    findById: vi.fn(),
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const TRANSACTION_ID = "0192f5a0-8888-7000-8000-000000000008";

function makeRequest(options: { cookie?: string; body?: unknown; transactionId?: string } = {}): NextRequest {
  const { cookie, body, transactionId = TRANSACTION_ID } = options;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/${transactionId}`,
    {
      method: "PATCH",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
}

function makeContext(id: string = PROJECT_ID, transactionId: string = TRANSACTION_ID) {
  return { params: Promise.resolve({ id, transactionId }) };
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

const EXISTING_TRANSACTION = {
  id: TRANSACTION_ID,
  projectId: PROJECT_ID,
  partyType: "partner",
  shareId: "a",
  sharePercentSnapshot: "50",
  canTakeSnapshot: "500000",
  amount: "250000",
  transactionDate: "2026-10-05",
  paymentMode: "neft",
  referenceNumber: "REF-1",
  notes: null,
  status: "active",
  reversalOfTransactionId: null,
  createdAt: new Date().toISOString(),
};

const CANCELLED_TRANSACTION = { ...EXISTING_TRANSACTION, status: "cancelled" };

function makeEditBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: "300000",
    transactionDate: "2026-10-06",
    paymentMode: "upi",
    referenceNumber: "REF-2",
    notes: "corrected",
    idempotencyKey: "edit-idem-1",
    reason: "typo'd the original amount",
    ...overrides,
  };
}

const EDITED_TRANSACTION = {
  ...EXISTING_TRANSACTION,
  amount: "300000",
  transactionDate: "2026-10-06",
  paymentMode: "upi",
  referenceNumber: "REF-2",
  notes: "corrected",
};

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  findTransactionById.mockReset();
  findTransactionById.mockResolvedValue(EXISTING_TRANSACTION);
  editTransaction.mockReset();
  editTransaction.mockResolvedValue({ transaction: EDITED_TRANSACTION, edited: true });
  listByWithdrawalTransactionId.mockReset();
  listByWithdrawalTransactionId.mockResolvedValue([]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("PATCH .../withdrawal-transactions/[transactionId]", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await PATCH(makeRequest({ body: makeEditBody() }), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project, before withdrawal/authorize steps", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed transaction id", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(PROJECT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent withdrawal", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the withdrawal belongs to a different project", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue({ ...EXISTING_TRANSACTION, projectId: OTHER_PROJECT_ID });

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("returns 403 for a Partner/Sub-partner attempting to edit -- Owner/Admin-only, no self-access, checked before body parsing", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/${TRANSACTION_ID}`,
      {
        method: "PATCH",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=t`, "Content-Type": "application/json" },
        body: "{not-json",
      },
    );

    const response = await PATCH(request, makeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed JSON body (owner/admin, after authorize)", async () => {
    ownerSession();
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/${TRANSACTION_ID}`,
      {
        method: "PATCH",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=t`, "Content-Type": "application/json" },
        body: "{not-json",
      },
    );

    const response = await PATCH(request, makeContext());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a structurally malformed body", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody({ amount: 300000 }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 200 with the updated withdrawal for a valid Owner/Admin edit", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(EDITED_TRANSACTION);
    expect(editTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: TRANSACTION_ID,
        amount: "300000",
        transactionDate: "2026-10-06",
        paymentMode: "upi",
        referenceNumber: "REF-2",
        notes: "corrected",
        idempotencyKey: "edit-idem-1",
        reason: "typo'd the original amount",
        actorUserId: "owner-1",
      }),
    );
  });

  it("a repeated PATCH with the same idempotencyKey still returns 200 (never 409/201)", async () => {
    ownerSession();
    editTransaction.mockResolvedValue({ transaction: EDITED_TRANSACTION, edited: false });

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EDITED_TRANSACTION);
  });

  it("returns 400 validation_error for an invalid amount", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody({ amount: "not-a-number" }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("maps WithdrawalIdempotencyKeyConflictError to 409 idempotency_key_conflict", async () => {
    ownerSession();
    editTransaction.mockRejectedValue(new WithdrawalIdempotencyKeyConflictError());

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });

  it("maps WithdrawalAmountLockedByAllocationError to 409 amount_locked_by_allocation (this story's Decisions #5)", async () => {
    ownerSession();
    editTransaction.mockRejectedValue(new WithdrawalAmountLockedByAllocationError());

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("amount_locked_by_allocation");
  });

  it("maps WithdrawalAlreadyCancelledError to 409 already_cancelled -- driven end-to-end via findById returning a cancelled row", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue(CANCELLED_TRANSACTION);
    editTransaction.mockRejectedValue(new WithdrawalAlreadyCancelledError());

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_cancelled");
  });

  it("never sends sharePercentSnapshot/canTakeSnapshot/projectId/partyType/shareId to the domain layer", async () => {
    ownerSession();

    await PATCH(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }), makeContext());

    const call = editTransaction.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty("sharePercentSnapshot");
    expect(call).not.toHaveProperty("canTakeSnapshot");
    expect(call).not.toHaveProperty("projectId");
    expect(call).not.toHaveProperty("partyType");
    expect(call).not.toHaveProperty("shareId");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  AlreadyCancelledError,
  InsufficientAvailableBalanceError,
  WithdrawalAlreadyCancelledError,
  WithdrawalIdempotencyKeyConflictError,
} from "@niveshbook/core";
import type { Money } from "@niveshbook/types";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
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
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    findById: findTransactionById,
    editTransaction: vi.fn(),
    cancelTransaction,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const TRANSACTION_ID = "0192f5a0-8888-7000-8000-000000000008";

function makeRequest(options: { cookie?: string; body?: unknown; transactionId?: string } = {}): NextRequest {
  const { cookie, body, transactionId = TRANSACTION_ID } = options;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/${transactionId}/cancel`,
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

const CANCELLED_ORIGINAL = { ...EXISTING_TRANSACTION, status: "cancelled" };
const REVERSAL_TRANSACTION = {
  ...EXISTING_TRANSACTION,
  id: "0192f5a0-9999-7000-8000-000000000009",
  status: "cancelled",
  reversalOfTransactionId: TRANSACTION_ID,
};

function makeCancelBody(overrides: Record<string, unknown> = {}) {
  return { idempotencyKey: "cancel-idem-1", reason: "recorded by mistake", ...overrides };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
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

describe("POST .../withdrawal-transactions/[transactionId]/cancel", () => {
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
  });

  it("returns 404 for a nonexistent project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

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
      makeContext(PROJECT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent withdrawal", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(cancelTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the withdrawal belongs to a different project", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue({ ...EXISTING_TRANSACTION, projectId: OTHER_PROJECT_ID });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(cancelTransaction).not.toHaveBeenCalled();
  });

  it("returns 403 for a Partner/Sub-partner attempting to cancel -- Owner/Admin-only, no self-access, checked before body parsing", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/${TRANSACTION_ID}/cancel`,
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
      `http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/${TRANSACTION_ID}/cancel`,
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

  it("returns 400 invalid_request for a structurally malformed body (missing idempotencyKey)", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: { reason: null } }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 200 with the original+reversal withdrawals for a valid Owner/Admin cancel", async () => {
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

  it("a repeated POST with the same idempotencyKey still returns 200 (never 409/201)", async () => {
    ownerSession();
    cancelTransaction.mockResolvedValue({
      originalTransaction: CANCELLED_ORIGINAL,
      reversalTransaction: REVERSAL_TRANSACTION,
      cancelled: false,
    });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(200);
  });

  it("maps WithdrawalAlreadyCancelledError to 409 already_cancelled", async () => {
    ownerSession();
    cancelTransaction.mockRejectedValue(new WithdrawalAlreadyCancelledError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_cancelled");
  });

  it("maps the investment-side AlreadyCancelledError (propagated from the cascade) to 409 already_cancelled too", async () => {
    ownerSession();
    cancelTransaction.mockRejectedValue(new AlreadyCancelledError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_cancelled");
  });

  it("maps InsufficientAvailableBalanceError to 409 insufficient_balance_to_reverse (this story's Decisions #2 -- the trickiest, most important case)", async () => {
    ownerSession();
    cancelTransaction.mockRejectedValue(
      new InsufficientAvailableBalanceError("100000" as Money, "250000" as Money),
    );

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("insufficient_balance_to_reverse");
  });

  it("maps WithdrawalIdempotencyKeyConflictError to 409 idempotency_key_conflict", async () => {
    ownerSession();
    cancelTransaction.mockRejectedValue(new WithdrawalIdempotencyKeyConflictError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeCancelBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });
});

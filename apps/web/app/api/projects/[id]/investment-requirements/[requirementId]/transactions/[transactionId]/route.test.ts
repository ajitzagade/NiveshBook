import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { AlreadyCancelledError, IdempotencyKeyConflictError } from "@niveshbook/core";
import { PATCH } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findRequirementById = vi.fn();
const findTransactionById = vi.fn();
const editTransaction = vi.fn();

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
    editTransaction,
    findAuditLogByTransactionId: vi.fn(),
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
    `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions/${transactionId}`,
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

/** Story 3.8: the same transaction, already cancelled -- drives `editInvestmentTransaction`'s (`@niveshbook/core`, NOT mocked in this file) real already-cancelled guard end-to-end via `findTransactionById`. */
const CANCELLED_TRANSACTION = { ...EXISTING_TRANSACTION, status: "cancelled" };

function makeEditBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: "750000",
    transactionDate: "2026-10-06",
    paymentMode: "upi",
    referenceNumber: "REF-2",
    notes: "corrected",
    idempotencyKey: "edit-idem-1",
    reason: "typo'd the original amount",
    ...overrides,
  };
}

const EDITED_TRANSACTION = { ...EXISTING_TRANSACTION, amount: "750000", transactionDate: "2026-10-06", paymentMode: "upi", referenceNumber: "REF-2", notes: "corrected" };

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
  editTransaction.mockReset();
  editTransaction.mockResolvedValue({ transaction: EDITED_TRANSACTION, edited: true });
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("PATCH .../transactions/[transactionId]", () => {
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

  it("returns 404 for a nonexistent project, before requirement/transaction/authorize steps", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(findRequirementById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent requirement", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 when the requirement belongs to a different project (cross-project mismatch)", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue({ ...EXISTING_REQUIREMENT, projectId: OTHER_PROJECT_ID });

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
      makeContext(PROJECT_ID, REQUIREMENT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent transaction", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the transaction belongs to a different requirement (cross-requirement mismatch)", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue({ ...EXISTING_TRANSACTION, requirementId: OTHER_REQUIREMENT_ID });

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the transaction belongs to a different project", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue({ ...EXISTING_TRANSACTION, projectId: OTHER_PROJECT_ID });

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("returns 403 for a Partner/Sub-partner attempting to edit -- Owner/Admin-only, no self-access, checked before body parsing (a malformed JSON body still yields 403, not 400)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions/${TRANSACTION_ID}`,
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
      `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions/${TRANSACTION_ID}`,
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
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: makeEditBody({ amount: 750000 }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 200 with the updated transaction for a valid Owner/Admin edit", async () => {
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
        amount: "750000",
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

  it("never sends sharePercentSnapshot/shouldPaySnapshot/requirementId/projectId/partyType/shareId to the domain layer", async () => {
    ownerSession();

    await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    const call = editTransaction.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty("sharePercentSnapshot");
    expect(call).not.toHaveProperty("shouldPaySnapshot");
    expect(call).not.toHaveProperty("requirementId");
    expect(call).not.toHaveProperty("projectId");
    expect(call).not.toHaveProperty("partyType");
    expect(call).not.toHaveProperty("shareId");
  });

  it("returns 200 (not 201) when amount is '0' -- no minimum payment enforced", async () => {
    ownerSession();
    editTransaction.mockResolvedValue({
      transaction: { ...EDITED_TRANSACTION, amount: "0" },
      edited: true,
    });

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody({ amount: "0" }) }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).amount).toBe("0");
  });

  it("returns 400 validation_error for a negative amount", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody({ amount: "-500" }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for a malformed transactionDate", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: makeEditBody({ transactionDate: "not-a-date" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 400 validation_error for an unrecognized paymentMode", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody({ paymentMode: "bitcoin" }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 400 validation_error when idempotencyKey is missing", async () => {
    ownerSession();

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody({ idempotencyKey: "" }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("maps the port's edited: false result to a 200 response (not 409/201) -- proves the ROUTE's status-mapping only; the replay mechanism itself is proven separately below", async () => {
    ownerSession();
    editTransaction.mockResolvedValue({ transaction: EDITED_TRANSACTION, edited: false });

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EDITED_TRANSACTION);
  });

  /**
   * Unlike the test above (which hand-feeds the mock `{edited: false}`
   * directly), this issues TWO real `PATCH` requests with the SAME
   * `idempotencyKey` against a port mock that tracks applied edits by key
   * itself -- mirroring `packages/db`'s real check-first-then-replay
   * contract at a stateful-mock level. This proves the route correctly
   * threads a genuine replay scenario through (both requests hit the same
   * `editTransaction` mock, which itself decides the second one is a
   * repeat), not merely that the route trusts whatever the mock claims.
   */
  it("threads a real idempotent-replay scenario through two PATCH requests -- the second is detected as a repeat by the port and not re-applied", async () => {
    ownerSession();
    let appliedCount = 0;
    let storedTransaction: typeof EDITED_TRANSACTION | null = null;
    const appliedKeys = new Set<string>();
    editTransaction.mockImplementation(async (input: { idempotencyKey: string; amount: string }) => {
      if (appliedKeys.has(input.idempotencyKey)) {
        // Idempotent replay -- mirrors the real port's check-first path:
        // return the already-edited current state, apply nothing new.
        return { transaction: storedTransaction, edited: false };
      }
      appliedCount += 1;
      storedTransaction = { ...EDITED_TRANSACTION, amount: input.amount };
      appliedKeys.add(input.idempotencyKey);
      return { transaction: storedTransaction, edited: true };
    });
    const body = makeEditBody({ idempotencyKey: "route-replay-1" });

    const firstResponse = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body }),
      makeContext(),
    );
    const secondResponse = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body }),
      makeContext(),
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual(await secondResponse.json());
    // The route called the port's editTransaction twice (once per PATCH) --
    // but the port's own idempotency tracking applied the edit only once.
    expect(editTransaction).toHaveBeenCalledTimes(2);
    expect(appliedCount).toBe(1);
  });

  it("returns 409 idempotency_key_conflict when the port detects a genuine key collision between unrelated edit requests", async () => {
    ownerSession();
    editTransaction.mockRejectedValue(new IdempotencyKeyConflictError());

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });

  /**
   * Story 3.8, spec-3-8's Review Triage Log row 4: unlike the test below (a
   * mocked-away port rejection, which only proves the route's `catch` block
   * maps `AlreadyCancelledError` correctly), this drives the REAL
   * `editInvestmentTransaction` (`@niveshbook/core`, not mocked in this
   * file) end-to-end: `findTransactionById` -- the mock standing in for the
   * port's `findById`, which `editInvestmentTransaction` itself calls as
   * its already-cancelled guard's data source -- returns a `status:
   * "cancelled"` transaction, so the REAL guard fires and throws
   * `AlreadyCancelledError` before ever reaching the (mocked) port's
   * `editTransaction`. Confirms both the 409 mapping AND that the guard
   * short-circuits before any write is even attempted.
   */
  it("Story 3.8: returns 409 already_cancelled end-to-end when the fetched transaction is already cancelled -- via the REAL editInvestmentTransaction guard, not a mocked-away port error", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue(CANCELLED_TRANSACTION);

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_cancelled");
    expect(editTransaction).not.toHaveBeenCalled();
  });

  /**
   * Complements the test above: proves the route's `catch` block correctly
   * maps `AlreadyCancelledError` to 409 `already_cancelled` regardless of
   * WHERE it's thrown from -- here simulating the port-level guard firing
   * (the race-closing check added inside `editTransaction`'s own
   * `database.transaction()`, per spec-3-8's Review Triage Log row 1, which
   * cannot be exercised through this fully-mocked `@niveshbook/db` without a
   * live Postgres connection; see this story's live-verification script for
   * that coverage).
   */
  it("returns 409 already_cancelled when the port itself rejects with AlreadyCancelledError (e.g. the race-closing FOR UPDATE guard), no changes applied", async () => {
    ownerSession();
    editTransaction.mockRejectedValue(new AlreadyCancelledError());

    const response = await PATCH(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeEditBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_cancelled");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  EmptyWithdrawalTransactionBatchError,
  InvalidWithdrawalAmountError,
  PartnerSharesNotFullyAllocatedError,
  WithdrawalIdempotencyKeyConflictError,
} from "@niveshbook/core";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const sumActiveAmountByProjectId = vi.fn();
const withdrawalSumActiveAmountByProjectId = vi.fn();
const listActiveByProjectId = vi.fn();
const listActiveAllocationsByProjectId = vi.fn();
const recordTransactionBatch = vi.fn();
const recordWithdrawalTransactionBatchWithBonusConsumption = vi.fn();

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
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    cancelTransaction: vi.fn(),
    sumActiveAmountByProjectId,
  }),
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    recordTransactionBatch,
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: withdrawalSumActiveAmountByProjectId,
  }),
  createWithdrawalReallocationPort: () => ({
    record: vi.fn(),
    listActiveByProjectId,
    listActiveAllocationsByProjectId,
    listAllocationsByReallocationId: vi.fn(),
    cancel: vi.fn(),
    consumeAllocationLegs: vi.fn(),
    findById: vi.fn(),
    listAll: vi.fn(),
    listAllAllocations: vi.fn(),
  }),
  // Wrapped (not referenced directly) -- mirrors `../route.test.ts`'s
  // identical hoisting workaround one level over, for the batch analog.
  recordWithdrawalTransactionBatchWithBonusConsumption: (...args: unknown[]) =>
    recordWithdrawalTransactionBatchWithBonusConsumption(...args),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeRequest(options: { cookie?: string; body?: unknown } = {}): NextRequest {
  const { cookie, body } = options;
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/batch`, {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeContext(id: string = PROJECT_ID) {
  return { params: Promise.resolve({ id }) };
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
      { amount: "150000", paymentMode: "cash", referenceNumber: null, notes: null },
      { amount: "100000", paymentMode: "rtgs", referenceNumber: "UTR-1", notes: null },
    ],
    idempotencyKey: "batch-idem-1",
    ...overrides,
  };
}

const SAVED_TRANSACTIONS = [
  {
    id: "wtx-1",
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50",
    canTakeSnapshot: "250000",
    amount: "150000",
    transactionDate: "2026-10-05",
    paymentMode: "cash",
    referenceNumber: null,
    notes: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: "wtx-2",
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50",
    canTakeSnapshot: "250000",
    amount: "100000",
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
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: null }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "50", userId: "partner-user-b" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  sumActiveAmountByProjectId.mockReset();
  sumActiveAmountByProjectId.mockResolvedValue("500000");
  withdrawalSumActiveAmountByProjectId.mockReset();
  withdrawalSumActiveAmountByProjectId.mockResolvedValue("0");
  listActiveByProjectId.mockReset();
  listActiveByProjectId.mockResolvedValue([]);
  listActiveAllocationsByProjectId.mockReset();
  listActiveAllocationsByProjectId.mockResolvedValue([]);
  recordTransactionBatch.mockReset();
  recordTransactionBatch.mockResolvedValue({ transactions: SAVED_TRANSACTIONS, created: true });
  recordWithdrawalTransactionBatchWithBonusConsumption.mockReset();
  // Delegates straight to the plain `recordTransactionBatch` mock -- mirrors
  // `../route.test.ts`'s identical default-delegation convention one level
  // over, so every test not explicitly exercising bonus consumption keeps
  // asserting against `recordTransactionBatch` directly.
  recordWithdrawalTransactionBatchWithBonusConsumption.mockImplementation((input: unknown) =>
    recordTransactionBatch(input),
  );
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("POST /api/projects/[id]/withdrawal-transactions/batch", () => {
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

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed JSON body", async () => {
    ownerSession();
    const request = new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE_NAME}=t` },
      body: "{not valid json",
    });

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

  it("returns 403 when a Partner attempts to record another Partner's split withdrawal", async () => {
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

  it("returns 201 with every row when an Owner/Admin records a split withdrawal on a Partner's behalf", async () => {
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
        projectId: PROJECT_ID,
        partyType: "partner",
        shareId: "a",
        rows: [
          { amount: "150000", paymentMode: "cash", referenceNumber: null, notes: null },
          { amount: "100000", paymentMode: "rtgs", referenceNumber: "UTR-1", notes: null },
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
    recordTransactionBatch.mockRejectedValue(new WithdrawalIdempotencyKeyConflictError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });

  it("returns 400 validation_error when packages/core rejects a row (e.g. a negative amount) via InvalidWithdrawalAmountError", async () => {
    ownerSession();
    recordTransactionBatch.mockRejectedValue(new InvalidWithdrawalAmountError());

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

  it("returns 400 validation_error when rows is structurally valid but every row's amount is '' (caught by this route's own early toMoney(row.amount) call, ahead of recordWithdrawalTransactionBatch)", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: makeBatchBody({ rows: [{ amount: "not-a-number", paymentMode: "cash", referenceNumber: null, notes: null }] }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
    expect(recordTransactionBatch).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error when EmptyWithdrawalTransactionBatchError is thrown by packages/core", async () => {
    ownerSession();
    recordTransactionBatch.mockRejectedValue(new EmptyWithdrawalTransactionBatchError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
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
    recordTransactionBatch.mockRejectedValue(new PartnerSharesNotFullyAllocatedError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("shares_not_fully_allocated");
  });

  describe("Story 4.5: the Extra Withdrawal gate, evaluated against the batch's TOTAL amount", () => {
    // availableToWithdraw = 500000 - 0 = 500000; Partner A's 50% share Can
    // Take is 250000 throughout this block.

    it("a batch whose individual rows each stay under Can Take, but whose SUM exceeds it, is blocked with extra_withdrawal_authorization_required", async () => {
      ownerSession();

      // Neither row alone (150000, 150000) exceeds the 250000 ceiling, but
      // their sum (300000) does -- this is the feature's own key design
      // decision (check the batch total, not any single row).
      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          body: makeBatchBody({
            rows: [
              { amount: "150000", paymentMode: "cash", referenceNumber: null, notes: null },
              { amount: "150000", paymentMode: "neft", referenceNumber: null, notes: null },
            ],
          }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("extra_withdrawal_authorization_required");
      expect(recordTransactionBatch).not.toHaveBeenCalled();
    });

    it("a batch whose rows sum to exactly Can Take succeeds with no gate friction", async () => {
      ownerSession();

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          body: makeBatchBody({
            rows: [
              { amount: "150000", paymentMode: "cash", referenceNumber: null, notes: null },
              { amount: "100000", paymentMode: "neft", referenceNumber: null, notes: null },
            ],
          }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
      expect(recordTransactionBatch).toHaveBeenCalled();
    });

    it("an Owner/Admin (with the grant) who authorizes an over-cap batch total -- 201, every row saved as-is", async () => {
      ownerSession();
      recordTransactionBatch.mockResolvedValue({
        transactions: [
          { ...SAVED_TRANSACTIONS[0], amount: "150000" },
          { ...SAVED_TRANSACTIONS[1], amount: "150000" },
        ],
        created: true,
      });

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          body: makeBatchBody({
            rows: [
              { amount: "150000", paymentMode: "cash", referenceNumber: null, notes: null },
              { amount: "150000", paymentMode: "neft", referenceNumber: null, notes: null },
            ],
            extraWithdrawalAuthorized: true,
          }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
    });

    it("a non-Owner/Admin attempting to self-authorize their own over-cap batch -- 403, even though self-access would otherwise allow recording their own withdrawal", async () => {
      findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-b" });
      findUserById.mockResolvedValue(PARTNER_B_USER);

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          body: makeBatchBody({
            shareId: "b",
            rows: [
              { amount: "150000", paymentMode: "cash", referenceNumber: null, notes: null },
              { amount: "150000", paymentMode: "neft", referenceNumber: null, notes: null },
            ],
            extraWithdrawalAuthorized: true,
          }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("forbidden");
      expect(recordTransactionBatch).not.toHaveBeenCalled();
    });
  });

  describe("withdrawal reallocation bonus, applied against the batch's TOTAL amount", () => {
    it("passes bonusToConsume '0' through recordWithdrawalTransactionBatchWithBonusConsumption for a normal, within-entitlement batch", async () => {
      ownerSession();

      const response = await POST(
        makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
        makeContext(),
      );

      expect(response.status).toBe(201);
      expect(recordWithdrawalTransactionBatchWithBonusConsumption).toHaveBeenCalledWith(
        expect.objectContaining({
          rows: [
            { amount: "150000", paymentMode: "cash", referenceNumber: null, notes: null },
            { amount: "100000", paymentMode: "rtgs", referenceNumber: "UTR-1", notes: null },
          ],
        }),
        "0",
      );
    });

    it("an unconsumed bonus lets a recipient's batch total exceed their own Can Take with no Extra Withdrawal confirmation needed", async () => {
      ownerSession();
      listActiveAllocationsByProjectId.mockResolvedValue([
        {
          id: "leg-1",
          reallocationId: "realloc-1",
          partyType: "partner",
          shareId: "a",
          allocatedAmount: "80000",
          consumedAmount: "0",
          createdAt: new Date().toISOString(),
        },
      ]);
      recordTransactionBatch.mockResolvedValue({
        transactions: [
          { ...SAVED_TRANSACTIONS[0], amount: "150000" },
          { ...SAVED_TRANSACTIONS[1], amount: "180000" },
        ],
        created: true,
      });

      // Base Can Take 250000 + 80000 unconsumed bonus = 330000 ceiling; the
      // batch's total (150000 + 180000 = 330000) fits exactly, no
      // extraWithdrawalAuthorized needed.
      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          body: makeBatchBody({
            rows: [
              { amount: "150000", paymentMode: "cash", referenceNumber: null, notes: null },
              { amount: "180000", paymentMode: "neft", referenceNumber: null, notes: null },
            ],
          }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
      expect(recordWithdrawalTransactionBatchWithBonusConsumption).toHaveBeenCalledWith(
        expect.objectContaining({ rows: expect.any(Array) }),
        "80000",
      );
    });

    it("returns 409 reallocation_bonus_changed (not an unhandled 500) when a concurrent change shrinks the bonus between this route's snapshot and the port's own lock-guarded re-check", async () => {
      ownerSession();
      const { ReallocationBonusInsufficientError } = await import("@niveshbook/core");
      listActiveAllocationsByProjectId.mockResolvedValue([
        {
          id: "leg-1",
          reallocationId: "realloc-1",
          partyType: "partner",
          shareId: "a",
          allocatedAmount: "80000",
          consumedAmount: "0",
          createdAt: new Date().toISOString(),
        },
      ]);
      recordWithdrawalTransactionBatchWithBonusConsumption.mockRejectedValue(
        new ReallocationBonusInsufficientError(),
      );

      const response = await POST(
        makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: makeBatchBody() }),
        makeContext(),
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe("reallocation_bonus_changed");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { WithdrawalIdempotencyKeyConflictError } from "@niveshbook/core";
import { GET, POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const sumActiveAmountByProjectId = vi.fn();
const recordTransaction = vi.fn();
const listByProjectId = vi.fn();
const withdrawalSumActiveAmountByProjectId = vi.fn();
const listActiveByProjectId = vi.fn();
const listActiveAllocationsByProjectId = vi.fn();
const recordWithdrawalTransactionWithBonusConsumption = vi.fn();

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
    recordTransaction,
    listByProjectId,
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
  // Wrapped (not referenced directly) -- `vi.mock`'s factory runs at the
  // hoisted top of the file, before the `recordWithdrawalTransactionWithBonusConsumption`
  // const below has initialized; a wrapper arrow function defers the actual
  // reference until this is invoked from within the route, well after
  // module init completes.
  recordWithdrawalTransactionWithBonusConsumption: (...args: unknown[]) =>
    recordWithdrawalTransactionWithBonusConsumption(...args),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeRequest(options: { cookie?: string; method?: string; body?: unknown } = {}): NextRequest {
  const { cookie, method = "GET", body } = options;
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions`, {
    method,
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

function makeWithdrawalBody(overrides: Record<string, unknown> = {}) {
  return {
    partyType: "partner",
    shareId: "a",
    amount: "250000",
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: "REF-1",
    notes: null,
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

const SAVED_WITHDRAWAL = {
  id: "wtx-1",
  projectId: PROJECT_ID,
  partyType: "partner",
  shareId: "a",
  sharePercentSnapshot: "50",
  canTakeSnapshot: "250000",
  amount: "250000",
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
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "50", userId: "partner-user-b" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([
    makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", userId: "sub-partner-user-1" }),
  ]);
  sumActiveAmountByProjectId.mockReset();
  sumActiveAmountByProjectId.mockResolvedValue("500000");
  recordTransaction.mockReset();
  recordTransaction.mockResolvedValue({ transaction: SAVED_WITHDRAWAL, created: true });
  listByProjectId.mockReset();
  listByProjectId.mockResolvedValue([SAVED_WITHDRAWAL]);
  withdrawalSumActiveAmountByProjectId.mockReset();
  // "0" by default -- preserves every existing test's Can Take numbers
  // (availableToWithdraw = totalActiveInvested - "0" = totalActiveInvested,
  // matching this route's pre-fix behavior exactly) unless a test overrides
  // it to exercise the pool actually shrinking.
  withdrawalSumActiveAmountByProjectId.mockResolvedValue("0");
  listActiveByProjectId.mockReset();
  listActiveByProjectId.mockResolvedValue([]);
  listActiveAllocationsByProjectId.mockReset();
  listActiveAllocationsByProjectId.mockResolvedValue([]);
  recordWithdrawalTransactionWithBonusConsumption.mockReset();
  // Delegates straight to the plain `recordTransaction` mock -- preserves
  // every existing test's assertions on `recordTransaction`'s own call args/
  // resolved value unless a test explicitly wants to exercise bonus
  // consumption (in which case it asserts on
  // `recordWithdrawalTransactionWithBonusConsumption` directly instead).
  recordWithdrawalTransactionWithBonusConsumption.mockImplementation((input: unknown) =>
    recordTransaction(input),
  );
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("POST /api/projects/[id]/withdrawal-transactions", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(
      makeRequest({ method: "POST", body: makeWithdrawalBody() }),
      makeContext(),
    );

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project, before body validation/shares/authorize", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeWithdrawalBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeWithdrawalBody() }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed JSON body", async () => {
    ownerSession();
    const request = new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions`, {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE_NAME}=t`, "Content-Type": "application/json" },
      body: "{not-json",
    });

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
        body: makeWithdrawalBody({ partyType: "owner" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 invalid_request when idempotencyKey is missing from the body shape entirely", async () => {
    ownerSession();
    const { idempotencyKey: _idempotencyKey, ...withoutKey } = makeWithdrawalBody();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: withoutKey }),
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
        body: makeWithdrawalBody({ shareId: "nonexistent" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it("returns 201 when an Owner/Admin records a withdrawal on a Partner's behalf (AC: Can Take 2,50,000, amount 2,50,000)", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeWithdrawalBody() }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual(SAVED_WITHDRAWAL);
    expect(recordTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        canTakeSnapshot: "250000",
        amount: "250000",
        actorUserId: "owner-1",
      }),
    );
  });

  it("Can Take shrinks when money has already been withdrawn from the pool -- proves availableToWithdraw actually subtracts totalActiveWithdrawn on this route, not just the raw invested total", async () => {
    ownerSession();
    sumActiveAmountByProjectId.mockResolvedValue("500000");
    withdrawalSumActiveAmountByProjectId.mockResolvedValue("200000");
    recordTransaction.mockResolvedValue({
      transaction: { ...SAVED_WITHDRAWAL, amount: "150000", canTakeSnapshot: "150000" },
      created: true,
    });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeWithdrawalBody({ amount: "150000" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    // availableToWithdraw = 500000 - 200000 = 300000; A's 50% share = 150000 -- an
    // amount of 150000 is exactly at the (shrunk) ceiling, needing no Extra
    // Withdrawal authorization.
    expect(recordTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ canTakeSnapshot: "150000", amount: "150000" }),
    );
  });

  it("returns 201 for a Partner recording their own withdrawal (self-access)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeWithdrawalBody() }),
      makeContext(),
    );

    expect(response.status).toBe(201);
  });

  it("returns 201 for a Sub-partner recording their own withdrawal (self-access)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_PARTNER_USER);
    recordTransaction.mockResolvedValue({
      transaction: { ...SAVED_WITHDRAWAL, partyType: "sub_partner", shareId: "sub-1", amount: "50000" },
      created: true,
    });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        // Sub-1's live Can Take is 62,500 (12.5% of 5,00,000) -- 50,000 stays
        // within it, so Story 4.5's gate never triggers here (that's this
        // describe block's own dedicated tests below).
        body: makeWithdrawalBody({ partyType: "sub_partner", shareId: "sub-1", amount: "50000" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
  });

  it("returns 403 when a Partner attempts to record another Partner's withdrawal", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-b" });
    findUserById.mockResolvedValue(PARTNER_B_USER);

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeWithdrawalBody({ partyType: "partner", shareId: "a" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it("returns 201 when amount is '0' -- no forced withdrawal", async () => {
    ownerSession();
    recordTransaction.mockResolvedValue({
      transaction: { ...SAVED_WITHDRAWAL, amount: "0" },
      created: true,
    });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeWithdrawalBody({ amount: "0" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    expect((await response.json()).amount).toBe("0");
  });

  describe("Story 4.5: the Extra Withdrawal gate", () => {
    // Can Take is 2,50,000 (Partner A's 50% of the Project's 5,00,000
    // available-to-withdraw) throughout this block -- 3,00,000 exceeds it by
    // 50,000.

    it("AC: an Owner/Admin (with the grant) who authorizes an over-cap withdrawal -- 201, saved as-is, no new column", async () => {
      ownerSession();
      recordTransaction.mockResolvedValue({
        transaction: { ...SAVED_WITHDRAWAL, amount: "300000" },
        created: true,
      });

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "300000", extraWithdrawalAuthorized: true }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
      expect((await response.json()).amount).toBe("300000");
    });

    it("AC: an over-cap attempt without the authorization step -- 400 extra_withdrawal_authorization_required, no write", async () => {
      ownerSession();

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "300000" }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("extra_withdrawal_authorization_required");
      expect(recordTransaction).not.toHaveBeenCalled();
    });

    it("returns 400 extra_withdrawal_authorization_required when extraWithdrawalAuthorized is explicitly false and amount exceeds Can Take", async () => {
      ownerSession();

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "300000", extraWithdrawalAuthorized: false }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("extra_withdrawal_authorization_required");
      expect(recordTransaction).not.toHaveBeenCalled();
    });

    it("AC: a non-Owner/Admin attempting to self-authorize their own over-cap withdrawal -- 403, even though normal self-access would otherwise allow recording their own withdrawal", async () => {
      findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
      findUserById.mockResolvedValue(PARTNER_A_USER);

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "300000", extraWithdrawalAuthorized: true }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("forbidden");
      expect(recordTransaction).not.toHaveBeenCalled();
    });

    it("AC: an Owner/Admin with a revoked canApproveExtraWithdrawal grant -- 403, even with extraWithdrawalAuthorized true", async () => {
      findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
      findUserById.mockResolvedValue({ ...OWNER_USER, canApproveExtraWithdrawal: false });

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "300000", extraWithdrawalAuthorized: true }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("forbidden");
      expect(recordTransaction).not.toHaveBeenCalled();
    });

    it("exact-match amount (amount === live Can Take) is treated as within Can Take, not 'exceeds' -- 201 with no extraWithdrawalAuthorized needed", async () => {
      ownerSession();

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "250000" }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
    });

    it("idempotent replay of an already-authorized over-cap transaction -- 200; the gate runs on every request (replay or not), but is a no-op here since the replayed amount/canTake/authorization are unchanged", async () => {
      ownerSession();
      recordTransaction.mockResolvedValue({
        transaction: { ...SAVED_WITHDRAWAL, amount: "300000" },
        created: false,
      });

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({
            amount: "300000",
            extraWithdrawalAuthorized: true,
            idempotencyKey: "idem-1",
          }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(200);
    });

    it("applies identically to a sub_partner target: over-cap without authorization -- 400 extra_withdrawal_authorization_required (sub-1's live Can Take is 62,500; 1,00,000 exceeds it)", async () => {
      ownerSession();

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ partyType: "sub_partner", shareId: "sub-1", amount: "100000" }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("extra_withdrawal_authorization_required");
      expect(recordTransaction).not.toHaveBeenCalled();
    });

    it("applies identically to a sub_partner target: an Owner/Admin who authorizes an over-cap withdrawal -- 201", async () => {
      ownerSession();
      recordTransaction.mockResolvedValue({
        transaction: { ...SAVED_WITHDRAWAL, partyType: "sub_partner", shareId: "sub-1", amount: "100000" },
        created: true,
      });

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({
            partyType: "sub_partner",
            shareId: "sub-1",
            amount: "100000",
            extraWithdrawalAuthorized: true,
          }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
      expect((await response.json()).amount).toBe("100000");
    });

    it("locks in current behavior for two simultaneously-invalid conditions: a malformed amount AND Partner Shares not totalling 100% -- 409 shares_not_fully_allocated wins, since the gate's computeCanTake now runs before amount validation", async () => {
      ownerSession();
      listPartnerSharesByProjectId.mockResolvedValue([
        makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
        makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "40", userId: "partner-user-b" }),
      ]);

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "not-a-number" }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("shares_not_fully_allocated");
      expect(recordTransaction).not.toHaveBeenCalled();
    });
  });

  describe("withdrawal reallocation bonus", () => {
    // Partner A's live Can Take is 2,50,000 (50% of the 5,00,000 available-
    // to-withdraw) throughout this block.

    it("passes bonusToConsume '0' through recordWithdrawalTransactionWithBonusConsumption for a normal, within-entitlement withdrawal", async () => {
      ownerSession();

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "200000" }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
      expect(recordWithdrawalTransactionWithBonusConsumption).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "200000" }),
        "0",
      );
    });

    it("a share's own active decline immediately reduces their effective ceiling -- withdrawing what used to be within Can Take now requires Extra Withdrawal authorization", async () => {
      ownerSession();
      listActiveByProjectId.mockResolvedValue([
        {
          id: "realloc-1",
          projectId: PROJECT_ID,
          partyType: "partner",
          shareId: "a",
          declinedAmount: "100000",
          notes: null,
          status: "active",
          createdByUserId: "owner-1",
          createdAt: new Date().toISOString(),
        },
      ]);

      // Reduced ceiling: 250000 - 100000 = 150000; 200000 now exceeds it.
      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "200000" }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("extra_withdrawal_authorization_required");
      expect(recordWithdrawalTransactionWithBonusConsumption).not.toHaveBeenCalled();
    });

    it("an unconsumed bonus lets a recipient withdraw beyond their own Can Take with no Extra Withdrawal confirmation needed", async () => {
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
      recordTransaction.mockResolvedValue({
        transaction: { ...SAVED_WITHDRAWAL, amount: "300000" },
        created: true,
      });

      // Base Can Take 250000 + 80000 unconsumed bonus = 330000 ceiling;
      // 300000 fits within it, no extraWithdrawalAuthorized needed.
      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "300000" }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
      expect(recordWithdrawalTransactionWithBonusConsumption).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "300000" }),
        "50000",
      );
    });

    it("caps bonusToConsume at the full unconsumed bonus even when the withdrawal is authorized well beyond the combined ceiling", async () => {
      ownerSession();
      listActiveAllocationsByProjectId.mockResolvedValue([
        {
          id: "leg-1",
          reallocationId: "realloc-1",
          partyType: "partner",
          shareId: "a",
          allocatedAmount: "20000",
          consumedAmount: "0",
          createdAt: new Date().toISOString(),
        },
      ]);
      recordTransaction.mockResolvedValue({
        transaction: { ...SAVED_WITHDRAWAL, amount: "400000" },
        created: true,
      });

      // Combined ceiling is 250000 + 20000 = 270000; 400000 exceeds it, so
      // Extra Withdrawal authorization is required -- but the bonus itself
      // (20000) is still fully consumed, not the whole 150000 excess.
      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "400000", extraWithdrawalAuthorized: true }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(201);
      expect(recordWithdrawalTransactionWithBonusConsumption).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "400000" }),
        "20000",
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
      recordWithdrawalTransactionWithBonusConsumption.mockRejectedValue(
        new ReallocationBonusInsufficientError(),
      );

      const response = await POST(
        makeRequest({
          cookie: `${SESSION_COOKIE_NAME}=t`,
          method: "POST",
          body: makeWithdrawalBody({ amount: "300000" }),
        }),
        makeContext(),
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe("reallocation_bonus_changed");
    });
  });

  it("returns 400 validation_error for a negative amount", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeWithdrawalBody({ amount: "-500" }),
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
        body: makeWithdrawalBody({ paymentMode: "bitcoin" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 400 validation_error when idempotencyKey is blank", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeWithdrawalBody({ idempotencyKey: "   " }),
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
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeWithdrawalBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("shares_not_fully_allocated");
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 sub_partner_shares_over_allocated when a Partner's Sub-partner Shares exceed their own", async () => {
    ownerSession();
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "50", userId: "partner-user-b" }),
    ]);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", sharePercent: "60" }),
    ]);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeWithdrawalBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("sub_partner_shares_over_allocated");
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it("returns 200 (not 201) for a repeated POST with the same idempotencyKey and matching content -- idempotent replay", async () => {
    ownerSession();
    recordTransaction.mockResolvedValue({ transaction: SAVED_WITHDRAWAL, created: false });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        method: "POST",
        body: makeWithdrawalBody({ idempotencyKey: "idem-1" }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAVED_WITHDRAWAL);
  });

  it("returns 409 idempotency_key_conflict when the port detects a genuine key collision between unrelated requests", async () => {
    ownerSession();
    recordTransaction.mockRejectedValue(new WithdrawalIdempotencyKeyConflictError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, method: "POST", body: makeWithdrawalBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });
});

describe("GET /api/projects/[id]/withdrawal-transactions", () => {
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
    expect(listByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 200 with the withdrawal list for an owner_admin", async () => {
    ownerSession();

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactions: [SAVED_WITHDRAWAL] });
  });
});

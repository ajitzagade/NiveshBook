import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();

const investmentTransactionFindById = vi.fn();
const investmentTransactionSumActive = vi.fn();
const withdrawalTransactionFindById = vi.fn();
const allocationFindById = vi.fn();
const allocationListByWithdrawalTransactionId = vi.fn();
const movementFindByDestinationInvestmentTransactionId = vi.fn();
const movementFindByWithdrawalDestinationAllocationId = vi.fn();
const movementFindByAvailableBalanceSpendId = vi.fn();
const availableBalanceFindBalance = vi.fn();
const availableBalanceSpendFindById = vi.fn();

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
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: vi.fn(),
    findById: investmentTransactionFindById,
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    cancelTransaction: vi.fn(),
    sumActiveAmountByProjectId: investmentTransactionSumActive,
  }),
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    findById: withdrawalTransactionFindById,
  }),
  createWithdrawalDestinationAllocationPort: () => ({
    recordAllocation: vi.fn(),
    listByWithdrawalTransactionId: allocationListByWithdrawalTransactionId,
    hasConflictingAllocation: vi.fn(),
    findById: allocationFindById,
  }),
  createMoneyMovementPort: () => ({
    record: vi.fn(),
    listByDestinationProjectId: vi.fn(),
    findByDestinationInvestmentTransactionId: movementFindByDestinationInvestmentTransactionId,
    findByWithdrawalDestinationAllocationId: movementFindByWithdrawalDestinationAllocationId,
    findByAvailableBalanceSpendId: movementFindByAvailableBalanceSpendId,
  }),
  createAvailableBalancePort: () => ({
    creditBalance: vi.fn(),
    debitBalance: vi.fn(),
    listBalancesByProjectId: vi.fn(),
    findBalance: availableBalanceFindBalance,
  }),
  createAvailableBalanceSpendPort: () => ({
    recordSpend: vi.fn(),
    findById: availableBalanceSpendFindById,
  }),
}));

function makeRequest(query: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/money-trail${query}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });
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

const INVESTMENT_TRANSACTION_ID = "0192f5a0-4444-7000-8000-000000000004";

const INVESTMENT_TRANSACTION = {
  id: INVESTMENT_TRANSACTION_ID,
  requirementId: "req-1",
  projectId: "project-1",
  partyType: "partner" as const,
  shareId: "share-1",
  sharePercentSnapshot: "100",
  shouldPaySnapshot: "1000000",
  amount: "1000000",
  transactionDate: "2026-09-01",
  paymentMode: "neft",
  referenceNumber: null,
  notes: null,
  status: "active" as const,
  reversalOfTransactionId: null,
  createdAt: new Date().toISOString(),
};

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  investmentTransactionFindById.mockReset();
  investmentTransactionSumActive.mockReset();
  withdrawalTransactionFindById.mockReset();
  allocationFindById.mockReset();
  allocationListByWithdrawalTransactionId.mockReset();
  movementFindByDestinationInvestmentTransactionId.mockReset();
  movementFindByWithdrawalDestinationAllocationId.mockReset();
  movementFindByAvailableBalanceSpendId.mockReset();
  availableBalanceFindBalance.mockReset();
  availableBalanceSpendFindById.mockReset();

  investmentTransactionFindById.mockResolvedValue(INVESTMENT_TRANSACTION);
  movementFindByDestinationInvestmentTransactionId.mockResolvedValue(null);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

function partnerSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: PARTNER_USER.id });
  findUserById.mockResolvedValue(PARTNER_USER);
}

describe("GET /api/money-trail (Story 4.10, FR30)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`));

    expect(response.status).toBe(401);
    expect(investmentTransactionFindById).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-Owner/Admin session, before any data read", async () => {
    partnerSession();

    const response = await GET(
      makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(investmentTransactionFindById).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for a missing type", async () => {
    ownerSession();

    const response = await GET(makeRequest(`?id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 400 validation_error for an unrecognized type value", async () => {
    ownerSession();

    const response = await GET(
      makeRequest(`?type=not_a_real_type&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("returns 400 validation_error for the non-startable types (money_movement, both pool-reference types)", async () => {
    ownerSession();

    for (const type of ["money_movement", "project_investment_pool", "available_balance_pool"]) {
      const response = await GET(
        makeRequest(`?type=${type}&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
      );
      expect(response.status).toBe(400);
    }
  });

  it("returns 400 validation_error for a missing id", async () => {
    ownerSession();

    const response = await GET(makeRequest(`?type=investment_transaction`, `${SESSION_COOKIE_NAME}=t`));

    expect(response.status).toBe(400);
  });

  it("returns 404 not_found for a malformed (non-UUID) id, without reaching the DB", async () => {
    ownerSession();

    const response = await GET(
      makeRequest(`?type=investment_transaction&id=not-a-uuid`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(investmentTransactionFindById).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for a well-formed but nonexistent id", async () => {
    ownerSession();
    investmentTransactionFindById.mockResolvedValue(null);

    const response = await GET(
      makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("returns 200 with { trail, reconciliation } for a true-origin investment_transaction (no upstream, no downstream)", async () => {
    ownerSession();

    const response = await GET(
      makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.trail.type).toBe("investment_transaction");
    expect(body.trail.id).toBe(INVESTMENT_TRANSACTION_ID);
    expect(body.trail.upstream).toEqual([]);
    expect(body.trail.downstream).toEqual([]);
    expect(body.reconciliation).toEqual({ reconciled: true, discrepancies: [] });
  });
});

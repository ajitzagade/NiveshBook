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
const partnerSharesListAll = vi.fn();
const subPartnerSharesListAll = vi.fn();

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
  createPartnerSharePort: () => ({
    createPartnerShare: vi.fn(),
    findLatestByPartnerId: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: partnerSharesListAll,
  }),
  createSubPartnerSharePort: () => ({
    createSubPartnerShare: vi.fn(),
    findLatestBySubPartnerId: vi.fn(),
    listByPartnerId: vi.fn(),
    listByProjectId: vi.fn(),
    listAll: subPartnerSharesListAll,
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

const SUB_PARTNER_USER = {
  id: "sub-partner-user-a",
  email: "sub-partner-a@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "sub_partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const INVESTMENT_TRANSACTION_ID = "0192f5a0-4444-7000-8000-000000000004";
const WITHDRAWAL_TRANSACTION_ID = "0192f5a0-4444-7000-8000-000000000005";
const ALLOCATION_ID = "0192f5a0-4444-7000-8000-000000000006";
const AVAILABLE_BALANCE_SPEND_ID = "0192f5a0-4444-7000-8000-000000000007";

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

const WITHDRAWAL_TRANSACTION = {
  id: WITHDRAWAL_TRANSACTION_ID,
  projectId: "project-1",
  partyType: "partner" as const,
  shareId: "share-1",
  sharePercentSnapshot: "100",
  canTakeSnapshot: "500000",
  amount: "500000",
  transactionDate: "2026-09-10",
  paymentMode: "neft",
  referenceNumber: null,
  notes: null,
  status: "active" as const,
  reversalOfTransactionId: null,
  createdAt: new Date().toISOString(),
};

const ALLOCATION_LEG = {
  id: ALLOCATION_ID,
  withdrawalTransactionId: WITHDRAWAL_TRANSACTION_ID,
  destinationType: "person" as const,
  amount: "100000",
  destinationProjectId: null,
  personName: "Someone",
  notes: null,
  destinationRequirementId: null,
  destinationShareId: null,
  destinationPartyType: null,
  createdAt: new Date().toISOString(),
};

const AVAILABLE_BALANCE_SPEND = {
  id: AVAILABLE_BALANCE_SPEND_ID,
  sourceProjectId: "project-1",
  partyType: "sub_partner" as const,
  shareId: "sub-share-1",
  destinationType: "person" as const,
  destinationProjectId: null,
  destinationRequirementId: null,
  destinationShareId: null,
  destinationPartyType: null,
  personName: "Someone",
  amount: "50000",
  notes: null,
  createdAt: new Date().toISOString(),
};

const PARTNER_SHARE_ROW = {
  id: "psrow-1",
  partnerId: "share-1",
  projectId: "project-1",
  name: "Partner A",
  sharePercent: "100",
  userId: PARTNER_USER.id,
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const OTHER_PARTNER_SHARE_ROW = {
  id: "psrow-2",
  partnerId: "share-1",
  projectId: "project-1",
  name: "Someone Else",
  sharePercent: "100",
  userId: "someone-else",
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const SUB_PARTNER_SHARE_ROW = {
  id: "spsrow-1",
  subPartnerId: "sub-share-1",
  partnerId: "share-1",
  projectId: "project-1",
  name: "Sub-partner A",
  sharePercent: "50",
  userId: SUB_PARTNER_USER.id,
  effectiveFrom: new Date().toISOString(),
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
  partnerSharesListAll.mockReset();
  subPartnerSharesListAll.mockReset();

  investmentTransactionFindById.mockResolvedValue(INVESTMENT_TRANSACTION);
  investmentTransactionSumActive.mockResolvedValue("0");
  withdrawalTransactionFindById.mockResolvedValue(WITHDRAWAL_TRANSACTION);
  allocationFindById.mockResolvedValue(ALLOCATION_LEG);
  allocationListByWithdrawalTransactionId.mockResolvedValue([]);
  availableBalanceSpendFindById.mockResolvedValue(AVAILABLE_BALANCE_SPEND);
  availableBalanceFindBalance.mockResolvedValue(null);
  movementFindByDestinationInvestmentTransactionId.mockResolvedValue(null);
  movementFindByWithdrawalDestinationAllocationId.mockResolvedValue(null);
  movementFindByAvailableBalanceSpendId.mockResolvedValue(null);
  partnerSharesListAll.mockResolvedValue([]);
  subPartnerSharesListAll.mockResolvedValue([]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

function partnerSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: PARTNER_USER.id });
  findUserById.mockResolvedValue(PARTNER_USER);
}

function subPartnerSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: SUB_PARTNER_USER.id });
  findUserById.mockResolvedValue(SUB_PARTNER_USER);
}

describe("GET /api/money-trail (Story 4.10, FR30)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`));

    expect(response.status).toBe(401);
    expect(investmentTransactionFindById).not.toHaveBeenCalled();
  });

  it("returns 403 for a Partner session whose current Shares don't include the starting entity (Story 5.2) -- after the narrow identity-resolution read, before assembleMoneyTrail", async () => {
    partnerSession();
    // No matching current Partner Share for (partnerId "share-1", projectId "project-1") linked to this user.
    partnerSharesListAll.mockResolvedValue([OTHER_PARTNER_SHARE_ROW]);

    const response = await GET(
      makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    // The narrow identity-resolution read DID happen (Story 5.2's Decisions #4) --
    // but `assembleMoneyTrail()` itself never ran (still gated behind authorization).
    expect(investmentTransactionFindById).toHaveBeenCalledTimes(1);
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

  it("does not resolve the starting entity for owner_admin -- no Partner/Sub-partner Share reads, findById called exactly once (assembleMoneyTrail's own)", async () => {
    ownerSession();

    const response = await GET(
      makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(200);
    expect(investmentTransactionFindById).toHaveBeenCalledTimes(1);
    expect(partnerSharesListAll).not.toHaveBeenCalled();
    expect(subPartnerSharesListAll).not.toHaveBeenCalled();
  });
});

describe("GET /api/money-trail -- self-access (Story 5.2, FR32)", () => {
  beforeEach(resetMocks);

  it("allows a Partner to start a trail from their OWN investment_transaction", async () => {
    partnerSession();
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_ROW]);

    const response = await GET(
      makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.trail.id).toBe(INVESTMENT_TRANSACTION_ID);
  });

  it("allows a Partner to start a trail from their OWN withdrawal_transaction", async () => {
    partnerSession();
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_ROW]);

    const response = await GET(
      makeRequest(`?type=withdrawal_transaction&id=${WITHDRAWAL_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.trail.id).toBe(WITHDRAWAL_TRANSACTION_ID);
  });

  it("returns 403 for a Partner starting a trail from another party's withdrawal_transaction", async () => {
    partnerSession();
    partnerSharesListAll.mockResolvedValue([OTHER_PARTNER_SHARE_ROW]);

    const response = await GET(
      makeRequest(`?type=withdrawal_transaction&id=${WITHDRAWAL_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(403);
  });

  it("allows a Partner to start a trail from a withdrawal_destination_allocation LEG that inherits its owning party from its PARENT withdrawal_transaction (the leg itself carries no partyType/shareId)", async () => {
    partnerSession();
    partnerSharesListAll.mockResolvedValue([PARTNER_SHARE_ROW]);

    const response = await GET(
      makeRequest(`?type=withdrawal_destination_allocation&id=${ALLOCATION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.trail.id).toBe(ALLOCATION_ID);
    // Proves the PARENT withdrawal was read to resolve identity, not just the leg.
    expect(withdrawalTransactionFindById).toHaveBeenCalledWith(WITHDRAWAL_TRANSACTION_ID);
  });

  it("returns 403 for a Partner starting a trail from a LEG belonging to another party's withdrawal (via the leg's parent)", async () => {
    partnerSession();
    partnerSharesListAll.mockResolvedValue([OTHER_PARTNER_SHARE_ROW]);

    const response = await GET(
      makeRequest(`?type=withdrawal_destination_allocation&id=${ALLOCATION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 (not a spurious 404, not a false grant) for a Partner starting a trail from a LEG whose PARENT withdrawal can't be found -- a data-integrity edge case (`resolveTrailStartOwner`'s `{ found: true, ownerId: null }` branch)", async () => {
    partnerSession();
    allocationFindById.mockResolvedValue(ALLOCATION_LEG);
    withdrawalTransactionFindById.mockResolvedValue(null);

    const response = await GET(
      makeRequest(`?type=withdrawal_destination_allocation&id=${ALLOCATION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    // The leg itself DOES exist -- this must not be reported as 404 (that
    // would misrepresent the leg's own existence). Self-access simply isn't
    // granted (no owner could be resolved), so it falls through to the
    // owner_admin-only role check, which a Partner fails.
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("allows a Sub-partner to start a trail from their OWN available_balance_spend", async () => {
    subPartnerSession();
    subPartnerSharesListAll.mockResolvedValue([SUB_PARTNER_SHARE_ROW]);

    const response = await GET(
      makeRequest(`?type=available_balance_spend&id=${AVAILABLE_BALANCE_SPEND_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.trail.id).toBe(AVAILABLE_BALANCE_SPEND_ID);
    // A partyType of "sub_partner" resolves via listAllCurrentSubPartnerShares only, not the Partner list.
    expect(partnerSharesListAll).not.toHaveBeenCalled();
  });

  it("returns 403 for a Sub-partner starting a trail from another party's available_balance_spend when NO current Sub-partner Share matches at all", async () => {
    subPartnerSession();
    subPartnerSharesListAll.mockResolvedValue([]);

    const response = await GET(
      makeRequest(`?type=available_balance_spend&id=${AVAILABLE_BALANCE_SPEND_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 for a Sub-partner starting a trail from another party's available_balance_spend when a matching Share EXISTS but belongs to a different userId (not just 'no share exists at all')", async () => {
    subPartnerSession();
    subPartnerSharesListAll.mockResolvedValue([{ ...SUB_PARTNER_SHARE_ROW, userId: "someone-else-entirely" }]);

    const response = await GET(
      makeRequest(`?type=available_balance_spend&id=${AVAILABLE_BALANCE_SPEND_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(403);
  });

  it("returns 404 (not 403) for a Partner when the well-formed starting id simply doesn't exist -- no more leaked than existence", async () => {
    partnerSession();
    investmentTransactionFindById.mockResolvedValue(null);

    const response = await GET(
      makeRequest(`?type=investment_transaction&id=${INVESTMENT_TRANSACTION_ID}`, `${SESSION_COOKIE_NAME}=t`),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });
});

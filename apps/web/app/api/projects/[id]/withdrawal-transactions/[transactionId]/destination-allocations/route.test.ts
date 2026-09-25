import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  AllocationMismatchError,
  AlreadyAllocatedError,
  ShareNotFoundError,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
  WithdrawalDestinationAllocationIdempotencyKeyConflictError,
  ZeroAmountProjectLegError,
} from "@niveshbook/core";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const listByProjectId = vi.fn();
const recordAllocation = vi.fn();
const hasConflictingAllocation = vi.fn();
const findRequirementById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();

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
    listByProjectId,
  }),
  createWithdrawalDestinationAllocationPort: () => ({
    recordAllocation,
    listByWithdrawalTransactionId: vi.fn(),
    hasConflictingAllocation,
  }),
  // Story 4.8 (FR28): resolving a "project" leg's destinationRequirementId/
  // destinationShareId against the destination Project's current data.
  createInvestmentRequirementPort: () => ({
    createInvestmentRequirement: vi.fn(),
    listByProjectId: vi.fn(),
    findById: findRequirementById,
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
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const TRANSACTION_ID = "0192f5a0-6666-7000-8000-000000000006";
const DESTINATION_REQUIREMENT_ID = "0192f5a0-7777-7000-8000-000000000007";
const DESTINATION_PARTNER_ID = "0192f5a0-8888-7000-8000-000000000008";

function makeRequest(options: { cookie?: string; method?: string; body?: unknown } = {}): NextRequest {
  const { cookie, method = "POST", body } = options;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/${TRANSACTION_ID}/destination-allocations`,
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

const PARTNER_USER = {
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

const OTHER_PROJECT = {
  id: OTHER_PROJECT_ID,
  name: "Other Project",
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SAVED_WITHDRAWAL = {
  id: TRANSACTION_ID,
  projectId: PROJECT_ID,
  partyType: "partner",
  shareId: "a",
  sharePercentSnapshot: "50",
  canTakeSnapshot: "250000",
  amount: "250000",
  transactionDate: "2026-10-05",
  paymentMode: "neft",
  referenceNumber: null,
  notes: null,
  createdAt: new Date().toISOString(),
};

function makeAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: "alloc-1",
    withdrawalTransactionId: TRANSACTION_ID,
    destinationType: "other",
    amount: "250000",
    destinationProjectId: null,
    personName: null,
    notes: "Kept as cash",
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const DESTINATION_REQUIREMENT = {
  id: DESTINATION_REQUIREMENT_ID,
  projectId: OTHER_PROJECT_ID,
  amount: "1000000",
  requirementDate: "2026-10-01",
  createdAt: new Date().toISOString(),
};

const DESTINATION_PARTNER_SHARE_ROW = {
  id: "row-1",
  partnerId: DESTINATION_PARTNER_ID,
  projectId: OTHER_PROJECT_ID,
  name: "Destination Partner",
  sharePercent: "100",
  userId: null,
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

/** A well-formed "project" leg (Story 4.8) -- every field a "project" leg now requires beyond `destinationProjectId`. */
function projectLeg(overrides: Record<string, unknown> = {}) {
  return {
    destinationType: "project",
    amount: "150000",
    destinationProjectId: OTHER_PROJECT_ID,
    destinationRequirementId: DESTINATION_REQUIREMENT_ID,
    destinationShareId: DESTINATION_PARTNER_ID,
    destinationPartyType: "partner",
    ...overrides,
  };
}

function fullSplitBody(overrides: Record<string, unknown> = {}) {
  return {
    legs: [
      projectLeg(),
      { destinationType: "person", amount: "50000", personName: "Person X" },
      { destinationType: "available_balance", amount: "50000" },
    ],
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockImplementation(async (id: string) => {
    if (id === PROJECT_ID) return EXISTING_PROJECT;
    if (id === OTHER_PROJECT_ID) return OTHER_PROJECT;
    return null;
  });
  listByProjectId.mockReset();
  listByProjectId.mockResolvedValue([SAVED_WITHDRAWAL]);
  findRequirementById.mockReset();
  findRequirementById.mockImplementation(async (id: string) => {
    if (id === DESTINATION_REQUIREMENT_ID) return DESTINATION_REQUIREMENT;
    return null;
  });
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([DESTINATION_PARTNER_SHARE_ROW]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  recordAllocation.mockReset();
  recordAllocation.mockResolvedValue({
    allocations: [
      makeAllocation({
        id: "alloc-1",
        destinationType: "project",
        amount: "150000",
        destinationProjectId: OTHER_PROJECT_ID,
        destinationRequirementId: DESTINATION_REQUIREMENT_ID,
        destinationShareId: DESTINATION_PARTNER_ID,
        destinationPartyType: "partner",
      }),
      makeAllocation({ id: "alloc-2", destinationType: "person", amount: "50000", personName: "Person X", notes: null }),
      makeAllocation({ id: "alloc-3", destinationType: "available_balance", amount: "50000", notes: null }),
    ],
    moneyMovements: [
      {
        id: "movement-1",
        withdrawalDestinationAllocationId: "alloc-1",
        sourceProjectId: PROJECT_ID,
        destinationProjectId: OTHER_PROJECT_ID,
        destinationInvestmentTransactionId: "tx-1",
        amount: "150000",
        createdAt: new Date().toISOString(),
      },
    ],
    created: true,
  });
  hasConflictingAllocation.mockReset();
  hasConflictingAllocation.mockResolvedValue(false);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

function partnerSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: PARTNER_USER.id });
  findUserById.mockResolvedValue(PARTNER_USER);
}

describe("POST .../withdrawal-transactions/[transactionId]/destination-allocations", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makeRequest({ body: fullSplitBody() }), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(listByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed transactionId", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(PROJECT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(listByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent transactionId", async () => {
    ownerSession();
    listByProjectId.mockResolvedValue([]);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("returns 404 when the transaction belongs to a different Project (never resolved against this Project's own list)", async () => {
    ownerSession();
    listByProjectId.mockResolvedValue([{ ...SAVED_WITHDRAWAL, projectId: OTHER_PROJECT_ID }]);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 for a non-Owner/Admin session, even the withdrawal's own Partner", async () => {
    partnerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(recordAllocation).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed JSON body", async () => {
    ownerSession();
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/withdrawal-transactions/${TRANSACTION_ID}/destination-allocations`,
      { method: "POST", headers: { Cookie: `${SESSION_COOKIE_NAME}=t`, "Content-Type": "application/json" }, body: "{not-json" },
    );

    const response = await POST(request, makeContext());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 invalid_request for an empty legs array", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody({ legs: [] }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 invalid_request for a 'project' leg with no destinationProjectId", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({ legs: [{ destinationType: "project", amount: "250000" }] }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 validation_error for a 'project' leg targeting a nonexistent Project", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({
          legs: [
            projectLeg({
              amount: "250000",
              destinationProjectId: "0192f5a0-9999-7000-8000-000000000009",
            }),
          ],
        }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
    expect(recordAllocation).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error (not a 500) for a malformed (non-UUID) destinationProjectId, without ever querying the DB for it", async () => {
    ownerSession();
    findProjectById.mockClear();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({
          legs: [projectLeg({ amount: "250000", destinationProjectId: "not-a-uuid" })],
        }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
    expect(recordAllocation).not.toHaveBeenCalled();
    // Only ever called for the source Project (project 404 check) -- never
    // with the malformed destinationProjectId itself.
    expect(findProjectById).not.toHaveBeenCalledWith("not-a-uuid");
  });

  it("returns 400 invalid_request for a 'project' leg missing destinationRequirementId/destinationShareId/destinationPartyType (Story 4.8)", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({
          legs: [{ destinationType: "project", amount: "250000", destinationProjectId: OTHER_PROJECT_ID }],
        }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
    expect(recordAllocation).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when a 'project' leg's destinationRequirementId doesn't resolve at the destination Project (Story 4.8, FR28)", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(recordAllocation).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when the resolved requirement belongs to a different Project than destinationProjectId (Story 4.8, FR28)", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue({ ...DESTINATION_REQUIREMENT, projectId: PROJECT_ID });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(recordAllocation).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when a 'project' leg's destinationShareId doesn't match any current Partner/Sub-partner Share at the destination Project (Story 4.8, FR28)", async () => {
    ownerSession();
    listPartnerSharesByProjectId.mockResolvedValue([]);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(recordAllocation).not.toHaveBeenCalled();
  });

  it("resolves a sub_partner destinationShareId against the destination Project's current Sub-partner Shares (Story 4.8, FR28)", async () => {
    ownerSession();
    listPartnerSharesByProjectId.mockResolvedValue([DESTINATION_PARTNER_SHARE_ROW]);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      {
        id: "sub-row-1",
        subPartnerId: "sub-partner-9",
        partnerId: DESTINATION_PARTNER_ID,
        projectId: OTHER_PROJECT_ID,
        name: "Destination Sub-partner",
        sharePercent: "25",
        userId: null,
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({
          legs: [
            projectLeg({ destinationShareId: "sub-partner-9", destinationPartyType: "sub_partner" }),
            { destinationType: "person", amount: "50000", personName: "Person X" },
            { destinationType: "available_balance", amount: "50000" },
          ],
        }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    expect(recordAllocation).toHaveBeenCalledTimes(1);
  });

  it("returns 400 invalid_request for an 'other' leg with empty/null notes", async () => {
    ownerSession();

    const emptyNotesResponse = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({ legs: [{ destinationType: "other", amount: "250000", notes: "" }] }),
      }),
      makeContext(),
    );
    expect(emptyNotesResponse.status).toBe(400);
    expect((await emptyNotesResponse.json()).code).toBe("invalid_request");

    const nullNotesResponse = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({ legs: [{ destinationType: "other", amount: "250000", notes: null }] }),
      }),
      makeContext(),
    );
    expect(nullNotesResponse.status).toBe(400);
    expect((await nullNotesResponse.json()).code).toBe("invalid_request");

    const missingNotesResponse = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({ legs: [{ destinationType: "other", amount: "250000" }] }),
      }),
      makeContext(),
    );
    expect(missingNotesResponse.status).toBe(400);
    expect((await missingNotesResponse.json()).code).toBe("invalid_request");

    expect(recordAllocation).not.toHaveBeenCalled();
  });

  it("saves an exact multi-destination split atomically (AC1) -- 201, all legs returned", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.allocations).toHaveLength(3);
    expect(body.moneyMovements).toHaveLength(1);
    expect(recordAllocation).toHaveBeenCalledTimes(1);
    const [withdrawalTransactionId, legs, idempotencyKey, actorUserId] = recordAllocation.mock.calls[0];
    expect(withdrawalTransactionId).toBe(TRANSACTION_ID);
    expect(legs).toHaveLength(3);
    expect(idempotencyKey).toBe("idem-1");
    expect(actorUserId).toBe("owner-1");
    // Story 4.8: the "project" leg's destinationSnapshotInput was resolved
    // and threaded through -- everything else got null.
    const projectLegInput = legs.find((leg: { destinationType: string }) => leg.destinationType === "project");
    expect(projectLegInput.destinationSnapshotInput).not.toBeNull();
    expect(projectLegInput.destinationSnapshotInput.requirement.id).toBe(DESTINATION_REQUIREMENT_ID);
    const personLegInput = legs.find((leg: { destinationType: string }) => leg.destinationType === "person");
    expect(personLegInput.destinationSnapshotInput).toBeNull();
  });

  it("saves a single 'other' leg for the full amount -- 201", async () => {
    ownerSession();
    recordAllocation.mockResolvedValue({
      allocations: [makeAllocation({ destinationType: "other", amount: "250000", notes: "Held as cash" })],
      created: true,
    });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({ legs: [{ destinationType: "other", amount: "250000", notes: "Held as cash" }] }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
  });

  it("returns 200 (not 201) on an idempotent replay", async () => {
    ownerSession();
    recordAllocation.mockResolvedValue({
      allocations: [makeAllocation({ destinationType: "other", amount: "250000" })],
      created: false,
    });

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({ legs: [{ destinationType: "other", amount: "250000", notes: "Held as cash" }] }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
  });

  it("maps AllocationMismatchError to 400 allocation_mismatch", async () => {
    ownerSession();
    recordAllocation.mockRejectedValue(new AllocationMismatchError());

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({ legs: [{ destinationType: "other", amount: "200000", notes: "Short" }] }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("allocation_mismatch");
  });

  it("maps AlreadyAllocatedError to 409 already_allocated", async () => {
    ownerSession();
    recordAllocation.mockRejectedValue(new AlreadyAllocatedError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_allocated");
  });

  it("returns 409 already_allocated (not 400) when the withdrawal is already allocated under a different key AND the body's total is also mismatched -- the more fundamental problem wins", async () => {
    ownerSession();
    hasConflictingAllocation.mockResolvedValue(true);

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: fullSplitBody({ legs: [{ destinationType: "other", amount: "100000", notes: "Short" }] }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_allocated");
    expect(recordAllocation).not.toHaveBeenCalled();
  });

  it("maps WithdrawalDestinationAllocationIdempotencyKeyConflictError to 409 idempotency_key_conflict", async () => {
    ownerSession();
    recordAllocation.mockRejectedValue(new WithdrawalDestinationAllocationIdempotencyKeyConflictError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });

  // Review finding (Story 4.8): these four error-mapping branches --
  // thrown deep inside `moveWithdrawalToProject()`/`buildTransactionSnapshot`
  // (or, for ZeroAmountProjectLegError, `normalizeLeg`) and propagated
  // uncaught through `recordAllocation` -- had zero route-level coverage.

  it("maps SharesNotFullyAllocatedError to 409 shares_not_fully_allocated", async () => {
    ownerSession();
    recordAllocation.mockRejectedValue(new SharesNotFullyAllocatedError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("shares_not_fully_allocated");
  });

  it("maps SubPartnerSharesOverAllocatedError to 409 sub_partner_shares_over_allocated", async () => {
    ownerSession();
    recordAllocation.mockRejectedValue(new SubPartnerSharesOverAllocatedError("Destination Partner"));

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("sub_partner_shares_over_allocated");
  });

  it("maps ShareNotFoundError to 404 not_found (defense-in-depth for the race between this route's own destination-share check and the atomic write)", async () => {
    ownerSession();
    recordAllocation.mockRejectedValue(new ShareNotFoundError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("maps ZeroAmountProjectLegError to 400 validation_error", async () => {
    ownerSession();
    recordAllocation.mockRejectedValue(new ZeroAmountProjectLegError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: fullSplitBody() }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });
});

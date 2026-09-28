import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const sumActiveAmountByProjectId = vi.fn();
const withdrawalSumActiveAmountByProjectId = vi.fn();
const recordReallocation = vi.fn();
const listActiveByProjectId = vi.fn();
const listActiveAllocationsByProjectId = vi.fn();

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
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: withdrawalSumActiveAmountByProjectId,
  }),
  createWithdrawalReallocationPort: () => ({
    record: recordReallocation,
    listActiveByProjectId,
    listActiveAllocationsByProjectId,
    listAllocationsByReallocationId: vi.fn(),
    cancel: vi.fn(),
    consumeAllocationLegs: vi.fn(),
    findById: vi.fn(),
    listAll: vi.fn(),
    listAllAllocations: vi.fn(),
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeRequest(body: unknown, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/withdrawal-reallocations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/withdrawal-reallocations`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
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

const PARTNER_USER = {
  id: "partner-user-1",
  email: "partner@niveshbook.test",
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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    partyType: "partner",
    shareId: "a",
    declinedAmount: "100000",
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findUserById.mockResolvedValue(OWNER_USER);
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50" }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "30" }),
    makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "20" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  sumActiveAmountByProjectId.mockReset();
  sumActiveAmountByProjectId.mockResolvedValue("500000");
  withdrawalSumActiveAmountByProjectId.mockReset();
  withdrawalSumActiveAmountByProjectId.mockResolvedValue("0");
  recordReallocation.mockReset();
  recordReallocation.mockImplementation(async (input, legs) => ({
    reallocation: { id: "realloc-1", ...input, status: "active", createdAt: new Date().toISOString() },
    allocations: legs.map((leg: Record<string, unknown>, i: number) => ({
      id: `leg-${i}`,
      reallocationId: "realloc-1",
      consumedAmount: "0",
      createdAt: new Date().toISOString(),
      ...leg,
    })),
    created: true,
  }));
  listActiveByProjectId.mockReset();
  listActiveByProjectId.mockResolvedValue([]);
  listActiveAllocationsByProjectId.mockReset();
  listActiveAllocationsByProjectId.mockResolvedValue([]);
}

describe("POST /api/projects/[id]/withdrawal-reallocations", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makeRequest(validBody()), makeContext());
    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin, checked before any DB read", async () => {
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makeRequest(validBody(), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed body", async () => {
    const response = await POST(
      makeRequest({ partyType: "partner" }, `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_request");
  });

  it("returns 404 for a nonexistent project", async () => {
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makeRequest(validBody(), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(404);
  });

  it("creates a reallocation and its pro-rata legs -- 201, correct split by relative Share %", async () => {
    const response = await POST(
      makeRequest(validBody({ declinedAmount: "100000" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(201);
    expect(recordReallocation).toHaveBeenCalledTimes(1);
    const [input, legs] = recordReallocation.mock.calls[0];
    expect(input).toMatchObject({ projectId: PROJECT_ID, partyType: "partner", shareId: "a", declinedAmount: "100000" });
    const byShareId = Object.fromEntries(legs.map((leg: { shareId: string; allocatedAmount: string }) => [leg.shareId, leg.allocatedAmount]));
    expect(byShareId.b).toBe("60000");
    expect(byShareId.c).toBe("40000");
  });

  it("returns 200 (not 201) on an idempotent replay", async () => {
    recordReallocation.mockResolvedValue({
      reallocation: { id: "realloc-1", status: "active" },
      allocations: [],
      created: false,
    });

    const response = await POST(
      makeRequest(validBody(), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(200);
  });

  it("returns 400 validation_error when declinedAmount exceeds the target's own effective Can Take", async () => {
    const response = await POST(
      makeRequest(validBody({ declinedAmount: "999999999" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(recordReallocation).not.toHaveBeenCalled();
  });

  it("nets out the decliner's own prior active declines before validating a new one against their effective Can Take", async () => {
    listActiveByProjectId.mockResolvedValue([
      { id: "prior", projectId: PROJECT_ID, partyType: "partner", shareId: "a", declinedAmount: "200000", notes: null, status: "active", createdByUserId: "owner-1", createdAt: new Date().toISOString() },
    ]);

    // A's base Can Take is 250000 (50% of 500000); after a prior 200000
    // decline, effective Can Take is only 50000 -- declining another 100000
    // must be rejected.
    const response = await POST(
      makeRequest(validBody({ declinedAmount: "100000" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(400);
  });

  it("returns 409 shares_not_fully_allocated when Partner Shares don't total 100%", async () => {
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", sharePercent: "50" }),
      makePartnerShareRow({ partnerId: "b", sharePercent: "30" }),
    ]);

    const response = await POST(
      makeRequest(validBody(), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("shares_not_fully_allocated");
  });

  it("returns 409 sub_partner_shares_over_allocated when a Partner's Sub-partners exceed their own share", async () => {
    listSubPartnerSharesByProjectId.mockResolvedValue([
      { id: "sub1", subPartnerId: "sub1", partnerId: "a", projectId: PROJECT_ID, name: "Sub1", sharePercent: "30", userId: null, effectiveFrom: new Date().toISOString(), createdAt: new Date().toISOString() },
      { id: "sub2", subPartnerId: "sub2", partnerId: "a", projectId: PROJECT_ID, name: "Sub2", sharePercent: "30", userId: null, effectiveFrom: new Date().toISOString(), createdAt: new Date().toISOString() },
    ]);

    const response = await POST(
      makeRequest(validBody({ shareId: "b" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("sub_partner_shares_over_allocated");
    expect(recordReallocation).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for a malformed (non-numeric) declinedAmount", async () => {
    const response = await POST(
      makeRequest(validBody({ declinedAmount: "not-a-number" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(recordReallocation).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for a '0' declinedAmount -- a decline must be greater than zero", async () => {
    const response = await POST(
      makeRequest(validBody({ declinedAmount: "0" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(recordReallocation).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when the declining shareId isn't a current Partner/Sub-partner", async () => {
    const response = await POST(
      makeRequest(validBody({ shareId: "not-a-real-share" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(404);
  });

  it("returns 409 no_recipients when the declining leaf is the only current leaf in the Project", async () => {
    listPartnerSharesByProjectId.mockResolvedValue([makePartnerShareRow({ partnerId: "a", sharePercent: "100" })]);

    const response = await POST(
      makeRequest(validBody({ shareId: "a" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("no_recipients");
  });

  it("propagates a genuine idempotency-key conflict as 409", async () => {
    const { WithdrawalReallocationIdempotencyKeyConflictError } = await import("@niveshbook/core");
    recordReallocation.mockRejectedValue(new WithdrawalReallocationIdempotencyKeyConflictError());

    const response = await POST(
      makeRequest(validBody(), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("idempotency_key_conflict");
  });

  it("passes baseCanTake through to the port's record() call", async () => {
    await POST(
      makeRequest(validBody({ declinedAmount: "100000" }), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    const [input] = recordReallocation.mock.calls[0];
    // A's base Can Take is 250000 (50% of 500000, per resetMocks' default fixtures).
    expect(input.baseCanTake).toBe("250000");
  });

  it("returns 400 validation_error when the port's own lock-guarded re-check rejects a concurrent-decline race the route's own pre-check missed", async () => {
    const { WithdrawalReallocationExceedsAvailableError } = await import("@niveshbook/core");
    recordReallocation.mockRejectedValue(new WithdrawalReallocationExceedsAvailableError());

    const response = await POST(
      makeRequest(validBody(), `${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
  });
});

describe("GET /api/projects/[id]/withdrawal-reallocations", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest(), makeContext());
    expect(response.status).toBe(401);
  });

  it("returns 404 for a nonexistent project", async () => {
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
  });

  it("returns 200 with every active reallocation/allocation, unfiltered, for an owner_admin -- isOwnerAdminView: true", async () => {
    listActiveByProjectId.mockResolvedValue([
      { id: "realloc-1", partyType: "partner", shareId: "a" },
      { id: "realloc-2", partyType: "partner", shareId: "b" },
    ]);
    listActiveAllocationsByProjectId.mockResolvedValue([
      { id: "leg-1", reallocationId: "realloc-1", partyType: "partner", shareId: "b" },
      { id: "leg-2", reallocationId: "realloc-2", partyType: "partner", shareId: "c" },
    ]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isOwnerAdminView).toBe(true);
    expect(body.reallocations).toHaveLength(2);
    expect(body.allocations).toHaveLength(2);
  });

  it("scopes a Partner's own view to reallocations they declined or are a recipient of, and only their own legs -- isOwnerAdminView: false", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-1" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "30" }),
      makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "20" }),
    ]);
    listActiveByProjectId.mockResolvedValue([
      // Partner A (me) declined this one -- I should see it.
      { id: "realloc-1", partyType: "partner", shareId: "a" },
      // Partner B declined this one, and I (A) am a recipient -- I should see it.
      { id: "realloc-2", partyType: "partner", shareId: "b" },
      // Partner C declined this one, split only between B and C -- I have no stake, shouldn't see it.
      { id: "realloc-3", partyType: "partner", shareId: "c" },
    ]);
    listActiveAllocationsByProjectId.mockResolvedValue([
      { id: "leg-1", reallocationId: "realloc-1", partyType: "partner", shareId: "b" },
      { id: "leg-2", reallocationId: "realloc-1", partyType: "partner", shareId: "c" },
      { id: "leg-3", reallocationId: "realloc-2", partyType: "partner", shareId: "a" },
      { id: "leg-4", reallocationId: "realloc-2", partyType: "partner", shareId: "c" },
      { id: "leg-5", reallocationId: "realloc-3", partyType: "partner", shareId: "b" },
    ]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isOwnerAdminView).toBe(false);
    expect(body.reallocations.map((r: { id: string }) => r.id).sort()).toEqual(["realloc-1", "realloc-2"]);
    // Only my own leg on realloc-2 (leg-3) -- never B's or C's legs on either reallocation.
    expect(body.allocations.map((a: { id: string }) => a.id).sort()).toEqual(["leg-3"]);
  });

  it("returns an empty, scoped view for a Sub-partner with no stake in any active reallocation", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue({ ...PARTNER_USER, id: "sub-partner-user-1", role: "sub_partner" as const });
    listActiveByProjectId.mockResolvedValue([{ id: "realloc-1", partyType: "partner", shareId: "a" }]);
    listActiveAllocationsByProjectId.mockResolvedValue([
      { id: "leg-1", reallocationId: "realloc-1", partyType: "partner", shareId: "b" },
    ]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isOwnerAdminView).toBe(false);
    expect(body.reallocations).toEqual([]);
    expect(body.allocations).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const sumActiveAmountByProjectId = vi.fn();
const listWithdrawalTransactionsByProjectId = vi.fn();
const upsertAdjustment = vi.fn();

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
    listByProjectId: listWithdrawalTransactionsByProjectId,
  }),
  createWithdrawalAdjustmentPort: () => ({
    upsert: upsertAdjustment,
    listByProjectId: vi.fn(),
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/withdrawal-adjustments`, {
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

function makeWithdrawalTransactionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "wtx-1",
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50",
    canTakeSnapshot: "250000",
    amount: "0",
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    createdAt: now,
    ...overrides,
  };
}

/** Echoes the upsert input back as a full row -- mirrors `packages/core`'s own `withdrawal-adjustment.test.ts` fake port pattern. */
function makeUpsertImpl() {
  let counter = 0;
  return vi.fn(async (input: Record<string, unknown>) => {
    counter += 1;
    return {
      id: `adj-${counter}`,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      ...input,
    };
  });
}

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  sumActiveAmountByProjectId.mockReset();
  sumActiveAmountByProjectId.mockResolvedValue("250000");
  listWithdrawalTransactionsByProjectId.mockReset();
  listWithdrawalTransactionsByProjectId.mockResolvedValue([]);
  upsertAdjustment.mockReset();
  upsertAdjustment.mockImplementation(makeUpsertImpl());
}

describe("GET /api/projects/[id]/withdrawal-adjustments", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin, checked before any DB read", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(findProjectById).not.toHaveBeenCalled();
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 200 with Keep for Later for Partner B: Can Take 1,50,000, Taken 0", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    sumActiveAmountByProjectId.mockResolvedValue("150000");
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "100" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const b = body.partners.find((p: { partnerId: string }) => p.partnerId === "b");
    expect(b.canTake).toBe("150000");
    expect(b.taken).toBe("0");
    expect(b.adjustmentType).toBe("keep_for_later");
    expect(b.adjustmentAmount).toBe("150000");
  });

  it("returns 200 with no adjustment (none) for Partner A: Can Take 2,50,000, Taken 2,50,000", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
    ]);
    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-1", partyType: "partner", shareId: "a", amount: "250000" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const a = body.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(a.adjustmentType).toBe("none");
    expect(a.adjustmentAmount).toBe("0");
  });

  it("returns 200 with Extra Taken when Taken exceeds Can Take (accepted per Story 4.2's no-cap decision)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    sumActiveAmountByProjectId.mockResolvedValue("150000");
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
    ]);
    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-1", partyType: "partner", shareId: "a", amount: "300000" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const a = body.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(a.taken).toBe("300000");
    expect(a.adjustmentType).toBe("extra_taken");
    expect(a.adjustmentAmount).toBe("150000");
  });

  it("sums multiple Take Now transactions for one share: 50,000 + 25,000 = 75,000 Taken", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    sumActiveAmountByProjectId.mockResolvedValue("150000");
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
    ]);
    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-1", partyType: "partner", shareId: "a", amount: "50000" }),
      makeWithdrawalTransactionRow({ id: "wtx-2", partyType: "partner", shareId: "a", amount: "25000" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const a = body.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(a.taken).toBe("75000");
  });

  it("keys the ledger by (shareId, projectId), never requirementId -- upserts with the stable partnerId, not a funding requirement", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
    ]);

    await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(upsertAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, partyType: "partner", shareId: "a" }),
    );
    expect(upsertAdjustment.mock.calls[0]?.[0]).not.toHaveProperty("requirementId");
  });

  it("fetches every withdrawal transaction exactly once (never re-fetched per share)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", sharePercent: "50" }),
    ]);

    await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(listWithdrawalTransactionsByProjectId).toHaveBeenCalledTimes(1);
    expect(listWithdrawalTransactionsByProjectId).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("re-viewing with no new transactions in between upserts the identical row (no duplicate, no drift)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
    ]);
    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-1", partyType: "partner", shareId: "a", amount: "30000" }),
    ]);

    await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());
    await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(upsertAdjustment).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = upsertAdjustment.mock.calls;
    expect(firstCall?.[0]).toEqual(secondCall?.[0]);
  });

  it("a new Take Now recorded between two views changes the second view's Taken/adjustment", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
    ]);
    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-1", partyType: "partner", shareId: "a", amount: "50000" }),
    ]);

    const firstResponse = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());
    const firstBody = await firstResponse.json();

    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-1", partyType: "partner", shareId: "a", amount: "50000" }),
      makeWithdrawalTransactionRow({ id: "wtx-2", partyType: "partner", shareId: "a", amount: "100000" }),
    ]);

    const secondResponse = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());
    const secondBody = await secondResponse.json();

    const firstA = firstBody.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    const secondA = secondBody.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(firstA.taken).toBe("50000");
    expect(secondA.taken).toBe("150000");
  });

  it("Story 4.6 AC worked example: Partner A withdraws their full 1,25,000, Sub1 withdraws 0, Sub2 withdraws their full 62,500 -- Sub1 shows Keep for Later 62,500, Sub2 shows no adjustment, neither blocks nor forces the other", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    sumActiveAmountByProjectId.mockResolvedValue("125000");
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "Partner A", sharePercent: "100" }),
    ]);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", name: "Sub1", sharePercent: "50" }),
      makeSubPartnerShareRow({ subPartnerId: "sub-2", partnerId: "a", name: "Sub2", sharePercent: "50" }),
    ]);
    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-a", partyType: "partner", shareId: "a", amount: "125000" }),
      makeWithdrawalTransactionRow({ id: "wtx-sub2", partyType: "sub_partner", shareId: "sub-2", amount: "62500" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const a = body.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(a.canTake).toBe("125000");
    expect(a.taken).toBe("125000");
    expect(a.adjustmentType).toBe("none");

    const sub1 = a.subPartners.find((s: { subPartnerId: string }) => s.subPartnerId === "sub-1");
    expect(sub1.canTake).toBe("62500");
    expect(sub1.taken).toBe("0");
    expect(sub1.adjustmentType).toBe("keep_for_later");
    expect(sub1.adjustmentAmount).toBe("62500");

    const sub2 = a.subPartners.find((s: { subPartnerId: string }) => s.subPartnerId === "sub-2");
    expect(sub2.canTake).toBe("62500");
    expect(sub2.taken).toBe("62500");
    expect(sub2.adjustmentType).toBe("none");
    expect(sub2.adjustmentAmount).toBe("0");
  });

  it("returns 409 shares_not_fully_allocated when Partner Shares don't total 100%, before any upsert", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "40" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("shares_not_fully_allocated");
    expect(upsertAdjustment).not.toHaveBeenCalled();
  });

  it("returns 409 sub_partner_shares_over_allocated when a Partner's Sub-partners exceed their own share", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" }),
      makeSubPartnerShareRow({ subPartnerId: "sub2", partnerId: "a", sharePercent: "60" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("sub_partner_shares_over_allocated");
    expect(upsertAdjustment).not.toHaveBeenCalled();
  });
});

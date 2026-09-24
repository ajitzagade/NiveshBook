import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const listTransactionsByRequirementId = vi.fn();
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
  createInvestmentRequirementPort: () => ({
    createInvestmentRequirement: vi.fn(),
    listByProjectId: vi.fn(),
    findById,
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: listTransactionsByRequirementId,
  }),
  createInvestmentAdjustmentPort: () => ({
    upsert: upsertAdjustment,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const REQUIREMENT_ID = "0192f5a0-6666-7000-8000-000000000006";

function makeRequest(cookie?: string, requirementId: string = REQUIREMENT_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${requirementId}/adjustments`,
    { method: "GET", headers: cookie ? { Cookie: cookie } : undefined },
  );
}

function makeContext(id: string = PROJECT_ID, requirementId: string = REQUIREMENT_ID) {
  return { params: Promise.resolve({ id, requirementId }) };
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

const EXISTING_REQUIREMENT = {
  id: REQUIREMENT_ID,
  projectId: PROJECT_ID,
  amount: "500000",
  requirementDate: "2026-10-01",
  createdAt: new Date().toISOString(),
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

function makeTransactionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "tx-1",
    requirementId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "50",
    shouldPaySnapshot: "500000",
    amount: "500000",
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: now,
    ...overrides,
  };
}

/** Echoes the upsert input back as a full row -- mirrors `packages/core`'s own `investment-adjustment.test.ts` fake port pattern. */
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
  findById.mockReset();
  findById.mockResolvedValue(EXISTING_REQUIREMENT);
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  listTransactionsByRequirementId.mockReset();
  listTransactionsByRequirementId.mockResolvedValue([]);
  upsertAdjustment.mockReset();
  upsertAdjustment.mockImplementation(makeUpsertImpl());
}

describe("GET .../investment-requirements/[requirementId]/adjustments", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin, checked before any DB read", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(findProjectById).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent requirement id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findById.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 when the requirement belongs to a different project (cross-project mismatch)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, projectId: OTHER_PROJECT_ID });

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 200 with Extra Paid for Partner A: Should Pay 5,00,000, transactions summing to 7,00,000", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-1", partyType: "partner", shareId: "a", amount: "500000" }),
      makeTransactionRow({ id: "tx-2", partyType: "partner", shareId: "a", amount: "200000" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const a = body.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(a.shouldPay).toBe("500000");
    expect(a.actualPaid).toBe("700000");
    expect(a.adjustmentType).toBe("extra_paid");
    expect(a.adjustmentAmount).toBe("200000");
  });

  it("returns 200 with Pending for Partner C: Should Pay 2,00,000, no transactions recorded", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, amount: "200000" });
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "100" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const c = body.partners.find((p: { partnerId: string }) => p.partnerId === "c");
    expect(c.actualPaid).toBe("0");
    expect(c.adjustmentType).toBe("pending");
    expect(c.adjustmentAmount).toBe("200000");
  });

  it("returns identical Pending results whether zero transactions were recorded or one explicit amount:'0' transaction was", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, amount: "200000" });
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "100" }),
    ]);
    listTransactionsByRequirementId.mockResolvedValue([]);

    const noneRecordedResponse = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );
    const noneRecordedBody = await noneRecordedResponse.json();

    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-zero", partyType: "partner", shareId: "c", amount: "0" }),
    ]);

    const explicitZeroResponse = await GET(
      makeRequest(`${SESSION_COOKIE_NAME}=some-token`),
      makeContext(),
    );
    const explicitZeroBody = await explicitZeroResponse.json();

    const relevant = (body: typeof noneRecordedBody) => {
      const c = body.partners.find((p: { partnerId: string }) => p.partnerId === "c");
      return { actualPaid: c.actualPaid, adjustmentType: c.adjustmentType, adjustmentAmount: c.adjustmentAmount };
    };
    expect(relevant(noneRecordedBody)).toEqual(relevant(explicitZeroBody));
    expect(relevant(noneRecordedBody)).toEqual({
      actualPaid: "0",
      adjustmentType: "pending",
      adjustmentAmount: "200000",
    });
  });

  it("returns 200 with No Adjustment for Partner B: Should Pay 3,00,000, transactions summing to exactly 3,00,000", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, amount: "300000" });
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "100" }),
    ]);
    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-1", partyType: "partner", shareId: "b", amount: "300000" }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const b = body.partners.find((p: { partnerId: string }) => p.partnerId === "b");
    expect(b.adjustmentType).toBe("none");
    expect(b.adjustmentAmount).toBe("0");
  });

  it("keys the ledger by (shareId, projectId) -- never USER.id (AD-4): upserts with shareId as the stable partnerId, not the linked user's id", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100", userId: "partner-user-a" }),
    ]);

    await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(upsertAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        partyType: "partner",
        shareId: "a",
        requirementId: REQUIREMENT_ID,
      }),
    );
  });

  it("fetches this requirement's transactions exactly once (never re-fetched per share)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", sharePercent: "50" }),
    ]);

    await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(listTransactionsByRequirementId).toHaveBeenCalledTimes(1);
    expect(listTransactionsByRequirementId).toHaveBeenCalledWith(REQUIREMENT_ID);
  });

  it("re-viewing the same requirement with no new transactions in between upserts the identical row (no duplicate, no drift)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-1", partyType: "partner", shareId: "a", amount: "300000" }),
    ]);

    await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());
    await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(upsertAdjustment).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = upsertAdjustment.mock.calls;
    expect(firstCall?.[0]).toEqual(secondCall?.[0]);
  });

  it("a new transaction recorded between two views changes the second view's Actual Paid/adjustment", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-1", partyType: "partner", shareId: "a", amount: "300000" }),
    ]);

    const firstResponse = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());
    const firstBody = await firstResponse.json();

    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-1", partyType: "partner", shareId: "a", amount: "300000" }),
      makeTransactionRow({ id: "tx-2", partyType: "partner", shareId: "a", amount: "200000" }),
    ]);

    const secondResponse = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());
    const secondBody = await secondResponse.json();

    const firstA = firstBody.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    const secondA = secondBody.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    expect(firstA.actualPaid).toBe("300000");
    expect(firstA.adjustmentType).toBe("pending");
    expect(secondA.actualPaid).toBe("500000");
    expect(secondA.adjustmentType).toBe("none");
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

  it("Story 3.8: excludes a cancelled transaction and its reversal row from actualPaid -- only the still-active amount counts", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-1", partyType: "partner", shareId: "a", amount: "300000" }),
      makeTransactionRow({
        id: "tx-2",
        partyType: "partner",
        shareId: "a",
        amount: "200000",
        status: "cancelled",
      }),
      makeTransactionRow({
        id: "tx-2-reversal",
        partyType: "partner",
        shareId: "a",
        amount: "200000",
        status: "cancelled",
        reversalOfTransactionId: "tx-2",
      }),
    ]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    const a = body.partners.find((p: { partnerId: string }) => p.partnerId === "a");
    // Should Pay is 500000 (100% of 500000) -- only the still-active 300000 counts.
    expect(a.actualPaid).toBe("300000");
    expect(a.adjustmentType).toBe("pending");
    expect(a.adjustmentAmount).toBe("200000");
  });
});

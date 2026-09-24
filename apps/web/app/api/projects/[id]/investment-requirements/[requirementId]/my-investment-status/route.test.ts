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
const findRecommendedAmountsByRequirementId = vi.fn();

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
  createRecommendedAmountPort: () => ({
    snapshot: vi.fn(),
    snapshotAll: vi.fn(),
    findByRequirementId: findRecommendedAmountsByRequirementId,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const REQUIREMENT_ID = "0192f5a0-6666-7000-8000-000000000006";

function makeRequest(
  options: {
    cookie?: string;
    requirementId?: string;
    partyType?: string;
    shareId?: string;
    omitPartyType?: boolean;
    omitShareId?: boolean;
  } = {},
): NextRequest {
  const {
    cookie,
    requirementId = REQUIREMENT_ID,
    partyType = "partner",
    shareId = "a",
    omitPartyType = false,
    omitShareId = false,
  } = options;

  const params = new URLSearchParams();
  if (!omitPartyType) {
    params.set("partyType", partyType);
  }
  if (!omitShareId) {
    params.set("shareId", shareId);
  }

  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${requirementId}/my-investment-status?${params.toString()}`,
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

const SUB_PARTNER_1_USER = {
  id: "sub-partner-user-1",
  email: "sub-1@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "sub_partner" as const,
  active: true,
  canApproveExtraWithdrawal: false,
  createdAt: new Date().toISOString(),
};

const SUB_PARTNER_UNDER_B_USER = {
  id: "sub-partner-user-under-b",
  email: "sub-under-b@niveshbook.test",
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

const EXISTING_REQUIREMENT = {
  id: REQUIREMENT_ID,
  projectId: PROJECT_ID,
  amount: "1000000",
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

/** Echoes the upsert input back as a full row -- mirrors `adjustments/route.test.ts`'s fake port pattern. */
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
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "30", userId: "partner-user-b" }),
    makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "20", userId: null }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([
    makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", userId: "sub-partner-user-1" }),
    makeSubPartnerShareRow({
      subPartnerId: "sub-under-b",
      partnerId: "b",
      name: "SubB",
      userId: "sub-partner-user-under-b",
    }),
  ]);
  listTransactionsByRequirementId.mockReset();
  listTransactionsByRequirementId.mockResolvedValue([]);
  upsertAdjustment.mockReset();
  upsertAdjustment.mockImplementation(makeUpsertImpl());
  findRecommendedAmountsByRequirementId.mockReset();
  findRecommendedAmountsByRequirementId.mockResolvedValue([]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("GET .../investment-requirements/[requirementId]/my-investment-status", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }),
      makeContext("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed requirement id", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, requirementId: "not-a-uuid" }),
      makeContext(PROJECT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent requirement", async () => {
    ownerSession();
    findById.mockResolvedValue(null);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 404 when the requirement belongs to a different project (cross-project mismatch)", async () => {
    ownerSession();
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, projectId: OTHER_PROJECT_ID });

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when partyType is missing, before fetching shares", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, omitPartyType: true }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
    expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when partyType is neither 'partner' nor 'sub_partner'", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "owner" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 invalid_request when shareId is missing", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, omitShareId: true }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("returns 400 invalid_request when shareId is only whitespace", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "   " }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  it("trims incidental leading/trailing whitespace on shareId before matching against current shares (Review Triage Log row 4)", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "  a  " }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.partnerId).toBe("a");
  });

  it("returns 404 when shareId/partyType doesn't match any current share, before authorize() runs", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "nonexistent" }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("returns 403 for an unlinked share (userId: null) requested by a non-owner_admin caller", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "c" }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("returns 403 when a co-Partner (Partner B) attempts to view Partner A's status", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-b" });
    findUserById.mockResolvedValue(PARTNER_B_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("returns 403 when a Sub-partner under Partner B attempts to view a Sub-partner under Partner A", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-under-b" });
    findUserById.mockResolvedValue(SUB_PARTNER_UNDER_B_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-1" }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("returns 403 when a Sub-partner's own session attempts to view their PARENT Partner's status (self-access doesn't extend upward)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_PARTNER_1_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("returns 200 for an Owner/Admin viewing any share's status unconditionally", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "b" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.partyType).toBe("partner");
    expect(body.status.partnerId).toBe("b");
  });

  it("returns 200 for an Owner/Admin requesting partyType=sub_partner", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-1" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.partyType).toBe("sub_partner");
    expect(body.status.subPartnerId).toBe("sub-1");
  });

  it("returns 200 with subPartners: [] (not omitted) for a Partner with zero current Sub-partners", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "c" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.partnerId).toBe("c");
    expect(body.status.subPartners).toEqual([]);
  });

  it("returns 200 for Partner A viewing their own status (self-access)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.partnerId).toBe("a");
  });

  it("returns 200 for Sub-partner 1 viewing their own status (self-access)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_PARTNER_1_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-1" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.subPartnerId).toBe("sub-1");
  });

  it("AC worked example: Partner A's own view shows Extra Paid 1,25,000 with nested Sub1 Pending 1,25,000 and Sub2 No Adjustment", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, amount: "500000" });
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100", userId: "partner-user-a" }),
    ]);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({
        subPartnerId: "sub-1",
        partnerId: "a",
        name: "Sub1",
        sharePercent: "25",
        userId: "sub-partner-user-1",
      }),
      makeSubPartnerShareRow({ subPartnerId: "sub-2", partnerId: "a", name: "Sub2", sharePercent: "25" }),
    ]);
    // Own 2,50,000 / Sub1 1,25,000 / Sub2 1,25,000 Should Pay, matching the
    // AC exactly. `computeInvestmentAdjustment` (Story 3.4, frozen/unchanged
    // -- see `investment-adjustment.ts`'s own doc comment) compares a
    // Partner's own row against the AGGREGATE Should Pay (Own + all current
    // Sub-partners = 5,00,000 here), not Own alone -- so the Partner-row
    // payment recorded here is 6,25,000 (5,00,000 + the AC's stated 1,25,000
    // Extra Paid), rather than the AC's illustrative "Partner A pays
    // 3,75,000" (3,75,000 against the 5,00,000 aggregate would actually be
    // Pending, not Extra Paid). The AC's *outputs* -- Extra Paid 1,25,000 for
    // A, Pending 1,25,000 for Sub1, No Adjustment for Sub2 -- are reproduced
    // exactly below.
    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-a", partyType: "partner", shareId: "a", amount: "625000" }),
      makeTransactionRow({ id: "tx-sub2", partyType: "sub_partner", shareId: "sub-2", amount: "125000" }),
    ]);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.shouldPay).toBe("500000");
    expect(body.status.adjustmentType).toBe("extra_paid");
    expect(body.status.adjustmentAmount).toBe("125000");

    const sub1 = body.status.subPartners.find((s: { subPartnerId: string }) => s.subPartnerId === "sub-1");
    expect(sub1.shouldPay).toBe("125000");
    expect(sub1.adjustmentType).toBe("pending");
    expect(sub1.adjustmentAmount).toBe("125000");

    const sub2 = body.status.subPartners.find((s: { subPartnerId: string }) => s.subPartnerId === "sub-2");
    expect(sub2.shouldPay).toBe("125000");
    expect(sub2.adjustmentType).toBe("none");
    expect(sub2.adjustmentAmount).toBe("0");
  });

  it("a Sub-partner's own view returns ONLY their single entry -- no sibling data, no parent Partner data", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_PARTNER_1_USER);
    findById.mockResolvedValue({ ...EXISTING_REQUIREMENT, amount: "500000" });
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100", userId: "partner-user-a" }),
    ]);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({
        subPartnerId: "sub-1",
        partnerId: "a",
        name: "Sub1",
        sharePercent: "25",
        userId: "sub-partner-user-1",
      }),
      makeSubPartnerShareRow({ subPartnerId: "sub-2", partnerId: "a", name: "Sub2", sharePercent: "25" }),
    ]);
    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-a", partyType: "partner", shareId: "a", amount: "625000" }),
      makeTransactionRow({ id: "tx-sub2", partyType: "sub_partner", shareId: "sub-2", amount: "125000" }),
    ]);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-1" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toEqual({
      subPartnerId: "sub-1",
      name: "Sub1",
      sharePercent: "25",
      shouldPay: "125000",
      actualPaid: "0",
      adjustmentType: "pending",
      adjustmentAmount: "125000",
    });
    expect(body.status).not.toHaveProperty("partnerId");
    expect(body.status).not.toHaveProperty("subPartners");
  });

  it("Story 3.8: excludes a cancelled transaction and its reversal row from actualPaid -- only the still-active amount counts", async () => {
    ownerSession();
    // Partner A: 50% of 1,000,000 Should Pay -- 500,000.
    listTransactionsByRequirementId.mockResolvedValue([
      makeTransactionRow({ id: "tx-active", partyType: "partner", shareId: "a", amount: "500000" }),
      makeTransactionRow({
        id: "tx-cancelled",
        partyType: "partner",
        shareId: "a",
        amount: "300000",
        status: "cancelled",
      }),
      makeTransactionRow({
        id: "tx-cancelled-reversal",
        partyType: "partner",
        shareId: "a",
        amount: "300000",
        status: "cancelled",
        reversalOfTransactionId: "tx-cancelled",
      }),
    ]);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.shouldPay).toBe("500000");
    expect(body.status.actualPaid).toBe("500000");
    expect(body.status.adjustmentType).toBe("none");
  });

  it("returns 409 shares_not_fully_allocated when Partner Shares don't total 100%", async () => {
    ownerSession();
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "40", userId: "partner-user-b" }),
    ]);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("shares_not_fully_allocated");
  });

  it("returns 409 sub_partner_shares_over_allocated when a Partner's Sub-partners exceed their own share", async () => {
    ownerSession();
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" }),
      makeSubPartnerShareRow({ subPartnerId: "sub2", partnerId: "a", sharePercent: "60" }),
    ]);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("sub_partner_shares_over_allocated");
  });

  it("merges recommendedAmount/previousPending/previousExtraPaid into the returned entry when a snapshot exists for this requirement", async () => {
    ownerSession();
    findRecommendedAmountsByRequirementId.mockResolvedValue([
      {
        id: "ra-1",
        requirementId: REQUIREMENT_ID,
        projectId: PROJECT_ID,
        partyType: "partner",
        shareId: "a",
        baseAmount: "500000",
        previousPending: "0",
        previousExtraPaid: "200000",
        recommendedAmount: "300000",
        createdAt: new Date().toISOString(),
      },
    ]);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.recommendedAmount).toBe("300000");
    expect(body.status.previousPending).toBe("0");
    expect(body.status.previousExtraPaid).toBe("200000");
  });

  it("leaves recommendedAmount undefined for a pre-existing requirement with no recommended_amounts rows -- no error", async () => {
    ownerSession();
    findRecommendedAmountsByRequirementId.mockResolvedValue([]);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.recommendedAmount).toBeUndefined();
  });
});

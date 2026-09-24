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

function makeRequest(
  options: {
    cookie?: string;
    partyType?: string;
    shareId?: string;
    omitPartyType?: boolean;
    omitShareId?: boolean;
  } = {},
): NextRequest {
  const { cookie, partyType = "partner", shareId = "a", omitPartyType = false, omitShareId = false } =
    options;

  const params = new URLSearchParams();
  if (!omitPartyType) {
    params.set("partyType", partyType);
  }
  if (!omitShareId) {
    params.set("shareId", shareId);
  }

  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/my-withdrawal-status?${params.toString()}`,
    { method: "GET", headers: cookie ? { Cookie: cookie } : undefined },
  );
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

const SUB_1_USER = {
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

/** Echoes the upsert input back as a full row -- mirrors `withdrawal-adjustments/route.test.ts`'s fake port pattern. */
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
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "30", userId: "partner-user-b" }),
    makePartnerShareRow({ partnerId: "c", name: "C", sharePercent: "20", userId: null }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([
    makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", userId: "sub-partner-user-1" }),
  ]);
  sumActiveAmountByProjectId.mockReset();
  sumActiveAmountByProjectId.mockResolvedValue("250000");
  listWithdrawalTransactionsByProjectId.mockReset();
  listWithdrawalTransactionsByProjectId.mockResolvedValue([]);
  upsertAdjustment.mockReset();
  upsertAdjustment.mockImplementation(makeUpsertImpl());
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("GET /api/projects/[id]/my-withdrawal-status", () => {
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

  it("trims incidental leading/trailing whitespace on shareId before matching against current shares", async () => {
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

  it("returns 403 when a Sub-partner's own session attempts to view their PARENT Partner's status (self-access doesn't extend upward)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_1_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("returns 403 when a Sub-partner attempts to view a SIBLING Sub-partner under the same parent Partner (no sibling data exposure, per this story's Boundaries)", async () => {
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", userId: "sub-partner-user-1" }),
      makeSubPartnerShareRow({ subPartnerId: "sub-2", partnerId: "a", userId: "sub-partner-user-2" }),
    ]);
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_1_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-2" }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("returns 403 for a cross-branch attempt -- a Sub-partner under Partner A viewing a Sub-partner under a DIFFERENT Partner (B)", async () => {
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", userId: "sub-partner-user-1" }),
      makeSubPartnerShareRow({ subPartnerId: "sub-under-b", partnerId: "b", userId: "sub-partner-user-under-b" }),
    ]);
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_1_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-under-b" }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("returns 200 for an Owner/Admin viewing a share with userId: null (unlinked) -- unlike a non-owner_admin caller, which is denied", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "c" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.partnerId).toBe("c");
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
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "b" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.partnerId).toBe("b");
    expect(body.status.subPartners).toEqual([]);
  });

  it("returns 200 for Partner A viewing their own status (self-access), including nested current Sub-partners", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.partnerId).toBe("a");
    expect(body.status.subPartners).toHaveLength(1);
    expect(body.status.subPartners[0].subPartnerId).toBe("sub-1");
  });

  it("returns 200 for Sub-partner 1 viewing their own status (self-access) -- only their single entry, no sibling/parent data", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_1_USER);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-1" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.subPartnerId).toBe("sub-1");
    expect(body.status).not.toHaveProperty("partnerId");
    expect(body.status).not.toHaveProperty("subPartners");
  });

  it("AC worked example: Partner A withdraws their full 1,25,000, Sub1 withdraws 0, Sub2 withdraws their full 62,500 -- Sub1's own view shows Keep for Later 62,500", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
    findUserById.mockResolvedValue(SUB_1_USER);
    sumActiveAmountByProjectId.mockResolvedValue("125000");
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "Partner A", sharePercent: "100", userId: "partner-user-a" }),
    ]);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({
        subPartnerId: "sub-1",
        partnerId: "a",
        name: "Sub1",
        sharePercent: "50",
        userId: "sub-partner-user-1",
      }),
      makeSubPartnerShareRow({ subPartnerId: "sub-2", partnerId: "a", name: "Sub2", sharePercent: "50" }),
    ]);
    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-a", partyType: "partner", shareId: "a", amount: "125000" }),
      makeWithdrawalTransactionRow({ id: "wtx-sub2", partyType: "sub_partner", shareId: "sub-2", amount: "62500" }),
    ]);

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-1" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.canTake).toBe("62500");
    expect(body.status.taken).toBe("0");
    expect(body.status.adjustmentType).toBe("keep_for_later");
    expect(body.status.adjustmentAmount).toBe("62500");
  });

  it("AC worked example: Sub2's own view shows no adjustment -- neither blocks nor forces Sub1's independent Keep for Later", async () => {
    sumActiveAmountByProjectId.mockResolvedValue("125000");
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "Partner A", sharePercent: "100", userId: "partner-user-a" }),
    ]);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", name: "Sub1", sharePercent: "50" }),
      makeSubPartnerShareRow({
        subPartnerId: "sub-2",
        partnerId: "a",
        name: "Sub2",
        sharePercent: "50",
        userId: "sub-partner-user-2",
      }),
    ]);
    listWithdrawalTransactionsByProjectId.mockResolvedValue([
      makeWithdrawalTransactionRow({ id: "wtx-a", partyType: "partner", shareId: "a", amount: "125000" }),
      makeWithdrawalTransactionRow({ id: "wtx-sub2", partyType: "sub_partner", shareId: "sub-2", amount: "62500" }),
    ]);
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-2" });
    findUserById.mockResolvedValue({ ...SUB_1_USER, id: "sub-partner-user-2" });

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "sub_partner", shareId: "sub-2" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status.canTake).toBe("62500");
    expect(body.status.taken).toBe("62500");
    expect(body.status.adjustmentType).toBe("none");
    expect(body.status.adjustmentAmount).toBe("0");
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

  it("upserts withdrawal_adjustments on view, same side effect as withdrawal-adjustments/route.ts, not a new one", async () => {
    ownerSession();

    await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, partyType: "partner", shareId: "a" }),
      makeContext(),
    );

    expect(upsertAdjustment).toHaveBeenCalled();
  });
});

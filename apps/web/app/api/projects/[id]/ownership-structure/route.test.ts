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
const investmentListAll = vi.fn();
const listWithdrawalTransactionsByProjectId = vi.fn();

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
    listAll: vi.fn(),
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    cancelTransaction: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    listAll: investmentListAll,
    findByReversalOfTransactionId: vi.fn(),
  }),
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByProjectId: listWithdrawalTransactionsByProjectId,
    sumActiveAmountByProjectId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    cancelTransaction: vi.fn(),
    listAll: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    findByReversalOfTransactionId: vi.fn(),
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-4444-7000-8000-000000000099";

function makeRequest(query: Record<string, string> = {}, cookie?: string): NextRequest {
  const params = new URLSearchParams(query);
  const qs = params.toString();
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/ownership-structure${qs ? `?${qs}` : ""}`,
    { method: "GET", headers: cookie ? { Cookie: cookie } : undefined },
  );
}

function makeContext(id: string = PROJECT_ID) {
  return { params: Promise.resolve({ id }) };
}

const COOKIE = `${SESSION_COOKIE_NAME}=t`;

const LIVE_SESSION = {
  id: "session-1",
  userId: "owner-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "owner-1",
    email: "owner@niveshbook.test",
    passwordHash: "hash-should-never-leave-server",
    role: "owner_admin" as const,
    active: true,
    canApproveExtraWithdrawal: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

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
    partnerId: "a",
    projectId: PROJECT_ID,
    name: "Partner A",
    sharePercent: "60",
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
    partnerId: "a",
    projectId: PROJECT_ID,
    name: "Sub 1",
    sharePercent: "25",
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeInvestmentTransactionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "itx-1",
    requirementId: "req-1",
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "a",
    sharePercentSnapshot: "60",
    shouldPaySnapshot: "0",
    amount: "1000",
    transactionDate: "2026-01-01",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
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
    sharePercentSnapshot: "60",
    canTakeSnapshot: "0",
    amount: "300",
    transactionDate: "2026-01-01",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: now,
    ...overrides,
  };
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
    makePartnerShareRow({ partnerId: "a", name: "Partner A", sharePercent: "60", userId: "partner-user-a" }),
    makePartnerShareRow({ partnerId: "b", name: "Partner B", sharePercent: "40", userId: "partner-user-b" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([
    makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", userId: "sub-partner-user-1" }),
  ]);
  investmentListAll.mockReset();
  investmentListAll.mockResolvedValue([]);
  listWithdrawalTransactionsByProjectId.mockReset();
  listWithdrawalTransactionsByProjectId.mockResolvedValue([]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(makeUser());
}

function partnerASession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
  findUserById.mockResolvedValue(makeUser({ id: "partner-user-a", role: "partner" }));
}

function partnerBSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-b" });
  findUserById.mockResolvedValue(makeUser({ id: "partner-user-b", role: "partner" }));
}

function subPartner1Session() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "sub-partner-user-1" });
  findUserById.mockResolvedValue(makeUser({ id: "sub-partner-user-1", role: "sub_partner" }));
}

describe("GET /api/projects/[id]/ownership-structure", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();
    const response = await GET(makeRequest({}, COOKIE), makeContext("not-a-uuid"));
    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);
    const response = await GET(makeRequest({}, COOKIE), makeContext());
    expect(response.status).toBe(404);
  });

  it("returns 400 invalid_request when both partnerId and subPartnerId are given", async () => {
    ownerSession();
    const response = await GET(makeRequest({ partnerId: "a", subPartnerId: "sub-1" }, COOKIE), makeContext());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });

  describe("unscoped project-wide view (ownership_structure:view_project)", () => {
    it("returns 403 for a partner requesting the unscoped view, regardless of anything else in the URL (property 1)", async () => {
      partnerASession();
      const response = await GET(makeRequest({}, COOKIE), makeContext());
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("forbidden");
      expect(listPartnerSharesByProjectId).not.toHaveBeenCalled();
    });

    it("returns 403 for a sub_partner requesting the unscoped view", async () => {
      subPartner1Session();
      const response = await GET(makeRequest({}, COOKIE), makeContext());
      expect(response.status).toBe(403);
    });

    it("returns 200 for owner_admin, with every current Partner Share and its Sub-partners in the tree", async () => {
      ownerSession();
      const response = await GET(makeRequest({}, COOKIE), makeContext());
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.tree.scope).toEqual({ type: "project" });
      expect(body.tree.partners).toHaveLength(2);
      const partnerA = body.tree.partners.find((p: { partnerId: string }) => p.partnerId === "a");
      expect(partnerA.subPartners).toHaveLength(1);
    });

    it("returns an EmptyState-ready empty tree for a Project with zero current Partner Shares (I/O matrix row 10)", async () => {
      ownerSession();
      listPartnerSharesByProjectId.mockResolvedValue([]);
      const response = await GET(makeRequest({}, COOKIE), makeContext());
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.tree.partners).toEqual([]);
    });
  });

  describe("partner-scoped view (ownership_structure:view_partner)", () => {
    it("returns 404 when partnerId doesn't match any current Partner Share on this Project", async () => {
      ownerSession();
      const response = await GET(makeRequest({ partnerId: "nonexistent" }, COOKIE), makeContext());
      expect(response.status).toBe(404);
    });

    it("returns 403 when a different Partner (B) requests Partner A's scoped view (property 2)", async () => {
      partnerBSession();
      const response = await GET(makeRequest({ partnerId: "a" }, COOKIE), makeContext());
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("forbidden");
    });

    it("returns 401 (not 403) for an unauthenticated request to a Partner-scoped URL -- no-session always maps to 401 here, matching every other route in this codebase; the frozen I/O matrix's literal '403' wording for this row is reconciled in this story's own Spec Change Log", async () => {
      const response = await GET(makeRequest({ partnerId: "a" }), makeContext());
      expect(response.status).toBe(401);
    });

    it("returns 200 for owner_admin viewing any Partner's scoped slice unconditionally", async () => {
      ownerSession();
      const response = await GET(makeRequest({ partnerId: "b" }, COOKIE), makeContext());
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.tree.scope).toEqual({ type: "partner", partnerId: "b" });
      expect(body.tree.partners).toHaveLength(1);
      expect(body.tree.partners[0].partnerId).toBe("b");
    });

    it("returns 200 for Partner A viewing their own scoped slice (self-access), and it never includes Partner B's data anywhere", async () => {
      partnerASession();
      investmentListAll.mockResolvedValue([
        makeInvestmentTransactionRow({ partyType: "partner", shareId: "a", amount: "1000" }),
        // Partner B carries a large, distinctly different amount -- must never leak into Partner A's response.
        makeInvestmentTransactionRow({ partyType: "partner", shareId: "b", amount: "88888888" }),
      ]);

      const response = await GET(makeRequest({ partnerId: "a" }, COOKIE), makeContext());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.tree.partners).toHaveLength(1);
      expect(body.tree.partners[0].partnerId).toBe("a");
      expect(body.tree.partners[0].actualAmount).toBe("1000");
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("Partner B");
      expect(serialized).not.toContain("88888888");
    });

    it("a Partner with zero current Sub-partners renders as a leaf, subPartners: [] (I/O matrix row 9)", async () => {
      ownerSession();
      const response = await GET(makeRequest({ partnerId: "b" }, COOKIE), makeContext());
      const body = await response.json();
      expect(body.tree.partners[0].subPartners).toEqual([]);
    });

    it("only counts status: active transactions toward Actual Amount/Money Flow (property 5)", async () => {
      ownerSession();
      investmentListAll.mockResolvedValue([
        makeInvestmentTransactionRow({ shareId: "a", amount: "1000", status: "active" }),
        makeInvestmentTransactionRow({ shareId: "a", amount: "9999", status: "cancelled" }),
      ]);
      listWithdrawalTransactionsByProjectId.mockResolvedValue([
        makeWithdrawalTransactionRow({ shareId: "a", amount: "300", status: "active" }),
        makeWithdrawalTransactionRow({ shareId: "a", amount: "7777", status: "cancelled" }),
      ]);

      const response = await GET(makeRequest({ partnerId: "a" }, COOKIE), makeContext());
      const body = await response.json();

      expect(body.tree.partners[0].actualAmount).toBe("1000");
      expect(body.tree.partners[0].totalIn).toBe("1000");
      expect(body.tree.partners[0].totalOut).toBe("300");
    });

    it("only counts transactions belonging to this Project", async () => {
      ownerSession();
      investmentListAll.mockResolvedValue([
        makeInvestmentTransactionRow({ shareId: "a", amount: "1000", projectId: PROJECT_ID }),
        makeInvestmentTransactionRow({ shareId: "a", amount: "5000", projectId: OTHER_PROJECT_ID }),
      ]);

      const response = await GET(makeRequest({ partnerId: "a" }, COOKIE), makeContext());
      const body = await response.json();

      expect(body.tree.partners[0].actualAmount).toBe("1000");
    });
  });

  describe("sub_partner-scoped view (ownership_structure:view_partner, narrower slice)", () => {
    it("returns 404 when subPartnerId doesn't match any current Sub-partner Share on this Project", async () => {
      ownerSession();
      const response = await GET(makeRequest({ subPartnerId: "nonexistent" }, COOKIE), makeContext());
      expect(response.status).toBe(404);
    });

    it("returns 200 for Sub-partner 1 viewing their own scope -- only themselves, no siblings (property 3)", async () => {
      subPartner1Session();
      listSubPartnerSharesByProjectId.mockResolvedValue([
        makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", name: "Sub 1", userId: "sub-partner-user-1" }),
        makeSubPartnerShareRow({ subPartnerId: "sub-2", partnerId: "a", name: "Sub 2" }),
      ]);
      investmentListAll.mockResolvedValue([
        makeInvestmentTransactionRow({ partyType: "sub_partner", shareId: "sub-1", amount: "500" }),
        makeInvestmentTransactionRow({ partyType: "sub_partner", shareId: "sub-2", amount: "77777777" }),
      ]);

      const response = await GET(makeRequest({ subPartnerId: "sub-1" }, COOKIE), makeContext());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.tree.partners).toEqual([]);
      expect(body.tree.soloSubPartner.subPartnerId).toBe("sub-1");
      expect(body.tree.soloSubPartner.actualAmount).toBe("500");
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("Sub 2");
      expect(serialized).not.toContain("77777777");
      expect(serialized).not.toContain("Partner A");
    });

    it("returns 403 when a Sub-partner requests a SIBLING Sub-partner's scoped view under the same parent Partner", async () => {
      listSubPartnerSharesByProjectId.mockResolvedValue([
        makeSubPartnerShareRow({ subPartnerId: "sub-1", partnerId: "a", userId: "sub-partner-user-1" }),
        makeSubPartnerShareRow({ subPartnerId: "sub-2", partnerId: "a", userId: "sub-partner-user-2" }),
      ]);
      subPartner1Session();

      const response = await GET(makeRequest({ subPartnerId: "sub-2" }, COOKIE), makeContext());

      expect(response.status).toBe(403);
    });
  });
});

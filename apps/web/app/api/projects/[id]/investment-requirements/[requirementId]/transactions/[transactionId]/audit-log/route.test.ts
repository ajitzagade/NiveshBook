import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const findRequirementById = vi.fn();
const findTransactionById = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const findAuditLogByTransactionId = vi.fn();

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
    findById: findRequirementById,
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: vi.fn(),
    findById: findTransactionById,
    editTransaction: vi.fn(),
    findAuditLogByTransactionId,
  }),
}));

const PROJECT_ID = "0192f5a0-4444-7000-8000-000000000004";
const OTHER_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const REQUIREMENT_ID = "0192f5a0-6666-7000-8000-000000000006";
const OTHER_REQUIREMENT_ID = "0192f5a0-7777-7000-8000-000000000007";
const TRANSACTION_ID = "0192f5a0-8888-7000-8000-000000000008";

function makeRequest(options: { cookie?: string; transactionId?: string } = {}): NextRequest {
  const { cookie, transactionId = TRANSACTION_ID } = options;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/investment-requirements/${REQUIREMENT_ID}/transactions/${transactionId}/audit-log`,
    { method: "GET", headers: cookie ? { Cookie: cookie } : undefined },
  );
}

function makeContext(
  id: string = PROJECT_ID,
  requirementId: string = REQUIREMENT_ID,
  transactionId: string = TRANSACTION_ID,
) {
  return { params: Promise.resolve({ id, requirementId, transactionId }) };
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

// The transaction under audit belongs to Partner A (`shareId: "a"`, `userId: "partner-user-a"`).
const EXISTING_TRANSACTION = {
  id: TRANSACTION_ID,
  requirementId: REQUIREMENT_ID,
  projectId: PROJECT_ID,
  partyType: "partner",
  shareId: "a",
  sharePercentSnapshot: "50",
  shouldPaySnapshot: "500000",
  amount: "750000",
  transactionDate: "2026-10-06",
  paymentMode: "upi",
  referenceNumber: "REF-2",
  notes: "corrected",
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

const AUDIT_ENTRIES = [
  {
    id: "audit-1",
    entityType: "investment_transaction",
    entityId: TRANSACTION_ID,
    action: "create",
    actorUserId: "owner-1",
    oldValue: null,
    newValue: { ...EXISTING_TRANSACTION, amount: "700000" },
    reason: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: "audit-2",
    entityType: "investment_transaction",
    entityId: TRANSACTION_ID,
    action: "edit",
    actorUserId: "owner-1",
    oldValue: { ...EXISTING_TRANSACTION, amount: "700000" },
    newValue: EXISTING_TRANSACTION,
    reason: "typo'd the original amount",
    createdAt: new Date().toISOString(),
  },
];

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  findRequirementById.mockReset();
  findRequirementById.mockResolvedValue(EXISTING_REQUIREMENT);
  findTransactionById.mockReset();
  findTransactionById.mockResolvedValue(EXISTING_TRANSACTION);
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([
    makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50", userId: "partner-user-a" }),
    makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "50", userId: "partner-user-b" }),
  ]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  findAuditLogByTransactionId.mockReset();
  findAuditLogByTransactionId.mockResolvedValue(AUDIT_ENTRIES);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

describe("GET .../transactions/[transactionId]/audit-log", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id", async () => {
    ownerSession();

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(findRequirementById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent requirement", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue(null);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 when the requirement belongs to a different project", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue({ ...EXISTING_REQUIREMENT, projectId: OTHER_PROJECT_ID });

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed transaction id", async () => {
    ownerSession();

    const response = await GET(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }),
      makeContext(PROJECT_ID, REQUIREMENT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(findTransactionById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent transaction", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue(null);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(findAuditLogByTransactionId).not.toHaveBeenCalled();
  });

  it("returns 404 when the transaction belongs to a different requirement (cross-requirement mismatch)", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue({ ...EXISTING_TRANSACTION, requirementId: OTHER_REQUIREMENT_ID });

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(findAuditLogByTransactionId).not.toHaveBeenCalled();
  });

  it("returns 404 when the transaction belongs to a different project", async () => {
    ownerSession();
    findTransactionById.mockResolvedValue({ ...EXISTING_TRANSACTION, projectId: OTHER_PROJECT_ID });

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(404);
    expect(findAuditLogByTransactionId).not.toHaveBeenCalled();
  });

  it("returns 200 with every audit entry for an owner_admin", async () => {
    ownerSession();

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entries: AUDIT_ENTRIES });
  });

  it("returns 200 for the transaction's own linked Partner (self-access)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-a" });
    findUserById.mockResolvedValue(PARTNER_A_USER);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entries: AUDIT_ENTRIES });
  });

  it("returns 403 for a co-Partner not linked to this transaction's own share", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-b" });
    findUserById.mockResolvedValue(PARTNER_B_USER);

    const response = await GET(makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t` }), makeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(findAuditLogByTransactionId).not.toHaveBeenCalled();
  });
});

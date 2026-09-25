import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  AvailableBalanceSpendIdempotencyKeyConflictError,
  InsufficientAvailableBalanceError,
  ShareNotFoundError,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
} from "@niveshbook/core";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const recordSpend = vi.fn();
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
  createAvailableBalanceSpendPort: () => ({
    recordSpend,
  }),
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
const DESTINATION_PROJECT_ID = "0192f5a0-5555-7000-8000-000000000005";
const DESTINATION_REQUIREMENT_ID = "0192f5a0-7777-7000-8000-000000000007";
const DESTINATION_PARTNER_ID = "0192f5a0-8888-7000-8000-000000000008";
const SHARE_ID = "0192f5a0-9999-7000-8000-000000000009";

function makeRequest(options: { cookie?: string; body?: unknown } = {}): NextRequest {
  const { cookie, body } = options;
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/available-balance/spend`, {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  name: "Source Project",
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const DESTINATION_PROJECT = {
  id: DESTINATION_PROJECT_ID,
  name: "Destination Project",
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const DESTINATION_REQUIREMENT = {
  id: DESTINATION_REQUIREMENT_ID,
  projectId: DESTINATION_PROJECT_ID,
  amount: "1000000",
  requirementDate: "2026-10-01",
  createdAt: new Date().toISOString(),
};

function makePartnerShareRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "share-row-1",
    partnerId: DESTINATION_PARTNER_ID,
    projectId: DESTINATION_PROJECT_ID,
    name: "Destination Partner",
    sharePercent: "100",
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function personBody(overrides: Record<string, unknown> = {}) {
  return {
    partyType: "partner",
    shareId: SHARE_ID,
    destinationType: "person",
    amount: "20000",
    personName: "Person X",
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

const SAVED_SPEND = {
  id: "spend-1",
  sourceProjectId: PROJECT_ID,
  partyType: "partner",
  shareId: SHARE_ID,
  destinationType: "person",
  destinationProjectId: null,
  destinationRequirementId: null,
  destinationShareId: null,
  destinationPartyType: null,
  personName: "Person X",
  amount: "20000.00",
  notes: null,
  createdAt: new Date().toISOString(),
};

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockImplementation(async (id: string) => {
    if (id === PROJECT_ID) return EXISTING_PROJECT;
    if (id === DESTINATION_PROJECT_ID) return DESTINATION_PROJECT;
    return null;
  });
  recordSpend.mockReset();
  recordSpend.mockResolvedValue({ spend: SAVED_SPEND, investmentTransaction: null, moneyMovement: null, created: true });
  findRequirementById.mockReset();
  findRequirementById.mockResolvedValue(DESTINATION_REQUIREMENT);
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([makePartnerShareRow()]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
}

function ownerSession() {
  findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  findUserById.mockResolvedValue(OWNER_USER);
}

function partnerSession() {
  findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: PARTNER_USER.id });
  findUserById.mockResolvedValue(PARTNER_USER);
}

describe("POST .../available-balance/spend (Story 4.9, FR29)", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(makeRequest({ body: personBody() }), makeContext());

    expect(response.status).toBe(401);
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-Owner/Admin session (no self-access)", async () => {
    partnerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody() }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("review finding (AD-1): never touches the DB (findProjectById) before authorization -- an unauthorized caller can't distinguish a real project from a nonexistent one", async () => {
    partnerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody() }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(findProjectById).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent source project", async () => {
    ownerSession();
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("returns 400 invalid_request for a malformed body (missing idempotencyKey)", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: { ...personBody(), idempotencyKey: undefined } }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for a zero amount", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody({ amount: "0" }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for a malformed amount", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody({ amount: "not-a-number" }) }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
  });

  it("saves a 'person' spend and returns 201 -- no destination Project lookups performed", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody() }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.spend).toEqual(SAVED_SPEND);
    expect(recordSpend).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceProjectId: PROJECT_ID,
        partyType: "partner",
        shareId: SHARE_ID,
        destinationType: "person",
        amount: "20000",
        personName: "Person X",
        destinationSnapshotInput: null,
      }),
      "idem-1",
      "owner-1",
    );
  });

  it("returns 200 (not 201) on an idempotent replay", async () => {
    ownerSession();
    recordSpend.mockResolvedValue({ spend: SAVED_SPEND, investmentTransaction: null, moneyMovement: null, created: false });

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody() }),
      makeContext(),
    );

    expect(response.status).toBe(200);
  });

  it("returns 409 insufficient_balance when the port throws InsufficientAvailableBalanceError (AC3)", async () => {
    ownerSession();
    recordSpend.mockRejectedValue(new InsufficientAvailableBalanceError("10000" as never, "20000" as never));

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("insufficient_balance");
  });

  it("returns 409 idempotency_key_conflict when the port throws AvailableBalanceSpendIdempotencyKeyConflictError", async () => {
    ownerSession();
    recordSpend.mockRejectedValue(new AvailableBalanceSpendIdempotencyKeyConflictError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: personBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_conflict");
  });

  function projectBody(overrides: Record<string, unknown> = {}) {
    return {
      partyType: "partner",
      shareId: SHARE_ID,
      destinationType: "project",
      amount: "30000",
      destinationProjectId: DESTINATION_PROJECT_ID,
      destinationRequirementId: DESTINATION_REQUIREMENT_ID,
      destinationShareId: DESTINATION_PARTNER_ID,
      destinationPartyType: "partner",
      idempotencyKey: "idem-2",
      ...overrides,
    };
  }

  it("allows a 'project' destination equal to the SOURCE Project itself -- no InvalidDestinationProjectError-style restriction (this story's Decisions #1)", async () => {
    ownerSession();
    // Destination Project id IS the source Project id.
    findRequirementById.mockResolvedValue({ ...DESTINATION_REQUIREMENT, projectId: PROJECT_ID });
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: DESTINATION_PARTNER_ID, projectId: PROJECT_ID }),
    ]);

    const response = await POST(
      makeRequest({
        cookie: `${SESSION_COOKIE_NAME}=t`,
        body: projectBody({ destinationProjectId: PROJECT_ID }),
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    expect(recordSpend).toHaveBeenCalled();
  });

  it("returns 400 validation_error when the 'project' destination doesn't exist", async () => {
    ownerSession();
    findProjectById.mockImplementation(async (id: string) => (id === PROJECT_ID ? EXISTING_PROJECT : null));

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: projectBody() }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation_error");
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when destinationRequirementId doesn't resolve at the destination Project", async () => {
    ownerSession();
    findRequirementById.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: projectBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("returns 404 not_found when destinationShareId isn't a current share at the destination Project", async () => {
    ownerSession();
    listPartnerSharesByProjectId.mockResolvedValue([]);

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: projectBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("saves a 'project' spend with a resolved destinationSnapshotInput and returns 201", async () => {
    ownerSession();

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: projectBody() }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    expect(recordSpend).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationType: "project",
        destinationProjectId: DESTINATION_PROJECT_ID,
        destinationRequirementId: DESTINATION_REQUIREMENT_ID,
        destinationShareId: DESTINATION_PARTNER_ID,
        destinationPartyType: "partner",
        destinationSnapshotInput: expect.objectContaining({ requirement: DESTINATION_REQUIREMENT }),
      }),
      "idem-2",
      "owner-1",
    );
  });

  it("returns 409 shares_not_fully_allocated when spendAvailableBalanceToProject's own precondition fails (defense-in-depth race)", async () => {
    ownerSession();
    recordSpend.mockRejectedValue(new SharesNotFullyAllocatedError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: projectBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("shares_not_fully_allocated");
  });

  it("returns 409 sub_partner_shares_over_allocated when spendAvailableBalanceToProject's own precondition fails", async () => {
    ownerSession();
    recordSpend.mockRejectedValue(new SubPartnerSharesOverAllocatedError("A"));

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: projectBody() }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("sub_partner_shares_over_allocated");
  });

  it("returns 404 not_found when spendAvailableBalanceToProject throws ShareNotFoundError (defense-in-depth race)", async () => {
    ownerSession();
    recordSpend.mockRejectedValue(new ShareNotFoundError());

    const response = await POST(
      makeRequest({ cookie: `${SESSION_COOKIE_NAME}=t`, body: projectBody() }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });
});

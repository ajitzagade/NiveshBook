import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findProjectById = vi.fn();
const createInvestmentRequirement = vi.fn();
const listByProjectId = vi.fn();
const listPartnerSharesByProjectId = vi.fn();
const listSubPartnerSharesByProjectId = vi.fn();
const listAdjustmentsByProjectId = vi.fn();
const upsertAdjustment = vi.fn();
const snapshotAllRecommendedAmounts = vi.fn();
const listTransactionsByRequirementId = vi.fn();

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
  createInvestmentRequirementPort: () => ({
    createInvestmentRequirement,
    listByProjectId,
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
  createInvestmentAdjustmentPort: () => ({
    upsert: upsertAdjustment,
    listByProjectId: listAdjustmentsByProjectId,
  }),
  createRecommendedAmountPort: () => ({
    snapshotAll: snapshotAllRecommendedAmounts,
    findByRequirementId: vi.fn(),
  }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    editTransaction: vi.fn(),
    cancelTransaction: vi.fn(),
    findReversalRow: vi.fn(),
    listByRequirementId: listTransactionsByRequirementId,
    listAuditLogEntries: vi.fn(),
  }),
}));

const PROJECT_ID = "0192f5a0-3333-7000-8000-000000000003";

function makeGetRequest(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/investment-requirements`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function makePostRequest(options: { cookie?: string; body?: unknown; rawBody?: string }): NextRequest {
  const { cookie, body, rawBody } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/investment-requirements`, {
    method: "POST",
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
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

function makeRequirement(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    projectId: PROJECT_ID,
    amount: "1000000",
    requirementDate: "2026-10-01",
    createdAt: now,
    ...overrides,
  };
}

function makePartnerShareRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "share-row-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
    name: "A",
    sharePercent: "100",
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeAdjustmentRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "adj-row-1",
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "partner-1",
    requirementId: "prev-req",
    shouldPay: "500000",
    actualPaid: "500000",
    adjustmentType: "none",
    adjustmentAmount: "0",
    updatedAt: now,
    createdAt: now,
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

function resetMocks() {
  findSessionByTokenHash.mockReset();
  touchSession.mockReset();
  touchSession.mockResolvedValue(1);
  findUserById.mockReset();
  findProjectById.mockReset();
  findProjectById.mockResolvedValue(EXISTING_PROJECT);
  createInvestmentRequirement.mockReset();
  listByProjectId.mockReset();
  listByProjectId.mockResolvedValue([]);

  // Story 3.5's additive snapshot step -- a single fully-allocated Partner
  // by default (so `snapshotRecommendedAmounts`'s own `computeShouldPay`
  // precondition passes and the snapshot flow actually runs in the
  // "creates a requirement" happy-path test below), no prior adjustments
  // (first-ever-requirement case).
  listPartnerSharesByProjectId.mockReset();
  listPartnerSharesByProjectId.mockResolvedValue([makePartnerShareRow()]);
  listSubPartnerSharesByProjectId.mockReset();
  listSubPartnerSharesByProjectId.mockResolvedValue([]);
  listAdjustmentsByProjectId.mockReset();
  listAdjustmentsByProjectId.mockResolvedValue([]);
  upsertAdjustment.mockReset();
  upsertAdjustment.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "adj-upserted",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...input,
  }));
  listTransactionsByRequirementId.mockReset();
  listTransactionsByRequirementId.mockResolvedValue([]);
  snapshotAllRecommendedAmounts.mockReset();
  snapshotAllRecommendedAmounts.mockImplementation(async (inputs: Record<string, unknown>[]) =>
    inputs.map((input, index) => ({
      id: `ra-${index + 1}`,
      createdAt: new Date().toISOString(),
      ...input,
    })),
  );
}

describe("GET /api/projects/[id]/investment-requirements", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeGetRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(listByProjectId).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner_admin, no data leaked", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(listByProjectId).not.toHaveBeenCalled();
  });

  it("returns 200 with an empty list for a project with no requirements yet", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByProjectId.mockResolvedValue([]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ requirements: [] });
  });

  it("returns 200 with the full list for an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listByProjectId.mockResolvedValue([makeRequirement(), makeRequirement({ id: "row-2" })]);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requirements).toHaveLength(2);
  });

  it("returns 404 for a nonexistent project, rather than silently returning an empty list", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await GET(makeGetRequest(`${SESSION_COOKIE_NAME}=some-token`), makeContext());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(listByProjectId).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[id]/investment-requirements", () => {
  beforeEach(resetMocks);

  it("returns 401 with no session cookie", async () => {
    const response = await POST(
      makePostRequest({ body: { amount: "1000000", requirementDate: "2026-10-01" } }),
      makeContext(),
    );

    expect(response.status).toBe(401);
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("creates a requirement -- 201, saved", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createInvestmentRequirement.mockResolvedValue(makeRequirement());

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.amount).toBe("1000000");
    expect(body.requirementDate).toBe("2026-10-01");
    expect(createInvestmentRequirement).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, amount: "1000000", requirementDate: "2026-10-01" }),
    );
  });

  it("Story 3.5: snapshots Recommended Amount for every current Partner/Sub-partner after creating a requirement, response body unchanged", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createInvestmentRequirement.mockResolvedValue(makeRequirement({ id: "req-1" }));
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "50" }),
    ]);
    listAdjustmentsByProjectId.mockResolvedValue([
      makeAdjustmentRow({
        partyType: "partner",
        shareId: "a",
        adjustmentType: "extra_paid",
        adjustmentAmount: "200000",
      }),
    ]);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    // The snapshot is a side effect, never part of this response body.
    expect(body).toEqual({ id: "req-1", projectId: PROJECT_ID, amount: "1000000", requirementDate: "2026-10-01", createdAt: expect.any(String) });

    expect(listAdjustmentsByProjectId).toHaveBeenCalledWith(PROJECT_ID);
    // Exactly ONE call to the port, with the full 2-share batch -- never a
    // per-share loop (Review Triage Log row 1's atomicity fix).
    expect(snapshotAllRecommendedAmounts).toHaveBeenCalledTimes(1);
    expect(snapshotAllRecommendedAmounts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          requirementId: "req-1",
          projectId: PROJECT_ID,
          partyType: "partner",
          shareId: "a",
          baseAmount: "500000",
          previousExtraPaid: "200000",
          previousPending: "0",
          recommendedAmount: "300000",
        }),
        expect.objectContaining({
          requirementId: "req-1",
          partyType: "partner",
          shareId: "b",
          baseAmount: "500000",
          previousExtraPaid: "0",
          previousPending: "0",
          recommendedAmount: "500000",
        }),
      ]),
    );
    const [batch] = snapshotAllRecommendedAmounts.mock.calls[0] as [unknown[]];
    expect(batch).toHaveLength(2);
  });

  it("Bug fix (2026-09-25): forces a fresh recompute of the immediately-prior requirement's ledger before reading it for carry-forward, rather than trusting a possibly-stale row", async () => {
    // Simulates the exact live-reproduced bug: the persisted adjustment row
    // for the prior requirement is stale ("pending 500000", as if nothing
    // was ever paid), but the prior requirement's own transactions show the
    // share was in fact paid in full. Before this fix, `listAdjustmentsByProjectId`'s
    // stale value would have been trusted as-is; after this fix, the route
    // must recompute against the prior requirement's real transactions first,
    // so the stale row is corrected before the new requirement's snapshot
    // ever reads it.
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createInvestmentRequirement.mockResolvedValue(makeRequirement({ id: "req-2", requirementDate: "2026-11-01" }));
    listByProjectId.mockResolvedValue([
      makeRequirement({ id: "req-1", requirementDate: "2026-10-01", amount: "500000" }),
      makeRequirement({ id: "req-2", requirementDate: "2026-11-01" }),
    ]);
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "100" }),
    ]);
    // The prior requirement's own transactions show Partner A fully paid
    // their 500000 Should Pay -- but the persisted `investment_adjustments`
    // row (returned by the FINAL read below) is deliberately left stale at
    // "pending 500000", as if that payment had never been reflected. If the
    // fix works, the recompute step corrects this via `upsertAdjustment`
    // before the stale row would otherwise have been trusted.
    listTransactionsByRequirementId.mockResolvedValue([
      { id: "tx-1", requirementId: "req-1", projectId: PROJECT_ID, partyType: "partner", shareId: "a", sharePercentSnapshot: "100", shouldPaySnapshot: "500000", amount: "500000", transactionDate: "2026-10-05", paymentMode: "cash", referenceNumber: null, notes: null, status: "active", reversalOfTransactionId: null, createdAt: new Date().toISOString() },
    ]);
    listAdjustmentsByProjectId.mockResolvedValue([
      makeAdjustmentRow({ partyType: "partner", shareId: "a", requirementId: "req-1", adjustmentType: "pending", adjustmentAmount: "500000" }),
    ]);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "500000", requirementDate: "2026-11-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);

    // The recompute step ran against the correct prior requirement...
    expect(listTransactionsByRequirementId).toHaveBeenCalledWith("req-1");
    // ...and corrected the stale row: A's real actualPaid (500000) matches
    // their real shouldPay (500000) -- "none", not the stale "pending 500000".
    expect(upsertAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        requirementId: "req-1",
        partyType: "partner",
        shareId: "a",
        shouldPay: "500000",
        actualPaid: "500000",
        adjustmentType: "none",
        adjustmentAmount: "0",
      }),
    );
    // The recompute (line above) must happen BEFORE the final read that
    // feeds the new requirement's carry-forward snapshot -- otherwise the
    // fix has no effect on what gets snapshotted.
    const upsertOrder = upsertAdjustment.mock.invocationCallOrder[0] as number;
    const finalReadOrder = listAdjustmentsByProjectId.mock.invocationCallOrder.at(-1) as number;
    expect(upsertOrder).toBeLessThan(finalReadOrder);
  });

  it("Story 3.5: still returns 201 (snapshot skipped) when Partner Shares aren't fully allocated yet -- never blocks requirement creation", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createInvestmentRequirement.mockResolvedValue(makeRequirement({ id: "req-1" }));
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50" }),
    ]); // only 50% -- SharesNotFullyAllocatedError inside snapshotRecommendedAmounts

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("req-1");
    expect(snapshotAllRecommendedAmounts).not.toHaveBeenCalled();
  });

  it("Story 3.5: still returns 201 (snapshot skipped) when a Partner's Sub-partner Shares are over-allocated -- SubPartnerSharesOverAllocatedError is swallowed the same way SharesNotFullyAllocatedError is", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createInvestmentRequirement.mockResolvedValue(makeRequirement({ id: "req-1" }));
    listPartnerSharesByProjectId.mockResolvedValue([
      makePartnerShareRow({ partnerId: "a", name: "A", sharePercent: "50" }),
      makePartnerShareRow({ partnerId: "b", name: "B", sharePercent: "50" }),
    ]);
    listSubPartnerSharesByProjectId.mockResolvedValue([
      {
        id: "sub-row-1",
        subPartnerId: "sub-1",
        partnerId: "a",
        projectId: PROJECT_ID,
        name: "Sub 1",
        sharePercent: "60", // exceeds Partner A's own 50% share
        userId: null,
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("req-1");
    expect(snapshotAllRecommendedAmounts).not.toHaveBeenCalled();
  });

  it("Story 3.5: still returns 201 (snapshot skipped, error swallowed) when the snapshot step hits a genuinely unexpected error -- never a 500 for an already-created requirement", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createInvestmentRequirement.mockResolvedValue(makeRequirement({ id: "req-1" }));
    // Neither precondition error -- a generic failure, e.g. a transient DB
    // connection error during the atomic batch write.
    snapshotAllRecommendedAmounts.mockRejectedValue(new Error("simulated transient connection error"));

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("req-1");
    expect(snapshotAllRecommendedAmounts).toHaveBeenCalledTimes(1);
  });

  it("Story 3.5: the first-ever requirement for a Project (no prior adjustments) snapshots previousPending/previousExtraPaid both '0'", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    createInvestmentRequirement.mockResolvedValue(makeRequirement({ id: "req-1", amount: "1000000" }));
    listPartnerSharesByProjectId.mockResolvedValue([makePartnerShareRow({ partnerId: "a", sharePercent: "100" })]);
    listAdjustmentsByProjectId.mockResolvedValue([]);

    await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(snapshotAllRecommendedAmounts).toHaveBeenCalledWith([
      expect.objectContaining({
        previousPending: "0",
        previousExtraPaid: "0",
        baseAmount: "1000000",
        recommendedAmount: "1000000",
      }),
    ]);
  });

  it("returns 403 for a non-owner_admin with an otherwise-valid body -- no row created", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: "forbidden", message: expect.any(String) });
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 403, not 400, for a non-owner_admin sending a malformed body -- authorization checked before body shape", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-user-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { amount: 12345 } }),
      makeContext(),
    );

    expect(response.status).toBe(403);
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, rawBody: "not-json{{" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_request");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 400 when requirementDate is missing", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ cookie: `${SESSION_COOKIE_NAME}=some-token`, body: { amount: "1000000" } }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_request");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("blocks amount '0' with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "0", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("blocks a negative amount with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "-500", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("blocks an amount with more than 2 decimal places with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000.999", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("blocks a malformed date with a 400 validation_error, before save", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "not-a-date" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent project, rather than letting the insert fail on the FK constraint", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findProjectById.mockResolvedValue(null);

    const response = await POST(
      makePostRequest({
        cookie: `${SESSION_COOKIE_NAME}=some-token`,
        body: { amount: "1000000", requirementDate: "2026-10-01" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("not_found");
    expect(createInvestmentRequirement).not.toHaveBeenCalled();
  });
});

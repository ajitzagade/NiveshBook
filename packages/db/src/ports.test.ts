import { describe, it, expect } from "vitest";
import type { InvestmentTransaction, Money, Percent, WithdrawalTransaction } from "@niveshbook/types";
import type { CreateWithdrawalDestinationAllocationLegInput } from "@niveshbook/core";
import {
  isUniqueViolation,
  matchesCancelRequest,
  matchesEditRequest,
  matchesRequest,
  matchesWithdrawalRequest,
  matchesAllocationRequest,
} from "./ports";
import type { WithdrawalDestinationAllocationRow } from "./schema";

function makeExistingTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "tx-1",
    requirementId: "req-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "partner-a",
    sharePercentSnapshot: "50" as Percent,
    shouldPaySnapshot: "500000" as Money,
    amount: "700000" as Money,
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Narrowly-scoped unit tests for `isUniqueViolation` -- the one new,
 * DB-independent piece of decision logic `createInvestmentTransactionPort`'s
 * (Story 3.3) concurrent-race recovery branch depends on. A pure function,
 * so it's tested directly against a variety of error shapes rather than via
 * a full Drizzle-`database.transaction()`-mocking harness -- this codebase
 * has no existing precedent for mocking Drizzle at that level (every other
 * port's behavior is verified via route-level tests with the port itself
 * mocked, or via live verification against real Postgres), so inventing one
 * here would be a disproportionate, novel addition (spec-3-3's Review
 * Triage Log, row 3).
 */
describe("isUniqueViolation", () => {
  it("returns true for a real Postgres unique-violation error (SQL state 23505)", () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
      code: "23505",
    });

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("returns true for any plain object carrying code '23505', not just an Error instance", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("returns false for an error with an unrelated Postgres error code", () => {
    const error = Object.assign(new Error("null value in column violates not-null constraint"), {
      code: "23502",
    });

    expect(isUniqueViolation(error)).toBe(false);
  });

  it("returns false for a plain Error with no code property at all", () => {
    expect(isUniqueViolation(new Error("some other failure"))).toBe(false);
  });

  it("returns false for a non-object thrown value (string)", () => {
    expect(isUniqueViolation("not-an-error")).toBe(false);
  });

  it("returns false for a non-object thrown value (number)", () => {
    expect(isUniqueViolation(42)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("returns false when code is present but not a string matching '23505' (e.g. a numeric code, or a different constraint's code as a similar-looking string)", () => {
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
    expect(isUniqueViolation({ code: "23505 " })).toBe(false);
    expect(isUniqueViolation({ code: "123505" })).toBe(false);
  });
});

/**
 * Narrowly-scoped unit tests for `matchesRequest` -- the idempotency-replay
 * match check `createInvestmentTransactionPort.recordTransaction` uses to
 * confirm a row found by `idempotencyKey` actually represents the *current*
 * request, not an unrelated key collision (spec-3-3's Review Triage Log,
 * row 2). Also covers row 9's regression: `existing.amount` comes back from
 * Postgres's `numeric(14,2)` column at its full declared scale (a submitted
 * "700000" reads back as "700000.00"), so a legitimate replay of the exact
 * same amount must still match even though the two strings differ byte-for-
 * byte -- `moneyEquals` (not `===`) is what makes that true.
 */
describe("matchesRequest", () => {
  it("matches when every field is byte-identical", () => {
    const existing = makeExistingTransaction({ amount: "700000" as Money });

    const result = matchesRequest(existing, {
      requirementId: "req-1",
      shareId: "partner-a",
      partyType: "partner",
      amount: "700000" as Money,
    });

    expect(result).toBe(true);
  });

  it("matches a legitimate replay even though the stored amount round-tripped through numeric(14,2) ('700000.00' read back vs. a freshly-submitted '700000') -- row 9 regression", () => {
    const existing = makeExistingTransaction({ amount: "700000.00" as Money });

    const result = matchesRequest(existing, {
      requirementId: "req-1",
      shareId: "partner-a",
      partyType: "partner",
      amount: "700000" as Money,
    });

    expect(result).toBe(true);
  });

  it("matches regardless of which side carries the padded/unpadded decimal formatting", () => {
    const existing = makeExistingTransaction({ amount: "1234.5" as Money });

    const result = matchesRequest(existing, {
      requirementId: "req-1",
      shareId: "partner-a",
      partyType: "partner",
      amount: "1234.50" as Money,
    });

    expect(result).toBe(true);
  });

  it("rejects a genuinely different amount -- a true key collision, not a replay", () => {
    const existing = makeExistingTransaction({ amount: "700000.00" as Money });

    const result = matchesRequest(existing, {
      requirementId: "req-1",
      shareId: "partner-a",
      partyType: "partner",
      amount: "700000.01" as Money,
    });

    expect(result).toBe(false);
  });

  it("rejects a mismatched requirementId even when amount/shareId/partyType all match", () => {
    const existing = makeExistingTransaction({ requirementId: "req-1" });

    const result = matchesRequest(existing, {
      requirementId: "req-2",
      shareId: "partner-a",
      partyType: "partner",
      amount: "700000" as Money,
    });

    expect(result).toBe(false);
  });

  it("rejects a mismatched shareId even when the other fields all match", () => {
    const existing = makeExistingTransaction({ shareId: "partner-a" });

    const result = matchesRequest(existing, {
      requirementId: "req-1",
      shareId: "partner-b",
      partyType: "partner",
      amount: "700000" as Money,
    });

    expect(result).toBe(false);
  });

  it("rejects a mismatched partyType even when shareId happens to be the same string (a Partner's partnerId colliding with a Sub-partner's subPartnerId)", () => {
    const existing = makeExistingTransaction({ partyType: "partner", shareId: "shared-id" });

    const result = matchesRequest(existing, {
      requirementId: "req-1",
      shareId: "shared-id",
      partyType: "sub_partner",
      amount: "700000" as Money,
    });

    expect(result).toBe(false);
  });
});

/**
 * Narrowly-scoped unit tests for `matchesEditRequest` -- the `editTransaction`
 * (Story 3.7) analog of `matchesRequest` above, one level over: the
 * idempotency-replay match check confirms an `audit_log` row found by
 * `idempotencyKey` actually represents the *current* edit request, not an
 * unrelated key collision. Mirrors `matchesRequest`'s own test shape,
 * including the `numeric(14,2)`-round-trip regression coverage (here via
 * `entry.newValue.amount`, since the stored value passes through `jsonb`
 * rather than a typed column, but still originates from the same
 * `numeric(14,2)` column via `.returning()`).
 */
describe("matchesEditRequest", () => {
  function makeAuditEntry(overrides: { entityId?: string; newValue?: unknown } = {}) {
    return {
      entityId: overrides.entityId ?? "tx-1",
      // `"newValue" in overrides` (not `??`) -- `??` would treat an explicit
      // `newValue: null` override as "not provided" and fall through to the
      // default object, defeating the malformed-row test cases below.
      newValue:
        "newValue" in overrides
          ? overrides.newValue
          : {
              amount: "750000",
              transactionDate: "2026-10-06",
              paymentMode: "upi",
              referenceNumber: "REF-2",
              notes: "corrected",
            },
    };
  }

  function makeEditInput(overrides: Record<string, unknown> = {}) {
    return {
      transactionId: "tx-1",
      amount: "750000" as Money,
      transactionDate: "2026-10-06",
      paymentMode: "upi" as const,
      referenceNumber: "REF-2",
      notes: "corrected",
      ...overrides,
    };
  }

  it("matches when every field is byte-identical", () => {
    expect(matchesEditRequest(makeAuditEntry(), makeEditInput())).toBe(true);
  });

  it("matches a legitimate replay even though the stored amount round-tripped through numeric(14,2) ('750000.00' vs. a freshly-submitted '750000')", () => {
    const entry = makeAuditEntry({
      newValue: {
        amount: "750000.00",
        transactionDate: "2026-10-06",
        paymentMode: "upi",
        referenceNumber: "REF-2",
        notes: "corrected",
      },
    });

    expect(matchesEditRequest(entry, makeEditInput({ amount: "750000" as Money }))).toBe(true);
  });

  it("rejects a mismatched entityId (a different transaction entirely)", () => {
    const entry = makeAuditEntry({ entityId: "tx-2" });

    expect(matchesEditRequest(entry, makeEditInput({ transactionId: "tx-1" }))).toBe(false);
  });

  it("rejects a genuinely different amount -- a true key collision, not a replay", () => {
    expect(matchesEditRequest(makeAuditEntry(), makeEditInput({ amount: "750000.01" as Money }))).toBe(
      false,
    );
  });

  it("rejects a mismatched transactionDate even when every other field matches", () => {
    expect(
      matchesEditRequest(makeAuditEntry(), makeEditInput({ transactionDate: "2026-10-07" })),
    ).toBe(false);
  });

  it("rejects a mismatched paymentMode even when every other field matches", () => {
    expect(matchesEditRequest(makeAuditEntry(), makeEditInput({ paymentMode: "neft" }))).toBe(false);
  });

  it("rejects a mismatched referenceNumber/notes even when amount/date/mode match", () => {
    expect(
      matchesEditRequest(makeAuditEntry(), makeEditInput({ referenceNumber: "REF-9" })),
    ).toBe(false);
    expect(matchesEditRequest(makeAuditEntry(), makeEditInput({ notes: "different note" }))).toBe(
      false,
    );
  });

  it("treats a null referenceNumber/notes on both sides as a match", () => {
    const entry = makeAuditEntry({
      newValue: {
        amount: "750000",
        transactionDate: "2026-10-06",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
      },
    });

    expect(
      matchesEditRequest(entry, makeEditInput({ referenceNumber: null, notes: null })),
    ).toBe(true);
  });

  it("rejects a newValue that isn't a well-formed object (defense in depth against a malformed jsonb row)", () => {
    expect(matchesEditRequest(makeAuditEntry({ newValue: null }), makeEditInput())).toBe(false);
    expect(matchesEditRequest(makeAuditEntry({ newValue: "not-an-object" }), makeEditInput())).toBe(
      false,
    );
    expect(matchesEditRequest(makeAuditEntry({ newValue: { amount: 750000 } }), makeEditInput())).toBe(
      false,
    );
  });
});

/**
 * Narrowly-scoped unit tests for `matchesCancelRequest` -- the
 * `cancelTransaction` (Story 3.8) analog of `matchesEditRequest` one level
 * over. A cancel request carries no other caller-supplied content to
 * compare (amount/date/paymentMode/etc. never change) -- unlike
 * `matchesEditRequest`, this is a bare `entityId`-vs-`transactionId`
 * equality check.
 */
describe("matchesCancelRequest", () => {
  it("matches when entityId equals transactionId", () => {
    expect(matchesCancelRequest({ entityId: "tx-1" }, { transactionId: "tx-1" })).toBe(true);
  });

  it("rejects a mismatched entityId -- a genuine key collision with an unrelated request, not a replay of this cancel", () => {
    expect(matchesCancelRequest({ entityId: "tx-2" }, { transactionId: "tx-1" })).toBe(false);
  });
});

function makeExistingWithdrawalTransaction(
  overrides: Partial<WithdrawalTransaction> = {},
): WithdrawalTransaction {
  return {
    id: "wtx-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "partner-a",
    sharePercentSnapshot: "50" as Percent,
    canTakeSnapshot: "500000" as Money,
    amount: "250000" as Money,
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Narrowly-scoped unit tests for `matchesWithdrawalRequest` -- the
 * `createWithdrawalTransactionPort.recordTransaction` (Story 4.2) analog of
 * `matchesRequest` one ledger over, confirming a row found by
 * `idempotencyKey` actually represents the *current* request, not an
 * unrelated key collision. Mirrors `matchesRequest`'s own test shape
 * exactly, including the decimal-safe `moneyEquals` regression (this
 * story's Decisions: a legitimate identical-content retry must succeed as a
 * replay, not a false 409 conflict, even though Postgres's `numeric(14,2)`
 * round-trips a submitted `"250000"` as `"250000.00"`).
 */
describe("matchesWithdrawalRequest", () => {
  it("matches when every field is byte-identical", () => {
    const existing = makeExistingWithdrawalTransaction({ amount: "250000" as Money });

    const result = matchesWithdrawalRequest(existing, {
      projectId: "project-1",
      shareId: "partner-a",
      partyType: "partner",
      amount: "250000" as Money,
    });

    expect(result).toBe(true);
  });

  it("matches a legitimate replay even though the stored amount round-tripped through numeric(14,2) ('250000.00' read back vs. a freshly-submitted '250000')", () => {
    const existing = makeExistingWithdrawalTransaction({ amount: "250000.00" as Money });

    const result = matchesWithdrawalRequest(existing, {
      projectId: "project-1",
      shareId: "partner-a",
      partyType: "partner",
      amount: "250000" as Money,
    });

    expect(result).toBe(true);
  });

  it("matches regardless of which side carries the padded/unpadded decimal formatting", () => {
    const existing = makeExistingWithdrawalTransaction({ amount: "1234.5" as Money });

    const result = matchesWithdrawalRequest(existing, {
      projectId: "project-1",
      shareId: "partner-a",
      partyType: "partner",
      amount: "1234.50" as Money,
    });

    expect(result).toBe(true);
  });

  it("rejects a genuinely different amount -- a true key collision, not a replay", () => {
    const existing = makeExistingWithdrawalTransaction({ amount: "250000.00" as Money });

    const result = matchesWithdrawalRequest(existing, {
      projectId: "project-1",
      shareId: "partner-a",
      partyType: "partner",
      amount: "250000.01" as Money,
    });

    expect(result).toBe(false);
  });

  it("rejects a mismatched projectId even when amount/shareId/partyType all match", () => {
    const existing = makeExistingWithdrawalTransaction({ projectId: "project-1" });

    const result = matchesWithdrawalRequest(existing, {
      projectId: "project-2",
      shareId: "partner-a",
      partyType: "partner",
      amount: "250000" as Money,
    });

    expect(result).toBe(false);
  });

  it("rejects a mismatched shareId even when the other fields all match", () => {
    const existing = makeExistingWithdrawalTransaction({ shareId: "partner-a" });

    const result = matchesWithdrawalRequest(existing, {
      projectId: "project-1",
      shareId: "partner-b",
      partyType: "partner",
      amount: "250000" as Money,
    });

    expect(result).toBe(false);
  });

  it("rejects a mismatched partyType even when shareId happens to be the same string (a Partner's partnerId colliding with a Sub-partner's subPartnerId)", () => {
    const existing = makeExistingWithdrawalTransaction({ partyType: "partner", shareId: "shared-id" });

    const result = matchesWithdrawalRequest(existing, {
      projectId: "project-1",
      shareId: "shared-id",
      partyType: "sub_partner",
      amount: "250000" as Money,
    });

    expect(result).toBe(false);
  });
});

function makeAllocationRow(
  overrides: Partial<WithdrawalDestinationAllocationRow> = {},
): WithdrawalDestinationAllocationRow {
  return {
    id: "alloc-1",
    withdrawalTransactionId: "wtx-1",
    destinationType: "other",
    amount: "250000",
    destinationProjectId: null,
    personName: null,
    notes: "Kept as cash",
    idempotencyKey: "idem-1",
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date(),
    ...overrides,
  } as WithdrawalDestinationAllocationRow;
}

function makeLegInput(
  overrides: Partial<CreateWithdrawalDestinationAllocationLegInput> = {},
): CreateWithdrawalDestinationAllocationLegInput {
  return {
    destinationType: "other",
    amount: "250000" as Money,
    destinationProjectId: null,
    personName: null,
    notes: "Kept as cash",
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    destinationSnapshotInput: null,
    ...overrides,
  };
}

/**
 * Narrowly-scoped unit tests for `matchesAllocationRequest` -- the
 * `createWithdrawalDestinationAllocationPort.recordAllocation` (Story 4.7)
 * analog of `matchesWithdrawalRequest`/`matchesCancelRequest` one story
 * over, confirming a set of rows found for one `idempotencyKey` actually
 * represents the *current* request's legs, not an unrelated key collision.
 */
describe("matchesAllocationRequest", () => {
  it("matches a single leg that's byte-identical", () => {
    expect(matchesAllocationRequest([makeAllocationRow()], [makeLegInput()])).toBe(true);
  });

  it("matches a legitimate replay even though the stored amount round-tripped through numeric(14,2)", () => {
    const existing = makeAllocationRow({ amount: "250000.00" });
    expect(matchesAllocationRequest([existing], [makeLegInput({ amount: "250000" as Money })])).toBe(true);
  });

  it("matches multiple legs regardless of order (multiset match)", () => {
    const existingRows = [
      makeAllocationRow({ id: "alloc-1", destinationType: "project", amount: "150000", destinationProjectId: "project-2", personName: null, notes: null }),
      makeAllocationRow({ id: "alloc-2", destinationType: "person", amount: "100000", destinationProjectId: null, personName: "Person X", notes: null }),
    ];
    const legs = [
      makeLegInput({ destinationType: "person", amount: "100000" as Money, personName: "Person X", notes: null }),
      makeLegInput({ destinationType: "project", amount: "150000" as Money, destinationProjectId: "project-2", notes: null }),
    ];

    expect(matchesAllocationRequest(existingRows, legs)).toBe(true);
  });

  it("rejects a different leg count", () => {
    expect(matchesAllocationRequest([makeAllocationRow()], [makeLegInput(), makeLegInput()])).toBe(false);
  });

  it("rejects a genuinely different amount -- a true key collision, not a replay", () => {
    const existing = makeAllocationRow({ amount: "250000.00" });
    expect(matchesAllocationRequest([existing], [makeLegInput({ amount: "250000.01" as Money })])).toBe(false);
  });

  it("rejects a mismatched destinationType even when amount matches", () => {
    const existing = makeAllocationRow({ destinationType: "other" });
    expect(matchesAllocationRequest([existing], [makeLegInput({ destinationType: "available_balance" })])).toBe(
      false,
    );
  });

  it("rejects a mismatched destinationProjectId", () => {
    const existing = makeAllocationRow({ destinationType: "project", destinationProjectId: "project-2" });
    expect(
      matchesAllocationRequest(
        [existing],
        [makeLegInput({ destinationType: "project", destinationProjectId: "project-3" })],
      ),
    ).toBe(false);
  });

  it("rejects a mismatched personName", () => {
    const existing = makeAllocationRow({ destinationType: "person", personName: "Person X" });
    expect(
      matchesAllocationRequest([existing], [makeLegInput({ destinationType: "person", personName: "Person Y" })]),
    ).toBe(false);
  });

  it("rejects a mismatched notes", () => {
    const existing = makeAllocationRow({ notes: "Kept as cash" });
    expect(matchesAllocationRequest([existing], [makeLegInput({ notes: "Something else" })])).toBe(false);
  });

  it("matches a 'project' leg whose destinationRequirementId/destinationShareId/destinationPartyType are byte-identical (Story 4.8)", () => {
    const existing = makeAllocationRow({
      destinationType: "project",
      destinationProjectId: "project-2",
      destinationRequirementId: "req-2",
      destinationShareId: "partner-2",
      destinationPartyType: "partner",
    });
    expect(
      matchesAllocationRequest(
        [existing],
        [
          makeLegInput({
            destinationType: "project",
            destinationProjectId: "project-2",
            destinationRequirementId: "req-2",
            destinationShareId: "partner-2",
            destinationPartyType: "partner",
          }),
        ],
      ),
    ).toBe(true);
  });

  it("rejects a mismatched destinationRequirementId/destinationShareId/destinationPartyType (Story 4.8)", () => {
    const existing = makeAllocationRow({
      destinationType: "project",
      destinationProjectId: "project-2",
      destinationRequirementId: "req-2",
      destinationShareId: "partner-2",
      destinationPartyType: "partner",
    });
    expect(
      matchesAllocationRequest(
        [existing],
        [
          makeLegInput({
            destinationType: "project",
            destinationProjectId: "project-2",
            destinationRequirementId: "req-3",
            destinationShareId: "partner-2",
            destinationPartyType: "partner",
          }),
        ],
      ),
    ).toBe(false);
    expect(
      matchesAllocationRequest(
        [existing],
        [
          makeLegInput({
            destinationType: "project",
            destinationProjectId: "project-2",
            destinationRequirementId: "req-2",
            destinationShareId: "sub-9",
            destinationPartyType: "sub_partner",
          }),
        ],
      ),
    ).toBe(false);
  });
});

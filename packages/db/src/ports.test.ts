import { describe, it, expect } from "vitest";
import type { InvestmentTransaction, Money, Percent } from "@niveshbook/types";
import { isUniqueViolation, matchesEditRequest, matchesRequest } from "./ports";

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

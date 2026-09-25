import { describe, it, expect } from "vitest";
import type {
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
  WithdrawalDestinationAllocation,
  WithdrawalTransaction,
} from "@niveshbook/types";
import { PartnerSharesNotFullyAllocatedError, CanTakeSubPartnerSharesOverAllocatedError } from "./can-take";
import type {
  CancelWithdrawalTransactionInput,
  CreateWithdrawalTransactionInput,
  EditWithdrawalTransactionInput,
  WithdrawalTransactionPort,
} from "./withdrawal-transaction-port";
import type { WithdrawalDestinationAllocationPort } from "./withdrawal-destination-allocation-port";
import {
  assertAmountEditable,
  assertWithdrawalNotCancelled,
  buildWithdrawalSnapshot,
  cancelWithdrawalTransaction,
  editWithdrawalTransaction,
  InvalidWithdrawalAmountError,
  InvalidWithdrawalDateError,
  InvalidWithdrawalPaymentModeError,
  MissingWithdrawalIdempotencyKeyError,
  WithdrawalAlreadyCancelledError,
  WithdrawalAmountLockedByAllocationError,
  WithdrawalShareNotFoundError,
  listWithdrawalTransactions,
  recordWithdrawalTransaction,
  WITHDRAWAL_PAYMENT_MODES,
  type EditWithdrawalTransactionDeps,
  type EditWithdrawalTransactionRequest,
  type RecordWithdrawalTransactionInput,
} from "./withdrawal-transaction";

function makePartner(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: "project-1",
    name: "Partner A",
    sharePercent: "50" as Percent,
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSub(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  return {
    id: "sub-row-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: "project-1",
    name: "Sub 1",
    sharePercent: "12.5" as Percent,
    userId: null,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<RecordWithdrawalTransactionInput> = {},
): RecordWithdrawalTransactionInput {
  return {
    partyType: "partner",
    shareId: "a",
    amount: "250000",
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: "REF-1",
    notes: null,
    idempotencyKey: "idem-key-1",
    ...overrides,
  };
}

/**
 * A WithdrawalTransactionPort backed by a mutable in-memory array -- mirrors
 * `investment-transaction.test.ts`'s `createFakeInvestmentTransactionPort`
 * convention, one ledger over. `calls` records every `recordTransaction`
 * input verbatim, so tests can assert on exactly what
 * `recordWithdrawalTransaction` built and passed through. Always resolves
 * `created: true` -- the idempotent-replay/concurrent-race behavior is
 * `packages/db`'s own port implementation's job, verified at that layer
 * (`packages/db/src/withdrawal-transaction-port.test.ts`) and by the
 * route-level idempotent-replay test (with this port mocked), not this
 * domain-layer test file's.
 *
 * Story 4.11 addition: also implements `editTransaction`/`cancelTransaction`
 * -- mirrors `createFakeInvestmentTransactionPort`'s identical
 * check-first-then-replay idempotency handling (via
 * `Map<idempotencyKey, ...>`s) and already-cancelled rejection, one ledger
 * over. Deliberately does NOT implement `cancelTransaction`'s cascade to
 * linked `investment_transactions`/`available_balances` -- that's
 * `cancelWithdrawalBundle()`'s own job, tested directly in
 * `cancel-withdrawal-bundle.test.ts`; this fake proves only that
 * `editWithdrawalTransaction`/`cancelWithdrawalTransaction` build the right
 * port input and correctly surface the port's own result/idempotency shape.
 */
function createFakeWithdrawalTransactionPort(): WithdrawalTransactionPort & {
  calls: CreateWithdrawalTransactionInput[];
  editCalls: EditWithdrawalTransactionInput[];
  cancelCalls: CancelWithdrawalTransactionInput[];
  rows: WithdrawalTransaction[];
} {
  const calls: CreateWithdrawalTransactionInput[] = [];
  const editCalls: EditWithdrawalTransactionInput[] = [];
  const cancelCalls: CancelWithdrawalTransactionInput[] = [];
  const rows: WithdrawalTransaction[] = [];
  const appliedEditsByIdempotencyKey = new Map<string, WithdrawalTransaction>();
  const appliedCancelsByIdempotencyKey = new Map<
    string,
    { originalTransaction: WithdrawalTransaction; reversalTransaction: WithdrawalTransaction }
  >();
  return {
    calls,
    editCalls,
    cancelCalls,
    rows,
    async recordTransaction(input) {
      calls.push(input);
      const transaction: WithdrawalTransaction = {
        id: `wtx-${rows.length + 1}`,
        projectId: input.projectId,
        partyType: input.partyType,
        shareId: input.shareId,
        sharePercentSnapshot: input.sharePercentSnapshot,
        canTakeSnapshot: input.canTakeSnapshot,
        amount: input.amount,
        transactionDate: input.transactionDate,
        paymentMode: input.paymentMode,
        referenceNumber: input.referenceNumber,
        notes: input.notes,
        status: "active",
        reversalOfTransactionId: null,
        createdAt: new Date().toISOString(),
      };
      rows.push(transaction);
      return { transaction, created: true };
    },
    async listByProjectId(projectId) {
      return rows.filter((row) => row.projectId === projectId);
    },
    async sumActiveAmountByProjectId() {
      throw new Error("not exercised by this test file");
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async editTransaction(input) {
      editCalls.push(input);

      const alreadyApplied = appliedEditsByIdempotencyKey.get(input.idempotencyKey);
      if (alreadyApplied) {
        return { transaction: alreadyApplied, edited: false };
      }

      const index = rows.findIndex((row) => row.id === input.transactionId);
      const existing = rows[index];
      if (!existing) {
        throw new Error(`No fake row for transactionId ${input.transactionId}`);
      }
      const updated: WithdrawalTransaction = {
        ...existing,
        amount: input.amount,
        transactionDate: input.transactionDate,
        paymentMode: input.paymentMode,
        referenceNumber: input.referenceNumber,
        notes: input.notes,
      };
      rows[index] = updated;
      appliedEditsByIdempotencyKey.set(input.idempotencyKey, updated);
      return { transaction: updated, edited: true };
    },
    async cancelTransaction(input) {
      cancelCalls.push(input);

      const alreadyApplied = appliedCancelsByIdempotencyKey.get(input.idempotencyKey);
      if (alreadyApplied) {
        return { ...alreadyApplied, cancelled: false };
      }

      const index = rows.findIndex((row) => row.id === input.transactionId);
      const existing = rows[index];
      if (!existing) {
        throw new Error(`No fake row for transactionId ${input.transactionId}`);
      }
      if (existing.status === "cancelled") {
        throw new WithdrawalAlreadyCancelledError();
      }

      const updatedOriginal: WithdrawalTransaction = { ...existing, status: "cancelled" };
      rows[index] = updatedOriginal;

      const reversal: WithdrawalTransaction = {
        ...existing,
        id: `wtx-${rows.length + 1}`,
        status: "cancelled",
        reversalOfTransactionId: updatedOriginal.id,
        createdAt: new Date().toISOString(),
      };
      rows.push(reversal);

      const result = { originalTransaction: updatedOriginal, reversalTransaction: reversal };
      appliedCancelsByIdempotencyKey.set(input.idempotencyKey, result);
      return { ...result, cancelled: true };
    },
    async listAll() {
      return [...rows];
    },
  };
}

/** A `WithdrawalDestinationAllocationPort.listByWithdrawalTransactionId`-only fake -- backs `EditWithdrawalTransactionDeps`'s narrow ISP dependency. */
function createFakeAllocationLister(
  legsByWithdrawalTransactionId: Record<string, WithdrawalDestinationAllocation[]> = {},
): Pick<WithdrawalDestinationAllocationPort, "listByWithdrawalTransactionId"> {
  return {
    async listByWithdrawalTransactionId(withdrawalTransactionId) {
      return legsByWithdrawalTransactionId[withdrawalTransactionId] ?? [];
    },
  };
}

function makeLeg(overrides: Partial<WithdrawalDestinationAllocation> = {}): WithdrawalDestinationAllocation {
  return {
    id: "leg-1",
    withdrawalTransactionId: "wtx-1",
    destinationType: "other",
    amount: "1000" as Money,
    destinationProjectId: null,
    personName: null,
    notes: "Kept as cash",
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEditRequest(
  overrides: Partial<EditWithdrawalTransactionRequest> = {},
): EditWithdrawalTransactionRequest {
  return {
    amount: "300000",
    transactionDate: "2026-10-06",
    paymentMode: "upi",
    referenceNumber: null,
    notes: null,
    idempotencyKey: "edit-key-1",
    reason: null,
    ...overrides,
  };
}

describe("buildWithdrawalSnapshot", () => {
  it("snapshots a Partner's Can Take (50% of ₹5,00,000 available to withdraw)", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];

    const snapshot = buildWithdrawalSnapshot("500000" as Money, partners, {}, "partner", "a");

    expect(snapshot.sharePercentSnapshot).toBe("50");
    expect(snapshot.canTakeSnapshot).toBe("250000");
  });

  it("a Sub-partner's own snapshot reflects their nested share, not their parent Partner's", () => {
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
    const subsByPartnerId = {
      a: [
        makeSub({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "25" as Percent }),
      ],
    };

    const snapshot = buildWithdrawalSnapshot(
      "1000000" as Money,
      partners,
      subsByPartnerId,
      "sub_partner",
      "sub1",
    );

    expect(snapshot.sharePercentSnapshot).toBe("25");
    expect(snapshot.canTakeSnapshot).toBe("250000");
  });

  it("throws WithdrawalShareNotFoundError when partyType is 'partner' but shareId matches nothing", () => {
    const partners = [makePartner({ partnerId: "a", sharePercent: "100" as Percent })];

    expect(() =>
      buildWithdrawalSnapshot("1000000" as Money, partners, {}, "partner", "nonexistent"),
    ).toThrow(WithdrawalShareNotFoundError);
  });

  it("throws WithdrawalShareNotFoundError when partyType is 'sub_partner' but shareId matches nothing", () => {
    const partners = [makePartner({ partnerId: "a", sharePercent: "100" as Percent })];

    expect(() =>
      buildWithdrawalSnapshot("1000000" as Money, partners, {}, "sub_partner", "nonexistent"),
    ).toThrow(WithdrawalShareNotFoundError);
  });

  it("throws WithdrawalShareNotFoundError when a Sub-partner's shareId is passed with partyType 'partner' (no cross-matching)", () => {
    const partners = [makePartner({ partnerId: "a", sharePercent: "100" as Percent })];
    const subsByPartnerId = { a: [makeSub({ subPartnerId: "sub1", partnerId: "a" })] };

    expect(() =>
      buildWithdrawalSnapshot("1000000" as Money, partners, subsByPartnerId, "partner", "sub1"),
    ).toThrow(WithdrawalShareNotFoundError);
  });

  it("lets PartnerSharesNotFullyAllocatedError propagate unchanged (Partner Shares under 100%)", () => {
    const partners = [makePartner({ partnerId: "a", sharePercent: "50" as Percent })];

    expect(() => buildWithdrawalSnapshot("1000000" as Money, partners, {}, "partner", "a")).toThrow(
      PartnerSharesNotFullyAllocatedError,
    );
  });

  it("lets CanTakeSubPartnerSharesOverAllocatedError propagate unchanged", () => {
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" as Percent })],
    };

    expect(() =>
      buildWithdrawalSnapshot("1000000" as Money, partners, subsByPartnerId, "partner", "a"),
    ).toThrow(CanTakeSubPartnerSharesOverAllocatedError);
  });
});

describe("recordWithdrawalTransaction — validation", () => {
  const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

  it("AC2: accepts amount '0' -- no forced withdrawal", async () => {
    const port = createFakeWithdrawalTransactionPort();

    await recordWithdrawalTransaction(
      "project-1",
      "1000000" as Money,
      partners,
      {},
      makeInput({ shareId: "a", amount: "0" }),
      "actor-1",
      { withdrawalTransactions: port },
    );

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]?.amount).toBe("0");
  });

  it("accepts an amount exceeding Can Take -- no cap enforced this story", async () => {
    const port = createFakeWithdrawalTransactionPort();
    // Can Take here is ₹1,00,000 (100% of ₹1,00,000 available); the amount
    // requested is ₹3,00,000, well over it.
    const outcome = await recordWithdrawalTransaction(
      "project-1",
      "100000" as Money,
      partners,
      {},
      makeInput({ shareId: "a", amount: "300000" }),
      "actor-1",
      { withdrawalTransactions: port },
    );

    expect(outcome.created).toBe(true);
    expect(outcome.transaction.amount).toBe("300000");
    expect(port.calls[0]?.canTakeSnapshot).toBe("100000");
  });

  it("rejects a negative amount with InvalidWithdrawalAmountError", async () => {
    const port = createFakeWithdrawalTransactionPort();

    await expect(
      recordWithdrawalTransaction(
        "project-1",
        "1000000" as Money,
        partners,
        {},
        makeInput({ shareId: "a", amount: "-500" }),
        "actor-1",
        { withdrawalTransactions: port },
      ),
    ).rejects.toThrow(InvalidWithdrawalAmountError);
    expect(port.calls).toHaveLength(0);
  });

  it("rejects a malformed amount with InvalidWithdrawalAmountError", async () => {
    const port = createFakeWithdrawalTransactionPort();

    await expect(
      recordWithdrawalTransaction(
        "project-1",
        "1000000" as Money,
        partners,
        {},
        makeInput({ shareId: "a", amount: "not-a-number" }),
        "actor-1",
        { withdrawalTransactions: port },
      ),
    ).rejects.toThrow(InvalidWithdrawalAmountError);
  });

  it("rejects a malformed transactionDate with InvalidWithdrawalDateError", async () => {
    const port = createFakeWithdrawalTransactionPort();

    await expect(
      recordWithdrawalTransaction(
        "project-1",
        "1000000" as Money,
        partners,
        {},
        makeInput({ shareId: "a", transactionDate: "not-a-date" }),
        "actor-1",
        { withdrawalTransactions: port },
      ),
    ).rejects.toThrow(InvalidWithdrawalDateError);
  });

  it("rejects an unrecognized paymentMode with InvalidWithdrawalPaymentModeError", async () => {
    const port = createFakeWithdrawalTransactionPort();

    await expect(
      recordWithdrawalTransaction(
        "project-1",
        "1000000" as Money,
        partners,
        {},
        makeInput({ shareId: "a", paymentMode: "bitcoin" }),
        "actor-1",
        { withdrawalTransactions: port },
      ),
    ).rejects.toThrow(InvalidWithdrawalPaymentModeError);
  });

  it("rejects a missing/blank idempotencyKey with MissingWithdrawalIdempotencyKeyError", async () => {
    const port = createFakeWithdrawalTransactionPort();

    await expect(
      recordWithdrawalTransaction(
        "project-1",
        "1000000" as Money,
        partners,
        {},
        makeInput({ shareId: "a", idempotencyKey: "   " }),
        "actor-1",
        { withdrawalTransactions: port },
      ),
    ).rejects.toThrow(MissingWithdrawalIdempotencyKeyError);
  });

  it("validates amount/date/paymentMode/idempotencyKey before ever calling computeCanTake's preconditions -- an invalid amount on an under-allocated Project still throws the 400-mappable error, not the 409 one", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const underAllocated = [makePartner({ partnerId: "a", sharePercent: "50" as Percent })];

    await expect(
      recordWithdrawalTransaction(
        "project-1",
        "1000000" as Money,
        underAllocated,
        {},
        makeInput({ shareId: "a", amount: "-500" }),
        "actor-1",
        { withdrawalTransactions: port },
      ),
    ).rejects.toThrow(InvalidWithdrawalAmountError);
  });

  it("propagates PartnerSharesNotFullyAllocatedError once field validation passes", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const underAllocated = [makePartner({ partnerId: "a", sharePercent: "50" as Percent })];

    await expect(
      recordWithdrawalTransaction(
        "project-1",
        "1000000" as Money,
        underAllocated,
        {},
        makeInput({ shareId: "a" }),
        "actor-1",
        { withdrawalTransactions: port },
      ),
    ).rejects.toThrow(PartnerSharesNotFullyAllocatedError);
    expect(port.calls).toHaveLength(0);
  });

  it("propagates CanTakeSubPartnerSharesOverAllocatedError once field validation passes", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const overAllocated = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" as Percent })],
    };

    await expect(
      recordWithdrawalTransaction(
        "project-1",
        "1000000" as Money,
        overAllocated,
        subsByPartnerId,
        makeInput({ shareId: "a" }),
        "actor-1",
        { withdrawalTransactions: port },
      ),
    ).rejects.toThrow(CanTakeSubPartnerSharesOverAllocatedError);
    expect(port.calls).toHaveLength(0);
  });

  it("calls the port with the built snapshot and actorUserId once every check passes", async () => {
    const port = createFakeWithdrawalTransactionPort();

    const outcome = await recordWithdrawalTransaction(
      "project-1",
      "1000000" as Money,
      partners,
      {},
      makeInput({ shareId: "a", amount: "700000" }),
      "actor-1",
      { withdrawalTransactions: port },
    );

    expect(outcome.created).toBe(true);
    expect(outcome.transaction.amount).toBe("700000");
    const call = port.calls[0];
    expect(call?.sharePercentSnapshot).toBe("100");
    expect(call?.canTakeSnapshot).toBe("1000000");
    expect(call?.amount).toBe("700000");
    expect(call?.actorUserId).toBe("actor-1");
    expect(call?.projectId).toBe("project-1");
  });

  it("normalizes an explicit empty-string referenceNumber/notes to null", async () => {
    const port = createFakeWithdrawalTransactionPort();

    await recordWithdrawalTransaction(
      "project-1",
      "1000000" as Money,
      partners,
      {},
      makeInput({ shareId: "a", referenceNumber: "", notes: "" }),
      "actor-1",
      { withdrawalTransactions: port },
    );

    expect(port.calls[0]?.referenceNumber).toBeNull();
    expect(port.calls[0]?.notes).toBeNull();
  });

  it("trims whitespace-only referenceNumber/notes to null", async () => {
    const port = createFakeWithdrawalTransactionPort();

    await recordWithdrawalTransaction(
      "project-1",
      "1000000" as Money,
      partners,
      {},
      makeInput({ shareId: "a", referenceNumber: "   ", notes: "  " }),
      "actor-1",
      { withdrawalTransactions: port },
    );

    expect(port.calls[0]?.referenceNumber).toBeNull();
    expect(port.calls[0]?.notes).toBeNull();
  });

  it("WITHDRAWAL_PAYMENT_MODES contains every documented payment mode", () => {
    expect(WITHDRAWAL_PAYMENT_MODES).toEqual([
      "cash",
      "cheque",
      "neft",
      "rtgs",
      "imps",
      "upi",
      "bank_transfer",
      "other",
    ]);
  });
});

describe("listWithdrawalTransactions", () => {
  it("is a thin pass-through to the port's listByProjectId", async () => {
    const port = createFakeWithdrawalTransactionPort();
    await recordWithdrawalTransaction(
      "project-1",
      "1000000" as Money,
      [makePartner({ partnerId: "a", sharePercent: "100" as Percent })],
      {},
      makeInput({ shareId: "a" }),
      "actor-1",
      { withdrawalTransactions: port },
    );

    const result = await listWithdrawalTransactions("project-1", { withdrawalTransactions: port });

    expect(result).toHaveLength(1);
    expect(result[0]?.projectId).toBe("project-1");
  });

  it("returns an empty array for a project with no recorded withdrawals", async () => {
    const port = createFakeWithdrawalTransactionPort();

    const result = await listWithdrawalTransactions("project-1", { withdrawalTransactions: port });

    expect(result).toEqual([]);
  });
});

describe("assertWithdrawalNotCancelled — Story 4.11", () => {
  it("is a no-op for an 'active' status", () => {
    expect(() => assertWithdrawalNotCancelled("active")).not.toThrow();
  });

  it("throws WithdrawalAlreadyCancelledError for a 'cancelled' status", () => {
    expect(() => assertWithdrawalNotCancelled("cancelled")).toThrow(WithdrawalAlreadyCancelledError);
  });
});

describe("assertAmountEditable — Story 4.11 (this story's Decisions #5)", () => {
  it("is a no-op when there are no existing legs, regardless of whether the amount changed", () => {
    expect(() => assertAmountEditable(false, true)).not.toThrow();
    expect(() => assertAmountEditable(false, false)).not.toThrow();
  });

  it("is a no-op when legs exist but the amount didn't change", () => {
    expect(() => assertAmountEditable(true, false)).not.toThrow();
  });

  it("throws WithdrawalAmountLockedByAllocationError only when legs exist AND the amount changed", () => {
    expect(() => assertAmountEditable(true, true)).toThrow(WithdrawalAmountLockedByAllocationError);
  });
});

describe("editWithdrawalTransaction — Story 4.11", () => {
  async function seedActiveWithdrawal(
    port: ReturnType<typeof createFakeWithdrawalTransactionPort>,
    amount = "250000",
  ): Promise<string> {
    const { transaction } = await port.recordTransaction({
      projectId: "project-1",
      partyType: "partner",
      shareId: "a",
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: amount as Money,
      transactionDate: "2026-10-05",
      paymentMode: "neft",
      referenceNumber: null,
      notes: null,
      idempotencyKey: "create-key-1",
      actorUserId: "actor-1",
    });
    return transaction.id;
  }

  it("validates amount/date/paymentMode/idempotencyKey via the same normalize helpers create uses", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister(),
    };

    await expect(
      editWithdrawalTransaction(transactionId, makeEditRequest({ amount: "not-a-number" }), "actor-1", deps),
    ).rejects.toThrow(InvalidWithdrawalAmountError);
    await expect(
      editWithdrawalTransaction(transactionId, makeEditRequest({ transactionDate: "not-a-date" }), "actor-1", deps),
    ).rejects.toThrow(InvalidWithdrawalDateError);
    await expect(
      editWithdrawalTransaction(transactionId, makeEditRequest({ paymentMode: "bitcoin" }), "actor-1", deps),
    ).rejects.toThrow(InvalidWithdrawalPaymentModeError);
    await expect(
      editWithdrawalTransaction(transactionId, makeEditRequest({ idempotencyKey: "  " }), "actor-1", deps),
    ).rejects.toThrow(MissingWithdrawalIdempotencyKeyError);
  });

  it("saves a corrected amount/date/paymentMode/reference/notes in place, calling the port's editTransaction", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister(),
    };

    const result = await editWithdrawalTransaction(
      transactionId,
      makeEditRequest({ amount: "300000", referenceNumber: "REF-2", notes: "corrected" }),
      "actor-1",
      deps,
    );

    expect(result.edited).toBe(true);
    expect(result.transaction.amount).toBe("300000");
    expect(result.transaction.referenceNumber).toBe("REF-2");
    expect(result.transaction.notes).toBe("corrected");
    expect(port.editCalls).toHaveLength(1);
  });

  it("leaves sharePercentSnapshot/canTakeSnapshot/projectId/partyType/shareId untouched by an edit", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);
    const before = await port.findById(transactionId);
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister(),
    };

    const { transaction: after } = await editWithdrawalTransaction(
      transactionId,
      makeEditRequest({ amount: "250000" }),
      "actor-1",
      deps,
    );

    expect(after.sharePercentSnapshot).toBe(before?.sharePercentSnapshot);
    expect(after.canTakeSnapshot).toBe(before?.canTakeSnapshot);
    expect(after.projectId).toBe(before?.projectId);
    expect(after.partyType).toBe(before?.partyType);
    expect(after.shareId).toBe(before?.shareId);
  });

  it("a repeated call with the same idempotencyKey replays (edited: false), not a second edit", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister(),
    };
    const request = makeEditRequest({ amount: "300000", idempotencyKey: "same-key" });

    const first = await editWithdrawalTransaction(transactionId, request, "actor-1", deps);
    const second = await editWithdrawalTransaction(transactionId, request, "actor-1", deps);

    expect(first.edited).toBe(true);
    expect(second.edited).toBe(false);
    expect(second.transaction).toEqual(first.transaction);
    // The port's editTransaction was genuinely called twice (this function
    // has no idempotency logic of its own) -- the replay behavior is proven
    // at the fake port layer, mirroring `editInvestmentTransaction`'s
    // identical test shape.
    expect(port.editCalls).toHaveLength(2);
  });

  it("throws WithdrawalAlreadyCancelledError before any validation when the current row is already cancelled", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);
    await port.cancelTransaction({
      transactionId,
      idempotencyKey: "cancel-key-1",
      actorUserId: "actor-1",
      reason: null,
    });
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister(),
    };

    // A simultaneously-invalid amount is present too -- the already-cancelled
    // guard must still win (fail fast on the most fundamental precondition
    // first), mirroring `editInvestmentTransaction`'s identical guarantee.
    await expect(
      editWithdrawalTransaction(transactionId, makeEditRequest({ amount: "not-a-number" }), "actor-1", deps),
    ).rejects.toThrow(WithdrawalAlreadyCancelledError);
  });

  it("skips the already-cancelled guard (and the amount-locked guard) when no row is found at all", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister(),
    };

    await expect(
      editWithdrawalTransaction("nonexistent-id", makeEditRequest(), "actor-1", deps),
    ).rejects.toThrow(/No fake row/);
  });

  it("rejects an amount change once a destination allocation leg exists for this withdrawal (this story's Decisions #5)", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port, "250000");
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister({
        [transactionId]: [makeLeg({ withdrawalTransactionId: transactionId })],
      }),
    };

    await expect(
      editWithdrawalTransaction(transactionId, makeEditRequest({ amount: "300000" }), "actor-1", deps),
    ).rejects.toThrow(WithdrawalAmountLockedByAllocationError);
  });

  it("allows a non-amount edit even once a destination allocation leg exists (the lock only guards amount)", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port, "250000");
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister({
        [transactionId]: [makeLeg({ withdrawalTransactionId: transactionId })],
      }),
    };

    const result = await editWithdrawalTransaction(
      transactionId,
      makeEditRequest({ amount: "250000", paymentMode: "cash", notes: "same amount, new mode" }),
      "actor-1",
      deps,
    );

    expect(result.edited).toBe(true);
    expect(result.transaction.paymentMode).toBe("cash");
    expect(result.transaction.notes).toBe("same amount, new mode");
  });

  it("allows the amount edit when the submitted amount round-trips to the same value as the current row's (no real change)", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port, "250000");
    const deps: EditWithdrawalTransactionDeps = {
      withdrawalTransactions: port,
      withdrawalDestinationAllocations: createFakeAllocationLister({
        [transactionId]: [makeLeg({ withdrawalTransactionId: transactionId })],
      }),
    };

    // "250000" vs. the stored "250000" -- decimal-equal, not a real change,
    // even though legs already exist.
    await expect(
      editWithdrawalTransaction(transactionId, makeEditRequest({ amount: "250000" }), "actor-1", deps),
    ).resolves.toMatchObject({ edited: true });
  });
});

describe("cancelWithdrawalTransaction — Story 4.11", () => {
  async function seedActiveWithdrawal(
    port: ReturnType<typeof createFakeWithdrawalTransactionPort>,
  ): Promise<string> {
    const { transaction } = await port.recordTransaction({
      projectId: "project-1",
      partyType: "partner",
      shareId: "a",
      sharePercentSnapshot: "50" as Percent,
      canTakeSnapshot: "500000" as Money,
      amount: "250000" as Money,
      transactionDate: "2026-10-05",
      paymentMode: "neft",
      referenceNumber: null,
      notes: null,
      idempotencyKey: "create-key-1",
      actorUserId: "actor-1",
    });
    return transaction.id;
  }

  it("validates idempotencyKey via the same normalizeIdempotencyKey helper", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);

    await expect(
      cancelWithdrawalTransaction(transactionId, { idempotencyKey: "  ", reason: null }, "actor-1", {
        withdrawalTransactions: port,
      }),
    ).rejects.toThrow(MissingWithdrawalIdempotencyKeyError);
  });

  it("cancels an active withdrawal: original flips to cancelled, a reversal row is created", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);

    const result = await cancelWithdrawalTransaction(
      transactionId,
      { idempotencyKey: "cancel-key-1", reason: "recorded by mistake" },
      "actor-1",
      { withdrawalTransactions: port },
    );

    expect(result.cancelled).toBe(true);
    expect(result.originalTransaction.status).toBe("cancelled");
    expect(result.reversalTransaction.status).toBe("cancelled");
    expect(result.reversalTransaction.reversalOfTransactionId).toBe(transactionId);
    expect(port.cancelCalls[0]?.reason).toBe("recorded by mistake");
  });

  it("a repeated call with the same idempotencyKey replays (cancelled: false), not a second cancel", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);
    const input = { idempotencyKey: "same-cancel-key", reason: null };

    const first = await cancelWithdrawalTransaction(transactionId, input, "actor-1", {
      withdrawalTransactions: port,
    });
    const second = await cancelWithdrawalTransaction(transactionId, input, "actor-1", {
      withdrawalTransactions: port,
    });

    expect(first.cancelled).toBe(true);
    expect(second.cancelled).toBe(false);
    expect(second.originalTransaction).toEqual(first.originalTransaction);
    expect(second.reversalTransaction).toEqual(first.reversalTransaction);
    // The port's cancelTransaction was genuinely called twice (this function
    // has no idempotency logic of its own, mirroring `cancelInvestmentTransaction`).
    expect(port.cancelCalls).toHaveLength(2);
  });

  it("lets WithdrawalAlreadyCancelledError propagate for a genuinely new cancel attempt on an already-cancelled withdrawal", async () => {
    const port = createFakeWithdrawalTransactionPort();
    const transactionId = await seedActiveWithdrawal(port);
    await cancelWithdrawalTransaction(transactionId, { idempotencyKey: "cancel-key-1", reason: null }, "actor-1", {
      withdrawalTransactions: port,
    });

    await expect(
      cancelWithdrawalTransaction(transactionId, { idempotencyKey: "cancel-key-2", reason: null }, "actor-1", {
        withdrawalTransactions: port,
      }),
    ).rejects.toThrow(WithdrawalAlreadyCancelledError);
  });
});

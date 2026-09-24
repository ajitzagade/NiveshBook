import { describe, it, expect } from "vitest";
import type { Money, PartnerShare, Percent, SubPartnerShare, WithdrawalTransaction } from "@niveshbook/types";
import { PartnerSharesNotFullyAllocatedError, CanTakeSubPartnerSharesOverAllocatedError } from "./can-take";
import type {
  CreateWithdrawalTransactionInput,
  WithdrawalTransactionPort,
} from "./withdrawal-transaction-port";
import {
  buildWithdrawalSnapshot,
  InvalidWithdrawalAmountError,
  InvalidWithdrawalDateError,
  InvalidWithdrawalPaymentModeError,
  MissingWithdrawalIdempotencyKeyError,
  WithdrawalShareNotFoundError,
  listWithdrawalTransactions,
  recordWithdrawalTransaction,
  WITHDRAWAL_PAYMENT_MODES,
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
 * convention, one ledger over, deliberately narrower (no edit/cancel --
 * Story 4.11's job). `calls` records every `recordTransaction` input
 * verbatim, so tests can assert on exactly what `recordWithdrawalTransaction`
 * built and passed through. Always resolves `created: true` -- the
 * idempotent-replay/concurrent-race behavior is `packages/db`'s own port
 * implementation's job, verified at that layer
 * (`packages/db/src/withdrawal-transaction-port.test.ts`) and by the
 * route-level idempotent-replay test (with this port mocked), not this
 * domain-layer test file's.
 */
function createFakeWithdrawalTransactionPort(): WithdrawalTransactionPort & {
  calls: CreateWithdrawalTransactionInput[];
  rows: WithdrawalTransaction[];
} {
  const calls: CreateWithdrawalTransactionInput[] = [];
  const rows: WithdrawalTransaction[] = [];
  return {
    calls,
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
        createdAt: new Date().toISOString(),
      };
      rows.push(transaction);
      return { transaction, created: true };
    },
    async listByProjectId(projectId) {
      return rows.filter((row) => row.projectId === projectId);
    },
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

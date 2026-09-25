import { describe, it, expect } from "vitest";
import type {
  AuditLogEntry,
  InvestmentRequirement,
  InvestmentTransaction,
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
} from "@niveshbook/types";
import { SharesNotFullyAllocatedError, SubPartnerSharesOverAllocatedError } from "./should-pay";
import { computeInvestmentAdjustment, shareKey } from "./investment-adjustment";
import { sumMoney } from "./decimal-math";
import type {
  CancelInvestmentTransactionInput,
  CreateInvestmentTransactionInput,
  EditInvestmentTransactionInput,
  InvestmentTransactionPort,
} from "./investment-transaction-port";
import {
  AlreadyCancelledError,
  buildTransactionSnapshot,
  cancelInvestmentTransaction,
  editInvestmentTransaction,
  filterActiveTransactions,
  InvalidPaymentModeError,
  InvalidTransactionAmountError,
  InvalidTransactionDateError,
  listAuditLogForTransaction,
  listInvestmentTransactions,
  MissingIdempotencyKeyError,
  recordInvestmentTransaction,
  ShareNotFoundError,
  type CancelInvestmentTransactionRequest,
  type EditInvestmentTransactionRequest,
  type RecordInvestmentTransactionInput,
} from "./investment-transaction";

function makeRequirement(overrides: Partial<InvestmentRequirement> = {}): InvestmentRequirement {
  return {
    id: "req-1",
    projectId: "project-1",
    amount: "1000000" as Money,
    requirementDate: "2026-10-01",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

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

function makeInput(overrides: Partial<RecordInvestmentTransactionInput> = {}): RecordInvestmentTransactionInput {
  return {
    partyType: "partner",
    shareId: "a",
    amount: "700000",
    transactionDate: "2026-10-05",
    paymentMode: "neft",
    referenceNumber: "REF-1",
    notes: null,
    idempotencyKey: "idem-key-1",
    ...overrides,
  };
}

/**
 * An InvestmentTransactionPort backed by a mutable in-memory array --
 * mirrors `investment-requirement.test.ts`'s `createFakeInvestmentRequirementPort`
 * convention. `calls` records every `recordTransaction` input verbatim, so
 * tests can assert on exactly what `recordInvestmentTransaction` built and
 * passed through, without needing a mocking-library-specific matcher.
 * Always resolves `created: true` -- the idempotent-replay/concurrent-race
 * behavior (including the pure `isUniqueViolation` decision helper) is
 * `packages/db`'s own port implementation's job, verified at that layer
 * (`packages/db/src/ports.test.ts`) and by the route-level idempotent-replay
 * test (`transactions/route.test.ts`, with this port mocked), not this
 * domain-layer test file's.
 */
/**
 * Story 3.7 addition: also implements `findById`/`editTransaction`/
 * `findAuditLogByTransactionId` -- mutating `rows` in place on a successful
 * edit (never touching `sharePercentSnapshot`/`shouldPaySnapshot`/
 * `requirementId`/`projectId`/`partyType`/`shareId`/`createdAt`, mirroring
 * `EditInvestmentTransactionInput`'s own structural guarantee -- those
 * fields simply aren't present on `input` to copy from) and appending one
 * `"edit"` entry to `auditEntries`, mirroring `recordTransaction`'s own
 * `"create"`-entry bookkeeping above one level over.
 *
 * `editTransaction` DOES implement a real, if simplified, idempotency
 * check -- mirroring `packages/db`'s own port implementation's
 * check-first-then-replay contract (concurrent-race recovery, the part
 * that genuinely needs a live Postgres UNIQUE constraint to exercise, is
 * still out of scope here and covered at `packages/db/src/ports.test.ts`'s
 * layer): a `Map<idempotencyKey, InvestmentTransaction>` tracks every
 * `idempotencyKey` this fake has already applied an edit for. A repeat call
 * with a previously-seen key returns that stored transaction unchanged
 * (`edited: false`), without mutating `rows` or appending a second
 * `auditEntries` entry -- so a test calling `editInvestmentTransaction`
 * twice with the same key through this fake genuinely exercises the
 * dedup logic, not just a hand-fed `{edited: false}`.
 *
 * Story 3.8 addition: also implements `cancelTransaction` -- mirroring
 * `editTransaction`'s own check-first-then-replay idempotency handling one
 * level over, via a second `Map<idempotencyKey, CancelTransactionResult>`.
 * A genuinely new cancel attempt on an already-`"cancelled"` row (a
 * different `idempotencyKey`, or none tracked yet) throws
 * `AlreadyCancelledError`, mirroring `packages/db`'s own already-cancelled
 * contract -- this fake deliberately does NOT attempt to simulate the
 * FOR-UPDATE-based concurrent-double-submit race itself (that mechanism is
 * `packages/db`'s own job, and it has no meaning against a single-threaded
 * in-memory array); it only proves the *idempotency*
 * (same-key-twice-is-a-no-op-replay) and already-cancelled-rejection
 * contracts this domain-layer module depends on.
 */
function createFakeInvestmentTransactionPort(): InvestmentTransactionPort & {
  calls: CreateInvestmentTransactionInput[];
  editCalls: EditInvestmentTransactionInput[];
  cancelCalls: CancelInvestmentTransactionInput[];
  rows: InvestmentTransaction[];
  auditEntries: AuditLogEntry[];
} {
  const calls: CreateInvestmentTransactionInput[] = [];
  const editCalls: EditInvestmentTransactionInput[] = [];
  const cancelCalls: CancelInvestmentTransactionInput[] = [];
  const rows: InvestmentTransaction[] = [];
  const auditEntries: AuditLogEntry[] = [];
  const appliedEditsByIdempotencyKey = new Map<string, InvestmentTransaction>();
  const appliedCancelsByIdempotencyKey = new Map<
    string,
    { originalTransaction: InvestmentTransaction; reversalTransaction: InvestmentTransaction }
  >();
  return {
    calls,
    editCalls,
    cancelCalls,
    rows,
    auditEntries,
    async recordTransaction(input) {
      calls.push(input);
      const transaction: InvestmentTransaction = {
        id: `tx-${rows.length + 1}`,
        requirementId: input.requirementId,
        projectId: input.projectId,
        partyType: input.partyType,
        shareId: input.shareId,
        sharePercentSnapshot: input.sharePercentSnapshot,
        shouldPaySnapshot: input.shouldPaySnapshot,
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
      auditEntries.push({
        id: `audit-${auditEntries.length + 1}`,
        entityType: "investment_transaction",
        entityId: transaction.id,
        action: "create",
        actorUserId: input.actorUserId,
        oldValue: null,
        newValue: transaction,
        reason: null,
        createdAt: new Date().toISOString(),
      });
      return { transaction, created: true };
    },
    async listByRequirementId(requirementId) {
      return rows.filter((row) => row.requirementId === requirementId);
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async editTransaction(input) {
      editCalls.push(input);

      const alreadyApplied = appliedEditsByIdempotencyKey.get(input.idempotencyKey);
      if (alreadyApplied) {
        // Idempotent replay -- mirrors `packages/db`'s check-first path:
        // return the already-edited current state, no new mutation, no new
        // audit entry.
        return { transaction: alreadyApplied, edited: false };
      }

      const index = rows.findIndex((row) => row.id === input.transactionId);
      const existing = rows[index];
      if (!existing) {
        throw new Error(`No fake row for transactionId ${input.transactionId}`);
      }
      const updated: InvestmentTransaction = {
        ...existing,
        amount: input.amount,
        transactionDate: input.transactionDate,
        paymentMode: input.paymentMode,
        referenceNumber: input.referenceNumber,
        notes: input.notes,
      };
      rows[index] = updated;
      auditEntries.push({
        id: `audit-${auditEntries.length + 1}`,
        entityType: "investment_transaction",
        entityId: updated.id,
        action: "edit",
        actorUserId: input.actorUserId,
        oldValue: existing,
        newValue: updated,
        reason: input.reason,
        createdAt: new Date().toISOString(),
      });
      appliedEditsByIdempotencyKey.set(input.idempotencyKey, updated);
      return { transaction: updated, edited: true };
    },
    async findAuditLogByTransactionId(transactionId) {
      return auditEntries.filter((entry) => entry.entityId === transactionId);
    },
    async cancelTransaction(input) {
      cancelCalls.push(input);

      const alreadyApplied = appliedCancelsByIdempotencyKey.get(input.idempotencyKey);
      if (alreadyApplied) {
        // Idempotent replay -- mirrors `editTransaction`'s check-first path
        // one level over: return the already-cancelled state, no new
        // mutation, no new reversal row, no new audit entry.
        return { ...alreadyApplied, cancelled: false };
      }

      const index = rows.findIndex((row) => row.id === input.transactionId);
      const existing = rows[index];
      if (!existing) {
        throw new Error(`No fake row for transactionId ${input.transactionId}`);
      }
      if (existing.status === "cancelled") {
        throw new AlreadyCancelledError();
      }

      const updatedOriginal: InvestmentTransaction = { ...existing, status: "cancelled" };
      rows[index] = updatedOriginal;

      const reversal: InvestmentTransaction = {
        ...existing,
        id: `tx-${rows.length + 1}`,
        status: "cancelled",
        reversalOfTransactionId: updatedOriginal.id,
        createdAt: new Date().toISOString(),
      };
      rows.push(reversal);

      auditEntries.push({
        id: `audit-${auditEntries.length + 1}`,
        entityType: "investment_transaction",
        entityId: updatedOriginal.id,
        action: "cancel",
        actorUserId: input.actorUserId,
        oldValue: existing,
        newValue: updatedOriginal,
        reason: input.reason,
        createdAt: new Date().toISOString(),
      });

      const result = { originalTransaction: updatedOriginal, reversalTransaction: reversal };
      appliedCancelsByIdempotencyKey.set(input.idempotencyKey, result);
      return { ...result, cancelled: true };
    },
    // Story 4.1 addition: this domain-layer test file has no scenario that
    // exercises Can Take's live amount resolution (that's `can-take.test.ts`/
    // `can-take/route.test.ts`'s job) -- a minimal, correct implementation
    // satisfies the `InvestmentTransactionPort` interface without adding any
    // behavior this file's tests never call.
    async sumActiveAmountByProjectId(projectId) {
      return sumMoney(
        rows
          .filter((row) => row.projectId === projectId && row.status === "active")
          .map((row) => row.amount),
      );
    },
    // Story 5.1 (FR31): a plain, unfiltered read of every row -- mirrors
    // `packages/db`'s own `listAll` shape. This file's tests never exercise
    // Money History (`money-history.test.ts`'s job), so this is a minimal,
    // correct implementation only.
    async listAll() {
      return [...rows];
    },
  };
}

describe("buildTransactionSnapshot", () => {
  it("AC1: Partner A's Should Pay (50/30/20 split of ₹10,00,000) is snapshotted exactly", () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];

    const snapshot = buildTransactionSnapshot(requirement, partners, {}, "partner", "a");

    expect(snapshot.sharePercentSnapshot).toBe("50");
    expect(snapshot.shouldPaySnapshot).toBe("500000");
  });

  it("AC2: a Sub-partner's own snapshot reflects their nested share, not their parent Partner's", () => {
    const requirement = makeRequirement({ amount: "1000000" as Money });
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "30" as Percent }),
      makePartner({ partnerId: "c", name: "C", sharePercent: "20" as Percent }),
    ];
    const subsByPartnerId = {
      a: [
        makeSub({ subPartnerId: "sub1", partnerId: "a", name: "Sub1", sharePercent: "12.5" as Percent }),
        makeSub({ subPartnerId: "sub2", partnerId: "a", name: "Sub2", sharePercent: "12.5" as Percent }),
      ],
    };

    const snapshot = buildTransactionSnapshot(requirement, partners, subsByPartnerId, "sub_partner", "sub1");

    expect(snapshot.sharePercentSnapshot).toBe("12.5");
    expect(snapshot.shouldPaySnapshot).toBe("125000");
  });

  it("throws ShareNotFoundError when partyType is 'partner' but shareId matches nothing", () => {
    const requirement = makeRequirement();
    const partners = [makePartner({ partnerId: "a", sharePercent: "100" as Percent })];

    expect(() => buildTransactionSnapshot(requirement, partners, {}, "partner", "nonexistent")).toThrow(
      ShareNotFoundError,
    );
  });

  it("throws ShareNotFoundError when partyType is 'sub_partner' but shareId matches nothing", () => {
    const requirement = makeRequirement();
    const partners = [makePartner({ partnerId: "a", sharePercent: "100" as Percent })];

    expect(() =>
      buildTransactionSnapshot(requirement, partners, {}, "sub_partner", "nonexistent"),
    ).toThrow(ShareNotFoundError);
  });

  it("throws ShareNotFoundError when a Sub-partner's shareId is passed with partyType 'partner' (no cross-matching)", () => {
    const requirement = makeRequirement();
    const partners = [makePartner({ partnerId: "a", sharePercent: "100" as Percent })];
    const subsByPartnerId = { a: [makeSub({ subPartnerId: "sub1", partnerId: "a" })] };

    expect(() =>
      buildTransactionSnapshot(requirement, partners, subsByPartnerId, "partner", "sub1"),
    ).toThrow(ShareNotFoundError);
  });

  it("lets SharesNotFullyAllocatedError propagate unchanged (Partner Shares under 100%)", () => {
    const requirement = makeRequirement();
    const partners = [makePartner({ partnerId: "a", sharePercent: "50" as Percent })];

    expect(() => buildTransactionSnapshot(requirement, partners, {}, "partner", "a")).toThrow(
      SharesNotFullyAllocatedError,
    );
  });

  it("lets SubPartnerSharesOverAllocatedError propagate unchanged", () => {
    const requirement = makeRequirement();
    const partners = [
      makePartner({ partnerId: "a", name: "A", sharePercent: "50" as Percent }),
      makePartner({ partnerId: "b", name: "B", sharePercent: "50" as Percent }),
    ];
    const subsByPartnerId = {
      a: [makeSub({ subPartnerId: "sub1", partnerId: "a", sharePercent: "60" as Percent })],
    };

    expect(() =>
      buildTransactionSnapshot(requirement, partners, subsByPartnerId, "partner", "a"),
    ).toThrow(SubPartnerSharesOverAllocatedError);
  });
});

describe("recordInvestmentTransaction — validation", () => {
  const requirement = makeRequirement();
  const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

  it("AC2: accepts amount '0' -- no minimum payment enforced", async () => {
    const port = createFakeInvestmentTransactionPort();

    await recordInvestmentTransaction(
      "project-1",
      "req-1",
      requirement,
      partners,
      {},
      makeInput({ shareId: "a", amount: "0" }),
      "actor-1",
      { investmentTransactions: port },
    );

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]?.amount).toBe("0");
  });

  it("rejects a negative amount with InvalidTransactionAmountError", async () => {
    const port = createFakeInvestmentTransactionPort();

    await expect(
      recordInvestmentTransaction(
        "project-1",
        "req-1",
        requirement,
        partners,
        {},
        makeInput({ shareId: "a", amount: "-500" }),
        "actor-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(InvalidTransactionAmountError);
    expect(port.calls).toHaveLength(0);
  });

  it("rejects a malformed amount with InvalidTransactionAmountError", async () => {
    const port = createFakeInvestmentTransactionPort();

    await expect(
      recordInvestmentTransaction(
        "project-1",
        "req-1",
        requirement,
        partners,
        {},
        makeInput({ shareId: "a", amount: "not-a-number" }),
        "actor-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(InvalidTransactionAmountError);
  });

  it("rejects a malformed transactionDate with InvalidTransactionDateError", async () => {
    const port = createFakeInvestmentTransactionPort();

    await expect(
      recordInvestmentTransaction(
        "project-1",
        "req-1",
        requirement,
        partners,
        {},
        makeInput({ shareId: "a", transactionDate: "not-a-date" }),
        "actor-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(InvalidTransactionDateError);
  });

  it("rejects an unrecognized paymentMode with InvalidPaymentModeError", async () => {
    const port = createFakeInvestmentTransactionPort();

    await expect(
      recordInvestmentTransaction(
        "project-1",
        "req-1",
        requirement,
        partners,
        {},
        makeInput({ shareId: "a", paymentMode: "bitcoin" }),
        "actor-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(InvalidPaymentModeError);
  });

  it("rejects a missing/blank idempotencyKey with MissingIdempotencyKeyError", async () => {
    const port = createFakeInvestmentTransactionPort();

    await expect(
      recordInvestmentTransaction(
        "project-1",
        "req-1",
        requirement,
        partners,
        {},
        makeInput({ shareId: "a", idempotencyKey: "   " }),
        "actor-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(MissingIdempotencyKeyError);
  });

  it("validates amount/date/paymentMode/idempotencyKey before ever calling computeShouldPay's preconditions -- an invalid amount on an under-allocated Project still throws the 400-mappable error, not the 409 one", async () => {
    const port = createFakeInvestmentTransactionPort();
    const underAllocated = [makePartner({ partnerId: "a", sharePercent: "50" as Percent })];

    await expect(
      recordInvestmentTransaction(
        "project-1",
        "req-1",
        requirement,
        underAllocated,
        {},
        makeInput({ shareId: "a", amount: "-500" }),
        "actor-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(InvalidTransactionAmountError);
  });

  it("propagates SharesNotFullyAllocatedError once field validation passes", async () => {
    const port = createFakeInvestmentTransactionPort();
    const underAllocated = [makePartner({ partnerId: "a", sharePercent: "50" as Percent })];

    await expect(
      recordInvestmentTransaction(
        "project-1",
        "req-1",
        requirement,
        underAllocated,
        {},
        makeInput({ shareId: "a" }),
        "actor-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(SharesNotFullyAllocatedError);
    expect(port.calls).toHaveLength(0);
  });

  it("calls the port with the built snapshot and actorUserId once every check passes", async () => {
    const port = createFakeInvestmentTransactionPort();

    const outcome = await recordInvestmentTransaction(
      "project-1",
      "req-1",
      requirement,
      partners,
      {},
      makeInput({ shareId: "a", amount: "700000" }),
      "actor-1",
      { investmentTransactions: port },
    );

    expect(outcome.created).toBe(true);
    expect(outcome.transaction.amount).toBe("700000");
    const call = port.calls[0];
    expect(call?.sharePercentSnapshot).toBe("100");
    expect(call?.shouldPaySnapshot).toBe("1000000");
    expect(call?.amount).toBe("700000");
    expect(call?.actorUserId).toBe("actor-1");
    expect(call?.requirementId).toBe("req-1");
    expect(call?.projectId).toBe("project-1");
  });

  it("normalizes an explicit empty-string referenceNumber/notes to null (mirrors project.ts's normalizeDescription)", async () => {
    const port = createFakeInvestmentTransactionPort();

    await recordInvestmentTransaction(
      "project-1",
      "req-1",
      requirement,
      partners,
      {},
      makeInput({ shareId: "a", referenceNumber: "", notes: "" }),
      "actor-1",
      { investmentTransactions: port },
    );

    expect(port.calls[0]?.referenceNumber).toBeNull();
    expect(port.calls[0]?.notes).toBeNull();
  });

  it("normalizes a whitespace-only referenceNumber/notes to null", async () => {
    const port = createFakeInvestmentTransactionPort();

    await recordInvestmentTransaction(
      "project-1",
      "req-1",
      requirement,
      partners,
      {},
      makeInput({ shareId: "a", referenceNumber: "   ", notes: "\t " }),
      "actor-1",
      { investmentTransactions: port },
    );

    expect(port.calls[0]?.referenceNumber).toBeNull();
    expect(port.calls[0]?.notes).toBeNull();
  });

  it("trims a non-empty referenceNumber/notes but keeps its content", async () => {
    const port = createFakeInvestmentTransactionPort();

    await recordInvestmentTransaction(
      "project-1",
      "req-1",
      requirement,
      partners,
      {},
      makeInput({ shareId: "a", referenceNumber: "  REF-42  ", notes: "  paid via bank  " }),
      "actor-1",
      { investmentTransactions: port },
    );

    expect(port.calls[0]?.referenceNumber).toBe("REF-42");
    expect(port.calls[0]?.notes).toBe("paid via bank");
  });

  it("leaves a null referenceNumber/notes as null", async () => {
    const port = createFakeInvestmentTransactionPort();

    await recordInvestmentTransaction(
      "project-1",
      "req-1",
      requirement,
      partners,
      {},
      makeInput({ shareId: "a", referenceNumber: null, notes: null }),
      "actor-1",
      { investmentTransactions: port },
    );

    expect(port.calls[0]?.referenceNumber).toBeNull();
    expect(port.calls[0]?.notes).toBeNull();
  });
});

describe("listInvestmentTransactions", () => {
  it("is a thin pass-through to the port", async () => {
    const port = createFakeInvestmentTransactionPort();
    const requirement = makeRequirement();
    const partners = [makePartner({ partnerId: "a", sharePercent: "100" as Percent })];
    await recordInvestmentTransaction(
      "project-1",
      "req-1",
      requirement,
      partners,
      {},
      makeInput({ shareId: "a" }),
      "actor-1",
      { investmentTransactions: port },
    );

    const result = await listInvestmentTransactions("req-1", { investmentTransactions: port });

    expect(result).toHaveLength(1);
    expect(result[0]?.requirementId).toBe("req-1");
  });

  it("returns an empty list for a requirement with no recorded transactions", async () => {
    const port = createFakeInvestmentTransactionPort();

    const result = await listInvestmentTransactions("req-none", { investmentTransactions: port });

    expect(result).toEqual([]);
  });
});

function makeEditInput(
  overrides: Partial<EditInvestmentTransactionRequest> = {},
): EditInvestmentTransactionRequest {
  return {
    amount: "750000",
    transactionDate: "2026-10-06",
    paymentMode: "upi",
    referenceNumber: "REF-2",
    notes: "corrected amount",
    idempotencyKey: "edit-idem-1",
    reason: "typo'd the original amount",
    ...overrides,
  };
}

/**
 * Seeds one transaction via `recordInvestmentTransaction` and returns its
 * id, so `editInvestmentTransaction`'s tests have a real row (with a real
 * snapshot) to edit against.
 */
async function seedTransaction(
  port: ReturnType<typeof createFakeInvestmentTransactionPort>,
): Promise<InvestmentTransaction> {
  const requirement = makeRequirement();
  const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];
  const { transaction } = await recordInvestmentTransaction(
    "project-1",
    "req-1",
    requirement,
    partners,
    {},
    makeInput({ shareId: "a" }),
    "actor-1",
    { investmentTransactions: port },
  );
  return transaction;
}

describe("editInvestmentTransaction — Story 3.7", () => {
  it("rejects a negative amount with InvalidTransactionAmountError, no write", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await expect(
      editInvestmentTransaction(seeded.id, makeEditInput({ amount: "-500" }), "owner-1", {
        investmentTransactions: port,
      }),
    ).rejects.toThrow(InvalidTransactionAmountError);
    expect(port.editCalls).toHaveLength(0);
  });

  it("accepts amount '0' -- the same no-minimum-payment rule as create", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    const result = await editInvestmentTransaction(
      seeded.id,
      makeEditInput({ amount: "0" }),
      "owner-1",
      { investmentTransactions: port },
    );

    expect(result.transaction.amount).toBe("0");
  });

  it("rejects a malformed transactionDate with InvalidTransactionDateError", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await expect(
      editInvestmentTransaction(
        seeded.id,
        makeEditInput({ transactionDate: "not-a-date" }),
        "owner-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(InvalidTransactionDateError);
    expect(port.editCalls).toHaveLength(0);
  });

  it("rejects an unrecognized paymentMode with InvalidPaymentModeError", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await expect(
      editInvestmentTransaction(seeded.id, makeEditInput({ paymentMode: "bitcoin" }), "owner-1", {
        investmentTransactions: port,
      }),
    ).rejects.toThrow(InvalidPaymentModeError);
    expect(port.editCalls).toHaveLength(0);
  });

  it("rejects a missing/blank idempotencyKey with MissingIdempotencyKeyError", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await expect(
      editInvestmentTransaction(seeded.id, makeEditInput({ idempotencyKey: "   " }), "owner-1", {
        investmentTransactions: port,
      }),
    ).rejects.toThrow(MissingIdempotencyKeyError);
    expect(port.editCalls).toHaveLength(0);
  });

  it("normalizes an explicit empty-string/whitespace-only referenceNumber/notes/reason to null", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await editInvestmentTransaction(
      seeded.id,
      makeEditInput({ referenceNumber: "", notes: "\t ", reason: "" }),
      "owner-1",
      { investmentTransactions: port },
    );

    expect(port.editCalls[0]?.referenceNumber).toBeNull();
    expect(port.editCalls[0]?.notes).toBeNull();
    expect(port.editCalls[0]?.reason).toBeNull();
  });

  it("trims a non-empty referenceNumber/notes/reason but keeps its content", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await editInvestmentTransaction(
      seeded.id,
      makeEditInput({ referenceNumber: "  REF-9  ", notes: "  fixed  ", reason: "  typo  " }),
      "owner-1",
      { investmentTransactions: port },
    );

    expect(port.editCalls[0]?.referenceNumber).toBe("REF-9");
    expect(port.editCalls[0]?.notes).toBe("fixed");
    expect(port.editCalls[0]?.reason).toBe("typo");
  });

  it("passes the transactionId/actorUserId through to the port untouched", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await editInvestmentTransaction(seeded.id, makeEditInput(), "actor-99", {
      investmentTransactions: port,
    });

    expect(port.editCalls[0]?.transactionId).toBe(seeded.id);
    expect(port.editCalls[0]?.actorUserId).toBe("actor-99");
  });

  /**
   * The spec's central guarantee (AD-3 applies to edits too): every
   * identity/snapshot field must be byte-identical before and after an
   * edit -- only `amount`/`transactionDate`/`paymentMode`/`referenceNumber`/
   * `notes` may change. This is doubly guaranteed:
   *
   * - Structurally, by `EditInvestmentTransactionInput`'s shape -- it has no
   *   `sharePercentSnapshot`/`shouldPaySnapshot`/`requirementId`/`projectId`/
   *   `partyType`/`shareId`/its own original `idempotencyKey`/`createdAt`
   *   fields to even pass through, so the port's `UPDATE` structurally
   *   cannot touch any of those 8 fields.
   * - At runtime, by the assertions below -- but only 7 of those 8 fields
   *   are (or can be) asserted here, not all 8: `idempotencyKey` is
   *   deliberately excluded, because `InvestmentTransaction` (the type
   *   `result.transaction` actually is) never exposes that column to begin
   *   with -- it's a write-only, internal field on the row (Story 3.3's
   *   original design), so there is nothing on `result.transaction` to read
   *   and compare it against. The structural guarantee above still fully
   *   covers it; this runtime assertion just can't, by construction.
   */
  it("never touches sharePercentSnapshot/shouldPaySnapshot/requirementId/projectId/partyType/shareId/createdAt", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    const result = await editInvestmentTransaction(
      seeded.id,
      makeEditInput({ amount: "999999" }),
      "owner-1",
      { investmentTransactions: port },
    );

    expect(result.transaction.id).toBe(seeded.id);
    expect(result.transaction.sharePercentSnapshot).toBe(seeded.sharePercentSnapshot);
    expect(result.transaction.shouldPaySnapshot).toBe(seeded.shouldPaySnapshot);
    expect(result.transaction.requirementId).toBe(seeded.requirementId);
    expect(result.transaction.projectId).toBe(seeded.projectId);
    expect(result.transaction.partyType).toBe(seeded.partyType);
    expect(result.transaction.shareId).toBe(seeded.shareId);
    expect(result.transaction.createdAt).toBe(seeded.createdAt);

    // ...while the mutable fields genuinely did change.
    expect(result.transaction.amount).toBe("999999");
    expect(result.transaction.amount).not.toBe(seeded.amount);
  });

  it("calls the port's editTransaction and returns edited: true on a genuine edit", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    const result = await editInvestmentTransaction(seeded.id, makeEditInput(), "owner-1", {
      investmentTransactions: port,
    });

    expect(result.edited).toBe(true);
    expect(port.editCalls).toHaveLength(1);
  });

  /**
   * The idempotency-replay guarantee (I/O matrix row 7, AD-5) -- calling
   * `editInvestmentTransaction` twice with the SAME `idempotencyKey` must
   * apply the edit exactly once. Unlike the tests above, this exercises the
   * fake port's OWN idempotency-tracking logic (see
   * `createFakeInvestmentTransactionPort`'s doc comment) rather than a
   * hand-fed `{edited: false}` result -- both calls genuinely go through
   * `editInvestmentTransaction` -> the port's `editTransaction`, and the
   * second call is the fake's own dedup logic deciding not to re-apply.
   */
  it("applies a genuine edit only once when the SAME idempotencyKey is used twice (idempotent replay)", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port); // amount "700000"
    const input = makeEditInput({ amount: "850000", idempotencyKey: "replay-key-1" });

    const first = await editInvestmentTransaction(seeded.id, input, "owner-1", {
      investmentTransactions: port,
    });
    const second = await editInvestmentTransaction(seeded.id, input, "owner-1", {
      investmentTransactions: port,
    });

    expect(first.edited).toBe(true);
    expect(second.edited).toBe(false);
    expect(second.transaction).toEqual(first.transaction);
    expect(second.transaction.amount).toBe("850000");

    // The port's editTransaction was genuinely called twice (this function
    // performs no dedup of its own -- that's the port's job) ...
    expect(port.editCalls).toHaveLength(2);
    // ... but only ONE edit was actually applied: exactly one "edit" audit
    // entry exists for this transaction, not two.
    const entries = await listAuditLogForTransaction(seeded.id, { investmentTransactions: port });
    expect(entries.filter((entry) => entry.action === "edit")).toHaveLength(1);
  });
});

describe("editInvestmentTransaction — Story 3.8 already-cancelled guard", () => {
  function makeCancelInput(
    overrides: Partial<CancelInvestmentTransactionRequest> = {},
  ): CancelInvestmentTransactionRequest {
    return { idempotencyKey: "cancel-idem-1", reason: null, ...overrides };
  }

  it("throws AlreadyCancelledError before any amount/date/paymentMode/idempotencyKey validation, no write", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);
    await cancelInvestmentTransaction(seeded.id, makeCancelInput(), "owner-1", {
      investmentTransactions: port,
    });

    // Every field below is individually invalid (negative amount, malformed
    // date, unrecognized mode, blank key) -- AlreadyCancelledError must win
    // regardless, proving the guard runs BEFORE normalizeAmount/
    // normalizeTransactionDate/normalizePaymentMode/normalizeIdempotencyKey.
    await expect(
      editInvestmentTransaction(
        seeded.id,
        makeEditInput({ amount: "-500", transactionDate: "not-a-date", paymentMode: "bitcoin", idempotencyKey: "   " }),
        "owner-1",
        { investmentTransactions: port },
      ),
    ).rejects.toThrow(AlreadyCancelledError);
    expect(port.editCalls).toHaveLength(0);
  });

  it("still edits normally when the transaction is active", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    const result = await editInvestmentTransaction(seeded.id, makeEditInput(), "owner-1", {
      investmentTransactions: port,
    });

    expect(result.edited).toBe(true);
  });

  it("skips the guard (falls through to the port's own not-found behavior) when no row exists for transactionId", async () => {
    const port = createFakeInvestmentTransactionPort();

    await expect(
      editInvestmentTransaction("tx-none", makeEditInput(), "owner-1", {
        investmentTransactions: port,
      }),
    ).rejects.toThrow(/No fake row for transactionId/);
  });
});

describe("cancelInvestmentTransaction — Story 3.8, FR42", () => {
  function makeCancelInput(
    overrides: Partial<CancelInvestmentTransactionRequest> = {},
  ): CancelInvestmentTransactionRequest {
    return { idempotencyKey: "cancel-idem-1", reason: "recorded by mistake", ...overrides };
  }

  it("rejects a missing/blank idempotencyKey with MissingIdempotencyKeyError, no write", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await expect(
      cancelInvestmentTransaction(seeded.id, makeCancelInput({ idempotencyKey: "   " }), "owner-1", {
        investmentTransactions: port,
      }),
    ).rejects.toThrow(MissingIdempotencyKeyError);
    expect(port.cancelCalls).toHaveLength(0);
  });

  it("AC1: flips the original row's status to 'cancelled' and creates a linked reversal row carrying the same requirementId/projectId/partyType/shareId/paymentMode/amount, with exactly one 'cancel' audit_log entry", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port); // amount "700000", paymentMode "neft"

    const result = await cancelInvestmentTransaction(seeded.id, makeCancelInput(), "owner-1", {
      investmentTransactions: port,
    });

    expect(result.cancelled).toBe(true);
    expect(result.originalTransaction.status).toBe("cancelled");
    expect(result.originalTransaction.id).toBe(seeded.id);
    // Every other field on the original is untouched (FR42: "the original record is preserved").
    expect(result.originalTransaction.amount).toBe(seeded.amount);
    expect(result.originalTransaction.paymentMode).toBe(seeded.paymentMode);
    expect(result.originalTransaction.requirementId).toBe(seeded.requirementId);

    expect(result.reversalTransaction.status).toBe("cancelled");
    expect(result.reversalTransaction.reversalOfTransactionId).toBe(seeded.id);
    expect(result.reversalTransaction.requirementId).toBe(seeded.requirementId);
    expect(result.reversalTransaction.projectId).toBe(seeded.projectId);
    expect(result.reversalTransaction.partyType).toBe(seeded.partyType);
    expect(result.reversalTransaction.shareId).toBe(seeded.shareId);
    expect(result.reversalTransaction.paymentMode).toBe(seeded.paymentMode);
    expect(result.reversalTransaction.amount).toBe(seeded.amount);
    expect(result.reversalTransaction.id).not.toBe(seeded.id);

    const entries = await listAuditLogForTransaction(seeded.id, { investmentTransactions: port });
    const cancelEntries = entries.filter((entry) => entry.action === "cancel");
    expect(cancelEntries).toHaveLength(1);
    expect(cancelEntries[0]?.reason).toBe("recorded by mistake");
  });

  it("AC1: GET-equivalent listing still returns both the (now-cancelled) original and the reversal row -- never hard-deleted", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await cancelInvestmentTransaction(seeded.id, makeCancelInput(), "owner-1", {
      investmentTransactions: port,
    });

    const transactions = await listInvestmentTransactions(seeded.requirementId, {
      investmentTransactions: port,
    });

    expect(transactions).toHaveLength(2);
    expect(transactions.every((t) => t.status === "cancelled")).toBe(true);
  });

  it("AC3-equivalent (this story): cancelling an already-cancelled transaction with a genuinely different idempotencyKey throws AlreadyCancelledError, no second reversal row", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);
    await cancelInvestmentTransaction(seeded.id, makeCancelInput({ idempotencyKey: "key-1" }), "owner-1", {
      investmentTransactions: port,
    });

    await expect(
      cancelInvestmentTransaction(seeded.id, makeCancelInput({ idempotencyKey: "key-2" }), "owner-1", {
        investmentTransactions: port,
      }),
    ).rejects.toThrow(AlreadyCancelledError);

    const transactions = await listInvestmentTransactions(seeded.requirementId, {
      investmentTransactions: port,
    });
    // Still just the original + its ONE reversal -- no second reversal row.
    expect(transactions).toHaveLength(2);
  });

  /**
   * The idempotency-replay guarantee (this story's I/O matrix, AD-5) --
   * calling `cancelInvestmentTransaction` twice with the SAME
   * `idempotencyKey` must apply the cancel exactly once, mirroring
   * `editInvestmentTransaction`'s identical replay test one level over.
   */
  it("applies a genuine cancel only once when the SAME idempotencyKey is used twice (idempotent replay) -- exactly one reversal row, one audit_log entry", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);
    const input = makeCancelInput({ idempotencyKey: "replay-key-1" });

    const first = await cancelInvestmentTransaction(seeded.id, input, "owner-1", {
      investmentTransactions: port,
    });
    const second = await cancelInvestmentTransaction(seeded.id, input, "owner-1", {
      investmentTransactions: port,
    });

    expect(first.cancelled).toBe(true);
    expect(second.cancelled).toBe(false);
    expect(second.originalTransaction).toEqual(first.originalTransaction);
    expect(second.reversalTransaction).toEqual(first.reversalTransaction);

    // The port's cancelTransaction was genuinely called twice (this function
    // performs no dedup of its own -- that's the port's job) ...
    expect(port.cancelCalls).toHaveLength(2);
    // ... but only ONE cancel was actually applied: exactly one reversal row,
    // and exactly one "cancel" audit_log entry.
    const transactions = await listInvestmentTransactions(seeded.requirementId, {
      investmentTransactions: port,
    });
    expect(transactions).toHaveLength(2);
    const entries = await listAuditLogForTransaction(seeded.id, { investmentTransactions: port });
    expect(entries.filter((entry) => entry.action === "cancel")).toHaveLength(1);
  });

  it("normalizes an explicit empty-string/whitespace-only reason to null", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);

    await cancelInvestmentTransaction(seeded.id, makeCancelInput({ reason: "   " }), "owner-1", {
      investmentTransactions: port,
    });

    const entries = await listAuditLogForTransaction(seeded.id, { investmentTransactions: port });
    expect(entries.find((entry) => entry.action === "cancel")?.reason).toBeNull();
  });
});

describe("filterActiveTransactions — Story 3.8, FR42", () => {
  it("keeps only status: 'active' rows, excluding both a cancelled original and its reversal", () => {
    const active = { status: "active" } as InvestmentTransaction;
    const cancelledOriginal = { status: "cancelled" } as InvestmentTransaction;
    const reversal = { status: "cancelled", reversalOfTransactionId: "orig-1" } as InvestmentTransaction;

    const result = filterActiveTransactions([active, cancelledOriginal, reversal]);

    expect(result).toEqual([active]);
  });

  it("returns an empty array unchanged for an empty input", () => {
    expect(filterActiveTransactions([])).toEqual([]);
  });

  it("returns every row unchanged when all are active", () => {
    const a = { status: "active", id: "a" } as InvestmentTransaction;
    const b = { status: "active", id: "b" } as InvestmentTransaction;

    expect(filterActiveTransactions([a, b])).toEqual([a, b]);
  });
});

/**
 * Proves Story 3.4's `computeInvestmentAdjustment`, `should-pay.ts`, and
 * `recommended-amount.ts` are LITERALLY untouched by Story 3.8 (the spec's
 * Intent: "zero new arithmetic") -- not merely asserted. This test cancels a
 * transaction, then calls the EXISTING, unmodified `computeInvestmentAdjustment`
 * with a `filterActiveTransactions`-filtered list (exactly as `apps/web`'s
 * `adjustments/route.ts`/`my-investment-status/route.ts` now do), and
 * confirms the cancelled amount no longer counts -- mirroring Story 3.7's
 * own "reflects an edited amount with no new recompute logic" test one
 * story over.
 */
describe("Story 3.4's computeInvestmentAdjustment reflects a cancelled transaction with no new recompute logic", () => {
  it("excludes the cancelled amount (and its reversal) from actualPaid on the next view", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port); // amount "700000"

    await cancelInvestmentTransaction(
      seeded.id,
      { idempotencyKey: "cancel-idem-1", reason: null },
      "owner-1",
      { investmentTransactions: port },
    );

    const requirement = makeRequirement();
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

    const transactions = await listInvestmentTransactions("req-1", { investmentTransactions: port });
    // Both the cancelled original and its reversal exist in the raw list --
    // proving the filter (not an absence of rows) is what excludes them.
    expect(transactions).toHaveLength(2);

    const byShareKey: Record<string, Money[]> = {};
    for (const transaction of filterActiveTransactions(transactions)) {
      const key = shareKey(transaction.partyType, transaction.shareId);
      byShareKey[key] = [...(byShareKey[key] ?? []), transaction.amount];
    }

    let counter = 0;
    const upsert = async (input: {
      projectId: string;
      partyType: "partner" | "sub_partner";
      shareId: string;
      requirementId: string;
      shouldPay: Money;
      actualPaid: Money;
      adjustmentType: "pending" | "extra_paid" | "none";
      adjustmentAmount: Money;
    }) => {
      counter += 1;
      return {
        id: `adj-${counter}`,
        ...input,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    };

    const results = await computeInvestmentAdjustment(requirement, partners, {}, byShareKey, {
      investmentAdjustments: { upsert, listByProjectId: async () => [] },
    });

    // No active transaction remains for this share at all -- actualPaid is "0".
    expect(results[0]?.actualPaid).toBe("0");
    expect(results[0]?.actualPaid).not.toBe("700000");
  });
});

describe("listAuditLogForTransaction — Story 3.7", () => {
  it("is a thin pass-through to the port, returning the create entry plus any edit entries", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port);
    await editInvestmentTransaction(seeded.id, makeEditInput(), "owner-1", {
      investmentTransactions: port,
    });

    const entries = await listAuditLogForTransaction(seeded.id, { investmentTransactions: port });

    expect(entries).toHaveLength(2);
    expect(entries[0]?.action).toBe("create");
    expect(entries[1]?.action).toBe("edit");
  });

  it("returns an empty list for a transaction with no audit entries recorded by this fake", async () => {
    const port = createFakeInvestmentTransactionPort();

    const entries = await listAuditLogForTransaction("tx-none", { investmentTransactions: port });

    expect(entries).toEqual([]);
  });
});

/**
 * Proves Story 3.4's `computeInvestmentAdjustment` genuinely picks up an
 * edited amount with ZERO new code from this story (spec-3-7's Intent) --
 * not merely asserted. `computeInvestmentAdjustment` is imported unmodified
 * from `./investment-adjustment` (this story never touches that file); the
 * only wiring this test does itself is grouping the (now-edited) transaction
 * list by `shareKey`, exactly as `apps/web`'s adjustments route already does.
 */
describe("Story 3.4's computeInvestmentAdjustment reflects an edited amount with no new recompute logic", () => {
  it("sums the corrected amount, not the original one, on the next view", async () => {
    const port = createFakeInvestmentTransactionPort();
    const seeded = await seedTransaction(port); // amount "700000"

    await editInvestmentTransaction(seeded.id, makeEditInput({ amount: "850000" }), "owner-1", {
      investmentTransactions: port,
    });

    const requirement = makeRequirement();
    const partners = [makePartner({ partnerId: "a", name: "A", sharePercent: "100" as Percent })];

    const transactions = await listInvestmentTransactions("req-1", { investmentTransactions: port });
    const byShareKey: Record<string, Money[]> = {};
    for (const transaction of transactions) {
      const key = shareKey(transaction.partyType, transaction.shareId);
      byShareKey[key] = [...(byShareKey[key] ?? []), transaction.amount];
    }

    // A minimal, purely-echoing `InvestmentAdjustmentPort.upsert` -- this
    // test's only interest is what `computeInvestmentAdjustment` (Story
    // 3.4, imported unmodified) computes `actualPaid` as, not the
    // persisted-row plumbing around it. Mirrors `investment-adjustment.test.ts`'s
    // own `makeUpsertMock` shape.
    let counter = 0;
    const upsert = async (input: {
      projectId: string;
      partyType: "partner" | "sub_partner";
      shareId: string;
      requirementId: string;
      shouldPay: Money;
      actualPaid: Money;
      adjustmentType: "pending" | "extra_paid" | "none";
      adjustmentAmount: Money;
    }) => {
      counter += 1;
      return {
        id: `adj-${counter}`,
        ...input,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    };

    const results = await computeInvestmentAdjustment(requirement, partners, {}, byShareKey, {
      investmentAdjustments: { upsert, listByProjectId: async () => [] },
    });

    expect(results[0]?.actualPaid).toBe("850000");
    expect(results[0]?.actualPaid).not.toBe("700000");
  });
});

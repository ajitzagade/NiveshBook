import { describe, it, expect } from "vitest";
import type {
  InvestmentRequirement,
  InvestmentTransaction,
  Money,
  PartnerShare,
  Percent,
  SubPartnerShare,
} from "@niveshbook/types";
import { SharesNotFullyAllocatedError, SubPartnerSharesOverAllocatedError } from "./should-pay";
import type {
  CreateInvestmentTransactionInput,
  InvestmentTransactionPort,
} from "./investment-transaction-port";
import {
  buildTransactionSnapshot,
  InvalidPaymentModeError,
  InvalidTransactionAmountError,
  InvalidTransactionDateError,
  listInvestmentTransactions,
  MissingIdempotencyKeyError,
  recordInvestmentTransaction,
  ShareNotFoundError,
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
function createFakeInvestmentTransactionPort(): InvestmentTransactionPort & {
  calls: CreateInvestmentTransactionInput[];
  rows: InvestmentTransaction[];
} {
  const calls: CreateInvestmentTransactionInput[] = [];
  const rows: InvestmentTransaction[] = [];
  return {
    calls,
    rows,
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
        createdAt: new Date().toISOString(),
      };
      rows.push(transaction);
      return { transaction, created: true };
    },
    async listByRequirementId(requirementId) {
      return rows.filter((row) => row.requirementId === requirementId);
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

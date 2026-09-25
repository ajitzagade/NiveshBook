import { describe, it, expect, vi } from "vitest";
import type { InvestmentRequirement, Money, WithdrawalTransaction } from "@niveshbook/types";
import type {
  CreateWithdrawalDestinationAllocationLegInput,
  DestinationSnapshotInput,
  RecordWithdrawalDestinationAllocationResult,
  WithdrawalDestinationAllocationPort,
} from "./withdrawal-destination-allocation-port";
import {
  AllocationMismatchError,
  AlreadyAllocatedError,
  InvalidDestinationProjectError,
  MissingDestinationRequirementError,
  WithdrawalDestinationAllocationIdempotencyKeyConflictError,
  ZeroAmountProjectLegError,
  recordDestinationAllocation,
  listWithdrawalDestinationAllocations,
  type RawDestinationAllocationLeg,
} from "./withdrawal-destination-allocation";
import { InvalidMoneyError } from "./decimal-math";

/** A minimal, valid `DestinationSnapshotInput` (Story 4.8) for a "project" leg -- the route layer's own pre-fetched data, faked here since this domain-layer test never actually calls `buildTransactionSnapshot` itself (that's `move-withdrawal-to-project.test.ts`'s job). */
function fakeDestinationSnapshot(): DestinationSnapshotInput {
  const requirement: InvestmentRequirement = {
    id: "requirement-2",
    projectId: "project-2",
    amount: "500000" as Money,
    requirementDate: "2026-10-01",
    createdAt: new Date().toISOString(),
  };
  return { requirement, partnerShares: [], subPartnerSharesByPartnerId: {} };
}

function makeWithdrawal(overrides: Partial<WithdrawalTransaction> = {}): WithdrawalTransaction {
  return {
    id: "wtx-1",
    projectId: "project-1",
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "50" as WithdrawalTransaction["sharePercentSnapshot"],
    canTakeSnapshot: "250000" as Money,
    amount: "250000" as Money,
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

function makeLeg(overrides: Partial<RawDestinationAllocationLeg> = {}): RawDestinationAllocationLeg {
  return {
    destinationType: "other",
    amount: "250000",
    destinationProjectId: null,
    personName: null,
    notes: "Kept as cash",
    destinationRequirementId: null,
    destinationShareId: null,
    destinationPartyType: null,
    destinationSnapshot: null,
    ...overrides,
  };
}

/** A well-formed "project" leg's overrides (Story 4.8) -- every field `normalizeLeg` requires beyond `destinationProjectId`. */
function projectLegOverrides(
  destinationProjectId: string,
  overrides: Partial<RawDestinationAllocationLeg> = {},
): Partial<RawDestinationAllocationLeg> {
  return {
    destinationType: "project",
    destinationProjectId,
    destinationRequirementId: "requirement-2",
    destinationShareId: "partner-2",
    destinationPartyType: "partner",
    destinationSnapshot: fakeDestinationSnapshot(),
    ...overrides,
  };
}

/**
 * An in-memory fake port -- mirrors `withdrawal-transaction.test.ts`'s
 * `createFakeWithdrawalTransactionPort` convention. Records every call and
 * always resolves `created: true` -- idempotent-replay/already-allocated/
 * concurrent-race behavior is `packages/db`'s own port implementation's job
 * (verified at that layer), not this domain-layer test file's.
 */
function createFakePort(): WithdrawalDestinationAllocationPort & {
  calls: {
    withdrawalTransactionId: string;
    legs: readonly CreateWithdrawalDestinationAllocationLegInput[];
    idempotencyKey: string;
    actorUserId: string;
  }[];
} {
  const calls: {
    withdrawalTransactionId: string;
    legs: readonly CreateWithdrawalDestinationAllocationLegInput[];
    idempotencyKey: string;
    actorUserId: string;
  }[] = [];
  return {
    calls,
    async recordAllocation(withdrawalTransactionId, legs, idempotencyKey, actorUserId) {
      calls.push({ withdrawalTransactionId, legs, idempotencyKey, actorUserId });
      const result: RecordWithdrawalDestinationAllocationResult = {
        allocations: legs.map((leg, index) => ({
          id: `alloc-${index + 1}`,
          withdrawalTransactionId,
          destinationType: leg.destinationType,
          amount: leg.amount,
          destinationProjectId: leg.destinationProjectId,
          personName: leg.personName,
          notes: leg.notes,
          destinationRequirementId: leg.destinationRequirementId,
          destinationShareId: leg.destinationShareId,
          destinationPartyType: leg.destinationPartyType,
          createdAt: new Date().toISOString(),
        })),
        moneyMovements: [],
        created: true,
      };
      return result;
    },
    async listByWithdrawalTransactionId() {
      return [];
    },
    async hasConflictingAllocation() {
      return false;
    },
    async findById() {
      return null;
    },
    async listAll() {
      return [];
    },
  };
}

describe("recordDestinationAllocation", () => {
  it("delegates a valid, exactly-summing multi-leg split to the port (AC1)", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ amount: "250000" as Money });

    const result = await recordDestinationAllocation(
      withdrawal,
      [
        makeLeg({ amount: "150000", ...projectLegOverrides("project-2") }),
        makeLeg({ destinationType: "person", amount: "50000", personName: "Person X", notes: null }),
        makeLeg({ destinationType: "available_balance", amount: "50000", notes: null }),
      ],
      "project-1",
      "actor-1",
      "idem-1",
      { withdrawalDestinationAllocations: port },
    );

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]?.withdrawalTransactionId).toBe("wtx-1");
    expect(port.calls[0]?.legs).toHaveLength(3);
    expect(result.allocations).toHaveLength(3);
    expect(result.created).toBe(true);
  });

  it("accepts a single 'other' leg for the full amount", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ amount: "50000" as Money });

    const result = await recordDestinationAllocation(
      withdrawal,
      [makeLeg({ destinationType: "other", amount: "50000", notes: "Held as cash" })],
      "project-1",
      "actor-1",
      "idem-2",
      { withdrawalDestinationAllocations: port },
    );

    expect(result.created).toBe(true);
    expect(port.calls[0]?.legs).toEqual([
      {
        destinationType: "other",
        amount: "50000",
        destinationProjectId: null,
        personName: null,
        notes: "Held as cash",
        destinationRequirementId: null,
        destinationShareId: null,
        destinationPartyType: null,
        destinationSnapshotInput: null,
      },
    ]);
  });

  it("rejects legs summing to less than the withdrawal's amount", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ amount: "250000" as Money });

    await expect(
      recordDestinationAllocation(
        withdrawal,
        [makeLeg({ amount: "200000" })],
        "project-1",
        "actor-1",
        "idem-3",
        { withdrawalDestinationAllocations: port },
      ),
    ).rejects.toBeInstanceOf(AllocationMismatchError);
    expect(port.calls).toHaveLength(0);
  });

  it("rejects legs summing to more than the withdrawal's amount", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ amount: "250000" as Money });

    await expect(
      recordDestinationAllocation(
        withdrawal,
        [makeLeg({ amount: "300000" })],
        "project-1",
        "actor-1",
        "idem-4",
        { withdrawalDestinationAllocations: port },
      ),
    ).rejects.toBeInstanceOf(AllocationMismatchError);
    expect(port.calls).toHaveLength(0);
  });

  it("rejects a 'project' leg targeting the source Project itself", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ projectId: "project-1", amount: "250000" as Money });

    await expect(
      recordDestinationAllocation(
        withdrawal,
        [makeLeg({ amount: "250000", ...projectLegOverrides("project-1") })],
        "project-1",
        "actor-1",
        "idem-5",
        { withdrawalDestinationAllocations: port },
      ),
    ).rejects.toBeInstanceOf(InvalidDestinationProjectError);
    expect(port.calls).toHaveLength(0);
  });

  it("accepts a 'project' leg targeting a different Project", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ projectId: "project-1", amount: "250000" as Money });

    const result = await recordDestinationAllocation(
      withdrawal,
      [makeLeg({ amount: "250000", ...projectLegOverrides("project-2") })],
      "project-1",
      "actor-1",
      "idem-6",
      { withdrawalDestinationAllocations: port },
    );

    expect(result.created).toBe(true);
    expect(port.calls[0]?.legs[0]).toMatchObject({
      destinationRequirementId: "requirement-2",
      destinationShareId: "partner-2",
      destinationPartyType: "partner",
    });
  });

  it("rejects a 'project' leg missing destinationRequirementId/destinationShareId/destinationPartyType (Story 4.8 -- defense in depth, shared.ts's shape guard already prevents this in practice)", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ projectId: "project-1", amount: "250000" as Money });

    await expect(
      recordDestinationAllocation(
        withdrawal,
        [makeLeg({ destinationType: "project", amount: "250000", destinationProjectId: "project-2" })],
        "project-1",
        "actor-1",
        "idem-6b",
        { withdrawalDestinationAllocations: port },
      ),
    ).rejects.toBeInstanceOf(MissingDestinationRequirementError);
    expect(port.calls).toHaveLength(0);
  });

  it("rejects a 'project' leg with a zero amount -- it would write a real, permanent investment record with nothing backing it (review finding, Story 4.8)", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ projectId: "project-1", amount: "250000" as Money });

    await expect(
      recordDestinationAllocation(
        withdrawal,
        [makeLeg({ amount: "0", ...projectLegOverrides("project-2") })],
        "project-1",
        "actor-1",
        "idem-6c",
        { withdrawalDestinationAllocations: port },
      ),
    ).rejects.toBeInstanceOf(ZeroAmountProjectLegError);
    expect(port.calls).toHaveLength(0);
  });

  it("accepts a zero amount for every non-'project' leg -- only a 'project' leg's real investment record makes a zero-amount entry consequential", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ amount: "0" as Money });

    const result = await recordDestinationAllocation(
      withdrawal,
      [makeLeg({ destinationType: "other", amount: "0", notes: "Nothing withdrawn yet" })],
      "project-1",
      "actor-1",
      "idem-6d",
      { withdrawalDestinationAllocations: port },
    );

    expect(result.created).toBe(true);
  });

  it("propagates InvalidMoneyError for a malformed leg amount", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ amount: "250000" as Money });

    await expect(
      recordDestinationAllocation(
        withdrawal,
        [makeLeg({ amount: "not-a-number" })],
        "project-1",
        "actor-1",
        "idem-7",
        { withdrawalDestinationAllocations: port },
      ),
    ).rejects.toBeInstanceOf(InvalidMoneyError);
    expect(port.calls).toHaveLength(0);
  });

  it("normalizes a blank personName/notes to null", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ amount: "250000" as Money });

    await recordDestinationAllocation(
      withdrawal,
      [makeLeg({ destinationType: "person", amount: "250000", personName: "   ", notes: "  " })],
      "project-1",
      "actor-1",
      "idem-8",
      { withdrawalDestinationAllocations: port },
    );

    expect(port.calls[0]?.legs[0]).toMatchObject({ personName: null, notes: null });
  });

  it("clears destinationProjectId/personName that don't apply to the leg's destinationType", async () => {
    const port = createFakePort();
    const withdrawal = makeWithdrawal({ amount: "250000" as Money });

    await recordDestinationAllocation(
      withdrawal,
      [
        makeLeg({
          destinationType: "available_balance",
          amount: "250000",
          destinationProjectId: "project-2",
          personName: "Someone",
          notes: null,
        }),
      ],
      "project-1",
      "actor-1",
      "idem-9",
      { withdrawalDestinationAllocations: port },
    );

    expect(port.calls[0]?.legs[0]).toMatchObject({ destinationProjectId: null, personName: null });
  });

  it("propagates the port's AlreadyAllocatedError/idempotency-conflict errors unchanged (the atomic path, reached when the fast pre-check finds no conflict)", async () => {
    const withdrawal = makeWithdrawal({ amount: "250000" as Money });
    const alreadyAllocatedPort: WithdrawalDestinationAllocationPort = {
      async recordAllocation() {
        throw new AlreadyAllocatedError();
      },
      async listByWithdrawalTransactionId() {
        return [];
      },
      async hasConflictingAllocation() {
        return false;
      },
      async findById() {
        return null;
      },
      async listAll() {
        return [];
      },
    };
    await expect(
      recordDestinationAllocation(withdrawal, [makeLeg({ amount: "250000" })], "project-1", "actor-1", "idem-10", {
        withdrawalDestinationAllocations: alreadyAllocatedPort,
      }),
    ).rejects.toBeInstanceOf(AlreadyAllocatedError);

    const conflictPort: WithdrawalDestinationAllocationPort = {
      async recordAllocation() {
        throw new WithdrawalDestinationAllocationIdempotencyKeyConflictError();
      },
      async listByWithdrawalTransactionId() {
        return [];
      },
      async hasConflictingAllocation() {
        return false;
      },
      async findById() {
        return null;
      },
      async listAll() {
        return [];
      },
    };
    await expect(
      recordDestinationAllocation(withdrawal, [makeLeg({ amount: "250000" })], "project-1", "actor-1", "idem-11", {
        withdrawalDestinationAllocations: conflictPort,
      }),
    ).rejects.toBeInstanceOf(WithdrawalDestinationAllocationIdempotencyKeyConflictError);
  });

  it("checks the write-once precondition BEFORE content validation -- an already-allocated withdrawal's 409 takes priority over a simultaneously-invalid/mismatched body's 400, never reaching recordAllocation", async () => {
    const withdrawal = makeWithdrawal({ amount: "250000" as Money });
    const recordAllocation = vi.fn();
    const conflictingPort: WithdrawalDestinationAllocationPort = {
      recordAllocation,
      async listByWithdrawalTransactionId() {
        return [];
      },
      async hasConflictingAllocation() {
        return true;
      },
      async findById() {
        return null;
      },
      async listAll() {
        return [];
      },
    };

    // A body that would ALSO fail the exact-sum check on its own (₹1,00,000
    // against a ₹2,50,000 withdrawal) -- still resolves to AlreadyAllocatedError,
    // never AllocationMismatchError, and `recordAllocation` is never called.
    await expect(
      recordDestinationAllocation(
        withdrawal,
        [makeLeg({ amount: "100000" })],
        "project-1",
        "actor-1",
        "idem-12",
        { withdrawalDestinationAllocations: conflictingPort },
      ),
    ).rejects.toBeInstanceOf(AlreadyAllocatedError);
    expect(recordAllocation).not.toHaveBeenCalled();
  });
});

describe("listWithdrawalDestinationAllocations", () => {
  it("passes through to the port", async () => {
    const port = createFakePort();
    const result = await listWithdrawalDestinationAllocations("wtx-1", {
      withdrawalDestinationAllocations: port,
    });
    expect(result).toEqual([]);
  });
});

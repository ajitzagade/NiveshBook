import { describe, it, expect } from "vitest";
import type { InvestmentAdjustment, Money, WithdrawalAdjustment } from "@niveshbook/types";
import { filterAdjustNextTimeByScope, type AdjustNextTimeRawData } from "./adjust-next-time";
import type { MoneyHistoryScope } from "./money-history";

function makeInvestmentAdjustment(overrides: Partial<InvestmentAdjustment> = {}): InvestmentAdjustment {
  return {
    id: "ia-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    requirementId: "req-1",
    shouldPay: "200000" as Money,
    actualPaid: "0" as Money,
    adjustmentType: "pending",
    adjustmentAmount: "200000" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWithdrawalAdjustment(overrides: Partial<WithdrawalAdjustment> = {}): WithdrawalAdjustment {
  return {
    id: "wa-1",
    projectId: "project-a",
    partyType: "partner",
    shareId: "partner-1",
    canTake: "150000" as Money,
    taken: "0" as Money,
    adjustmentType: "keep_for_later",
    adjustmentAmount: "150000" as Money,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const UNRESTRICTED: MoneyHistoryScope = { unrestricted: true };

describe("filterAdjustNextTimeByScope (Story 5.3, FR33/FR34)", () => {
  it("owner_admin (unrestricted) sees every Investment/Withdrawal Adjustment row across every Project", () => {
    const raw: AdjustNextTimeRawData = {
      investmentAdjustments: [
        makeInvestmentAdjustment({ id: "ia-a", projectId: "project-a", shareId: "partner-1" }),
        makeInvestmentAdjustment({ id: "ia-b", projectId: "project-b", shareId: "partner-2" }),
      ],
      withdrawalAdjustments: [
        makeWithdrawalAdjustment({ id: "wa-a", projectId: "project-a", shareId: "partner-1" }),
      ],
    };

    const result = filterAdjustNextTimeByScope(raw, UNRESTRICTED);

    expect(result.investmentAdjustments.map((row) => row.id).sort()).toEqual(["ia-a", "ia-b"]);
    expect(result.withdrawalAdjustments.map((row) => row.id)).toEqual(["wa-a"]);
  });

  it("a scoped actor (Partner/Sub-partner) sees only rows matching their own (partyType, shareId, projectId) triples, independently per section", () => {
    const raw: AdjustNextTimeRawData = {
      investmentAdjustments: [
        makeInvestmentAdjustment({ id: "own", projectId: "project-a", shareId: "partner-1" }),
        makeInvestmentAdjustment({ id: "not-mine", projectId: "project-a", shareId: "partner-2" }),
      ],
      withdrawalAdjustments: [
        makeWithdrawalAdjustment({ id: "own-withdrawal", projectId: "project-a", shareId: "partner-1" }),
        makeWithdrawalAdjustment({ id: "not-mine-withdrawal", projectId: "project-b", shareId: "partner-1" }),
      ],
    };
    const scope: MoneyHistoryScope = {
      unrestricted: false,
      shareKeys: new Set(["partner:partner-1:project-a"]),
    };

    const result = filterAdjustNextTimeByScope(raw, scope);

    expect(result.investmentAdjustments.map((row) => row.id)).toEqual(["own"]);
    expect(result.withdrawalAdjustments.map((row) => row.id)).toEqual(["own-withdrawal"]);
  });

  // Review round 2 (factual correction, 2026-09-25): `investment_adjustments`
  // has exactly ONE current row per `(partyType, shareId, projectId)`
  // (Story 3.4's unique constraint does not include `requirementId`) -- the
  // SAME person can never have two simultaneous rows at the SAME Project via
  // any real write path (`createInvestmentAdjustmentPort.upsert`'s
  // `onConflictDoUpdate` overwrites the one existing row in place). Both rows
  // below share the same default `projectId`/`shareId` (`makeInvestmentAdjustment`'s
  // defaults, only `requirementId`/`id` differ), so this specific input shape
  // is NOT reachable in production -- it exercises `filterAdjustNextTimeByScope`'s
  // own generic, defensive handling of "however many rows the caller passes
  // in" (the function itself has no reason to assume at-most-one-per-Project;
  // that invariant lives one layer up, in the DB's own unique constraint),
  // not a real same-Project-multiplicity scenario. The REAL, reachable
  // version of "one person, multiple Investment Adjustment rows" is
  // cross-Project (see the dedicated test below).
  it("keeps multiple Investment Adjustment rows for the SAME person across different funding requirements -- never merged (this story's I/O matrix)", () => {
    const raw: AdjustNextTimeRawData = {
      investmentAdjustments: [
        makeInvestmentAdjustment({ id: "round-1", requirementId: "req-1", adjustmentAmount: "100000" as Money }),
        makeInvestmentAdjustment({ id: "round-2", requirementId: "req-2", adjustmentAmount: "50000" as Money }),
      ],
      withdrawalAdjustments: [],
    };

    const result = filterAdjustNextTimeByScope(raw, UNRESTRICTED);

    expect(result.investmentAdjustments).toHaveLength(2);
    expect(result.investmentAdjustments.map((row) => row.requirementId).sort()).toEqual(["req-1", "req-2"]);
  });

  // The REAL, reachable version of "one person, multiple Investment
  // Adjustment rows" (review round 2's factual correction) -- two rows for
  // the SAME `(partyType, shareId)` at two DIFFERENT `projectId`s, each its
  // own Project's single current row. Never merged, exactly like the
  // (unreachable) same-Project test above, but this shape is what
  // `createInvestmentAdjustmentPort.upsert`'s own `(partyType, shareId,
  // projectId)` unique constraint actually allows to coexist.
  it("keeps multiple Investment Adjustment rows for the SAME person across different PROJECTS -- never merged (the real, reachable version of the scenario above)", () => {
    const raw: AdjustNextTimeRawData = {
      investmentAdjustments: [
        makeInvestmentAdjustment({
          id: "project-a-row",
          projectId: "project-a",
          requirementId: "req-a",
          adjustmentAmount: "100000" as Money,
        }),
        makeInvestmentAdjustment({
          id: "project-b-row",
          projectId: "project-b",
          requirementId: "req-b",
          adjustmentAmount: "50000" as Money,
        }),
      ],
      withdrawalAdjustments: [],
    };

    const result = filterAdjustNextTimeByScope(raw, UNRESTRICTED);

    expect(result.investmentAdjustments).toHaveLength(2);
    expect(result.investmentAdjustments.map((row) => row.projectId).sort()).toEqual(["project-a", "project-b"]);
  });

  it("returns an empty shareKeys-scoped actor's lists as [] when nothing matches, for both sections independently", () => {
    const raw: AdjustNextTimeRawData = {
      investmentAdjustments: [makeInvestmentAdjustment({ id: "someone-elses" })],
      withdrawalAdjustments: [makeWithdrawalAdjustment({ id: "someone-elses-too" })],
    };
    const scope: MoneyHistoryScope = { unrestricted: false, shareKeys: new Set() };

    const result = filterAdjustNextTimeByScope(raw, scope);

    expect(result.investmentAdjustments).toEqual([]);
    expect(result.withdrawalAdjustments).toEqual([]);
  });
});

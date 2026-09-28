import { describe, it, expect } from "vitest";
import type { Money, MoneyHistoryEntry, MoneyHistoryEntryType } from "@niveshbook/types";
import { deriveMoneyFlowEdges } from "./ownership-money-flow";

function makeEntry(overrides: Partial<MoneyHistoryEntry> = {}): MoneyHistoryEntry {
  return {
    id: "entry-1",
    type: "money_added",
    date: "2026-09-01",
    projectId: "project-a",
    projectName: "Project A",
    partyType: "partner",
    shareId: "partner-1",
    personName: "Asha",
    amount: "100000" as Money,
    paymentMode: "neft",
    from: null,
    to: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    ...overrides,
  };
}

describe("deriveMoneyFlowEdges", () => {
  it("a movement-created money_added entry (from set) becomes an inbound edge", () => {
    const edges = deriveMoneyFlowEdges([makeEntry({ type: "money_added", from: "Project B", amount: "50000" as Money })]);
    expect(edges).toEqual([
      {
        id: "partner:partner-1:in:project:Project B",
        partyType: "partner",
        shareId: "partner-1",
        direction: "in",
        counterpartyKind: "project",
        counterpartyLabel: "Project B",
        amount: "50000",
      },
    ]);
  });

  it("never merges two different-kind counterparties that happen to share the exact same display label -- counterpartyKind is part of the aggregation key", () => {
    const edges = deriveMoneyFlowEdges([
      makeEntry({ type: "moved_to_project", to: "Wallet", amount: "10000" as Money }),
      makeEntry({ type: "given_to_person", to: "Wallet", amount: "20000" as Money }),
    ]);

    expect(edges).toHaveLength(2);
    const project = edges.find((edge) => edge.counterpartyKind === "project");
    const person = edges.find((edge) => edge.counterpartyKind === "person");
    expect(project?.amount).toBe("10000");
    expect(person?.amount).toBe("20000");
  });

  it("a plain money_added entry (from null) produces no edge", () => {
    expect(deriveMoneyFlowEdges([makeEntry({ type: "money_added", from: null })])).toEqual([]);
  });

  it("money_withdrawn never produces an edge of its own -- its legs do", () => {
    expect(deriveMoneyFlowEdges([makeEntry({ type: "money_withdrawn", to: null })])).toEqual([]);
  });

  it("moved_to_project becomes an outbound edge to that Project", () => {
    const edges = deriveMoneyFlowEdges([makeEntry({ type: "moved_to_project", to: "Project C" })]);
    expect(edges).toMatchObject([{ direction: "out", counterpartyKind: "project", counterpartyLabel: "Project C" }]);
  });

  it("used_from_available_balance becomes an outbound edge to that Project", () => {
    const edges = deriveMoneyFlowEdges([makeEntry({ type: "used_from_available_balance", to: "Project D" })]);
    expect(edges).toMatchObject([{ direction: "out", counterpartyKind: "project", counterpartyLabel: "Project D" }]);
  });

  it("added_to_available_balance becomes an outbound edge to the Available Balance pool", () => {
    const edges = deriveMoneyFlowEdges([makeEntry({ type: "added_to_available_balance", to: "Available Balance" })]);
    expect(edges).toMatchObject([
      { direction: "out", counterpartyKind: "available_balance", counterpartyLabel: "Available Balance" },
    ]);
  });

  it("given_to_person with a real name becomes an outbound edge with kind 'person'", () => {
    const edges = deriveMoneyFlowEdges([makeEntry({ type: "given_to_person", to: "Deepa" })]);
    expect(edges).toMatchObject([{ direction: "out", counterpartyKind: "person", counterpartyLabel: "Deepa" }]);
  });

  it("given_to_person with to: 'Other' becomes an outbound edge with kind 'other'", () => {
    const edges = deriveMoneyFlowEdges([makeEntry({ type: "given_to_person", to: "Other" })]);
    expect(edges).toMatchObject([{ direction: "out", counterpartyKind: "other", counterpartyLabel: "Other" }]);
  });

  it("adjustment never produces an edge", () => {
    expect(deriveMoneyFlowEdges([makeEntry({ type: "adjustment" as MoneyHistoryEntryType })])).toEqual([]);
  });

  it("excludes cancelled entries entirely, even if they'd otherwise map to an edge", () => {
    const edges = deriveMoneyFlowEdges([
      makeEntry({ type: "moved_to_project", to: "Project C", status: "cancelled" }),
    ]);
    expect(edges).toEqual([]);
  });

  it("aggregates multiple entries to the same (partyType, shareId, direction, counterparty) into one summed edge", () => {
    const edges = deriveMoneyFlowEdges([
      makeEntry({ id: "e1", type: "moved_to_project", to: "Project C", amount: "100000" as Money }),
      makeEntry({ id: "e2", type: "moved_to_project", to: "Project C", amount: "50000" as Money }),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.amount).toBe("150000");
  });

  it("keeps distinct counterparties as separate edges, even for the same share and direction", () => {
    const edges = deriveMoneyFlowEdges([
      makeEntry({ id: "e1", type: "moved_to_project", to: "Project C", amount: "100000" as Money }),
      makeEntry({ id: "e2", type: "moved_to_project", to: "Project D", amount: "50000" as Money }),
    ]);
    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => edge.counterpartyLabel).sort()).toEqual(["Project C", "Project D"]);
  });

  it("keeps distinct shares as separate edges, even to the same counterparty", () => {
    const edges = deriveMoneyFlowEdges([
      makeEntry({ id: "e1", shareId: "partner-1", type: "moved_to_project", to: "Project C" }),
      makeEntry({ id: "e2", shareId: "partner-2", type: "moved_to_project", to: "Project C" }),
    ]);
    expect(edges).toHaveLength(2);
  });

  it("returns [] for an empty entry list", () => {
    expect(deriveMoneyFlowEdges([])).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import type { Money, MoneyHistoryEntry, MoneyHistoryEntryType } from "@niveshbook/types";
import { MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE, getTrailStartFromEntry } from "./money-history";

function makeEntry(overrides: Partial<MoneyHistoryEntry> = {}): MoneyHistoryEntry {
  return {
    id: "entry-1",
    type: "money_added",
    date: "2026-09-10",
    projectId: "project-a",
    projectName: "Project A",
    partyType: "partner",
    shareId: "share-1",
    personName: "Someone",
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

/**
 * Story 5.2 (FR32) review finding (Review Triage Log row 5): `page.test.tsx`
 * only exercised a hand-copied LOCAL map, not this real exported constant --
 * TypeScript's exhaustiveness check on `Record<MoneyHistoryEntryType,
 * MoneyTrailNodeType>` guards against a MISSING key but not a WRONG value
 * (e.g. transposing two entry types), which a hand-copied duplicate in a
 * test file would silently mirror instead of catch. This file asserts the
 * real mapping directly, one entry type at a time, so a transposition here
 * actually fails.
 */
describe("MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE (Story 5.2, FR32)", () => {
  it.each([
    ["money_added", "investment_transaction"],
    ["money_withdrawn", "withdrawal_transaction"],
    ["moved_to_project", "withdrawal_destination_allocation"],
    ["given_to_person", "withdrawal_destination_allocation"],
    ["added_to_available_balance", "withdrawal_destination_allocation"],
    ["used_from_available_balance", "available_balance_spend"],
  ] satisfies Array<[MoneyHistoryEntryType, string]>)("maps %s -> %s", (entryType, nodeType) => {
    expect(MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE[entryType]).toBe(nodeType);
  });

  it("is exhaustive -- exactly the 6 MoneyHistoryEntryType members, no more, no fewer", () => {
    expect(Object.keys(MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE).sort()).toEqual([
      "added_to_available_balance",
      "given_to_person",
      "money_added",
      "money_withdrawn",
      "moved_to_project",
      "used_from_available_balance",
    ]);
  });
});

describe("getTrailStartFromEntry (Story 5.2, FR32)", () => {
  it("returns the entry's own id paired with its mapped trail node type", () => {
    const entry = makeEntry({ id: "leg-42", type: "moved_to_project" });

    expect(getTrailStartFromEntry(entry)).toEqual({
      type: "withdrawal_destination_allocation",
      id: "leg-42",
    });
  });

  it.each([
    ["money_added", "investment_transaction"],
    ["money_withdrawn", "withdrawal_transaction"],
    ["given_to_person", "withdrawal_destination_allocation"],
    ["added_to_available_balance", "withdrawal_destination_allocation"],
    ["used_from_available_balance", "available_balance_spend"],
  ] satisfies Array<[MoneyHistoryEntryType, string]>)(
    "for entry type %s, resolves { type: %s, id: entry.id }",
    (entryType, nodeType) => {
      const entry = makeEntry({ id: "row-id", type: entryType });
      expect(getTrailStartFromEntry(entry)).toEqual({ type: nodeType, id: "row-id" });
    },
  );

  // Story 5.3 (FR33/FR34, AD-4): an "adjustment" entry has no linked money
  // movement to trace -- returns `null` rather than mapping to a wrong/
  // synthetic trail node.
  it("returns null for an 'adjustment' entry -- nothing to trace", () => {
    const entry = makeEntry({ id: "netting-1", type: "adjustment" });

    expect(getTrailStartFromEntry(entry)).toBeNull();
  });
});

describe("MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE excludes 'adjustment' (Story 5.3, FR33/FR34)", () => {
  it("'adjustment' is not a key -- confirms the exhaustiveness guard forces exclusion, not a silently-wrong mapping", () => {
    expect(Object.prototype.hasOwnProperty.call(MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE, "adjustment")).toBe(
      false,
    );
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import type { MoneyHistoryEntry } from "@niveshbook/types";
import { mapMoneyHistoryEntryToRowCard } from "./money-history-row-card";

const BASE_ENTRY = {
  id: "entry-1",
  type: "money_added",
  date: "2026-09-01",
  projectId: "project-a",
  projectName: "Project A",
  partyType: "partner",
  shareId: "partner-1",
  personName: "Asha",
  amount: "100000",
  paymentMode: "neft",
  from: null,
  to: null,
  notes: "Some notes",
  status: "active",
  reversalOfTransactionId: null,
};

describe("mapMoneyHistoryEntryToRowCard (spec-mobile-responsive-phase2-table-cards, Decision #2)", () => {
  it("maps the 'What Happened' label to title and every other shared column to a field, in the table's own order", () => {
    const result = mapMoneyHistoryEntryToRowCard(BASE_ENTRY as MoneyHistoryEntry);

    expect(result.title).toBe("Money Added");
    expect(result.badge).toBeNull();
    expect(result.fields.map((field) => field.label)).toEqual([
      "Date",
      "Project",
      "Person",
      "Amount",
      "Payment Mode",
      "From",
      "To",
      "Notes",
    ]);
    expect(result.fields[0]?.value).toBe("2026-09-01");
    expect(result.fields[1]?.value).toBe("Project A");
    expect(result.fields[2]?.value).toBe("Asha");
    expect(result.fields[4]?.value).toBe("NEFT");
    expect(result.fields[6]?.value).toBe("—");
    expect(result.fields[7]?.value).toBe("Some notes");
  });

  it("falls back to em-dash for null person/from/to/notes and a missing payment mode", () => {
    const result = mapMoneyHistoryEntryToRowCard({
      ...BASE_ENTRY,
      personName: null,
      paymentMode: null,
      from: null,
      to: null,
      notes: null,
    } as MoneyHistoryEntry);

    expect(result.fields[2]?.value).toBe("—");
    expect(result.fields[4]?.value).toBe("—");
    expect(result.fields[5]?.value).toBe("—");
    expect(result.fields[6]?.value).toBe("—");
    expect(result.fields[7]?.value).toBe("—");
  });

  it("renders a 'Cancelled' badge for a cancelled entry, and 'Cancelled (reversal)' when it's the reversal itself", () => {
    const cancelled = mapMoneyHistoryEntryToRowCard({ ...BASE_ENTRY, status: "cancelled" } as MoneyHistoryEntry);
    expect((cancelled.badge as ReactElement).props).toMatchObject({ variant: "danger" });

    const reversal = mapMoneyHistoryEntryToRowCard({
      ...BASE_ENTRY,
      status: "cancelled",
      reversalOfTransactionId: "entry-0",
    } as MoneyHistoryEntry);
    const reversalChildren = (reversal.badge as ReactElement).props as { children: unknown };
    expect(JSON.stringify(reversalChildren.children)).toContain("(reversal)");
  });
});

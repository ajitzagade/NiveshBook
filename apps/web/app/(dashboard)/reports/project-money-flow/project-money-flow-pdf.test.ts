import { describe, it, expect } from "vitest";
import { formatAmount, formatDate } from "@niveshbook/ui";
import type { ProjectMoneyFlowReportProject } from "@/lib/project-money-flow-report";
import { buildProjectTables } from "./project-money-flow-pdf";

/** Fixture money/percent fields are plain strings, cast loosely at the boundary -- mirrors this codebase's established `"..." as Money` test-fixture convention (e.g. `packages/core/src/should-pay.test.ts`), applied once here instead of per-field. */
function makeProject(overrides: Record<string, unknown> = {}): ProjectMoneyFlowReportProject {
  return {
    projectId: "project-1",
    projectName: "Test Project",
    entries: [],
    moneyFlowEdges: [],
    tree: { scope: { type: "project" }, partners: [], soloSubPartner: null },
    status: {
      available: true,
      shouldPayByRequirement: [],
      canTake: { availableToWithdraw: "0", partners: [] },
    },
    ...overrides,
  } as unknown as ProjectMoneyFlowReportProject;
}

describe("buildProjectTables (pure data-shaping, no jsPDF/DOM involved)", () => {
  it("builds the transactions table from money history entries", () => {
    const entry = {
      id: "e1",
      type: "money_added" as const,
      date: "2026-10-01",
      projectId: "project-1",
      projectName: "Test Project",
      partyType: "partner" as const,
      shareId: "a",
      personName: "Partner A",
      amount: "500000",
      paymentMode: "cash",
      referenceNumber: null,
      notes: "First installment",
      from: null,
      to: null,
      status: "active" as const,
      reversalOfTransactionId: null,
    };
    const tables = buildProjectTables(makeProject({ entries: [entry] }));

    expect(tables.transactions.title).toBe("Transactions");
    expect(tables.transactions.body).toHaveLength(1);
    expect(tables.transactions.body[0]).toEqual([
      formatDate("2026-10-01"),
      "Money Added",
      "Partner A",
      formatAmount("500000"),
      "Cash",
      "—",
      "—",
      "First installment",
    ]);
  });

  it("renders a cancelled entry with the Cancelled suffix", () => {
    const entry = {
      id: "e2",
      type: "money_withdrawn" as const,
      date: "2026-10-02",
      projectId: "project-1",
      projectName: "Test Project",
      partyType: "partner" as const,
      shareId: "a",
      personName: "Partner A",
      amount: "100000",
      paymentMode: "rtgs",
      referenceNumber: null,
      notes: null,
      from: null,
      to: null,
      status: "cancelled" as const,
      reversalOfTransactionId: null,
    };
    const tables = buildProjectTables(makeProject({ entries: [entry] }));

    expect(tables.transactions.body[0][1]).toBe("Money Withdrawn — Cancelled");
  });

  it("marks Should Pay/Can Take unavailable when status.available is false, without dropping the transactions/shares sections", () => {
    const tables = buildProjectTables(
      makeProject({ status: { available: false, reason: "Partner Shares don't total 100%." } }),
    );

    expect(tables.shouldPayByRequirement).toEqual({
      unavailable: true,
      reason: "Partner Shares don't total 100%.",
    });
    expect(tables.canTake).toEqual({ unavailable: true, reason: "Partner Shares don't total 100%." });
    expect(tables.transactions).toBeTruthy();
    expect(tables.shares).toBeTruthy();
  });

  it("builds one Should Pay table per funding requirement, flattening sub-partners under their parent Partner with a ↳ prefix", () => {
    const tables = buildProjectTables(
      makeProject({
        status: {
          available: true,
          shouldPayByRequirement: [
            {
              requirement: {
                id: "req-1",
                projectId: "project-1",
                amount: "1000000",
                requirementDate: "2026-01-01",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              shouldPay: [
                {
                  partnerId: "a",
                  name: "Partner A",
                  sharePercent: "100",
                  shouldPay: "1000000",
                  ownShouldPay: "700000",
                  subPartners: [
                    { subPartnerId: "a1", name: "Sub A1", sharePercent: "30", shouldPay: "300000" },
                  ],
                },
              ],
            },
          ],
          canTake: { availableToWithdraw: "0", partners: [] },
        },
      }),
    );

    expect(Array.isArray(tables.shouldPayByRequirement)).toBe(true);
    const requirementTables = tables.shouldPayByRequirement as Array<{ title: string; body: string[][] }>;
    expect(requirementTables).toHaveLength(1);
    expect(requirementTables[0].title).toContain(formatAmount("1000000"));
    expect(requirementTables[0].body).toEqual([
      ["Partner A", "100%", formatAmount("1000000")],
      ["↳ Sub A1", "30%", formatAmount("300000")],
    ]);
  });

  it("shows an explicit empty state when a Project has no funding requirements at all", () => {
    const tables = buildProjectTables(makeProject());
    expect(tables.shouldPayByRequirement).toEqual([]);
  });

  it("builds the ownership share breakdown table from the tree, flattening sub-partners", () => {
    const tables = buildProjectTables(
      makeProject({
        tree: {
          scope: { type: "project" },
          soloSubPartner: null,
          partners: [
            {
              type: "partner",
              partnerId: "a",
              name: "Partner A",
              sharePercent: "100",
              actualAmount: "1000000",
              totalIn: "1000000",
              totalOut: "200000",
              subPartners: [
                {
                  type: "sub_partner",
                  subPartnerId: "a1",
                  name: "Sub A1",
                  sharePercent: "30",
                  actualAmount: "300000",
                  totalIn: "300000",
                  totalOut: "0",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(tables.shares.body).toEqual([
      ["Partner A", "100%", formatAmount("1000000"), formatAmount("1000000"), formatAmount("200000")],
      ["↳ Sub A1", "30%", formatAmount("300000"), formatAmount("300000"), formatAmount("0")],
    ]);
  });
});

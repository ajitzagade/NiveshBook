import { describe, it, expect } from "vitest";
import type { InvestmentTransaction, PartnerShare, SubPartnerShare, WithdrawalTransaction } from "@niveshbook/types";
import { assembleOwnershipStructure, type OwnershipStructureRawData } from "./ownership-structure";

const PROJECT_ID = "project-1";

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
    name: "Partner A",
    sharePercent: "60" as PartnerShare["sharePercent"],
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeSubPartnerShare(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  const now = new Date().toISOString();
  return {
    id: "sub-row-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: PROJECT_ID,
    name: "Sub 1",
    sharePercent: "25" as SubPartnerShare["sharePercent"],
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeInvestmentTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  const now = new Date().toISOString();
  return {
    id: "itx-1",
    requirementId: "req-1",
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "60" as InvestmentTransaction["sharePercentSnapshot"],
    shouldPaySnapshot: "0" as InvestmentTransaction["shouldPaySnapshot"],
    amount: "0" as InvestmentTransaction["amount"],
    transactionDate: "2026-01-01",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: now,
    ...overrides,
  };
}

function makeWithdrawalTransaction(overrides: Partial<WithdrawalTransaction> = {}): WithdrawalTransaction {
  const now = new Date().toISOString();
  return {
    id: "wtx-1",
    projectId: PROJECT_ID,
    partyType: "partner",
    shareId: "partner-1",
    sharePercentSnapshot: "60" as WithdrawalTransaction["sharePercentSnapshot"],
    canTakeSnapshot: "0" as WithdrawalTransaction["canTakeSnapshot"],
    amount: "0" as WithdrawalTransaction["amount"],
    transactionDate: "2026-01-01",
    paymentMode: "neft",
    referenceNumber: null,
    notes: null,
    status: "active",
    reversalOfTransactionId: null,
    createdAt: now,
    ...overrides,
  };
}

function emptyRaw(overrides: Partial<OwnershipStructureRawData> = {}): OwnershipStructureRawData {
  return {
    currentPartnerShares: [],
    currentSubPartnerShares: [],
    investmentTransactions: [],
    withdrawalTransactions: [],
    ...overrides,
  };
}

describe("assembleOwnershipStructure", () => {
  it("project scope: renders one node per current Partner Share, with their current Sub-partners nested (I/O matrix row 1)", () => {
    const raw = emptyRaw({
      currentPartnerShares: [
        makePartnerShare({ partnerId: "a", name: "A", sharePercent: "60" as PartnerShare["sharePercent"] }),
        makePartnerShare({ partnerId: "b", name: "B", sharePercent: "40" as PartnerShare["sharePercent"] }),
      ],
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-a1", partnerId: "a", name: "Sub A1" }),
        makeSubPartnerShare({ subPartnerId: "sub-a2", partnerId: "a", name: "Sub A2" }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners).toHaveLength(2);
    const partnerA = tree.partners.find((p) => p.partnerId === "a");
    expect(partnerA?.subPartners.map((s) => s.subPartnerId)).toEqual(["sub-a1", "sub-a2"]);
    const partnerB = tree.partners.find((p) => p.partnerId === "b");
    expect(partnerB?.subPartners).toEqual([]);
    expect(tree.soloSubPartner).toBeNull();
  });

  it("project scope: a Project with zero current Partner Shares renders an empty tree, not a crash (I/O matrix row 10)", () => {
    const tree = assembleOwnershipStructure({ type: "project" }, emptyRaw());
    expect(tree.partners).toEqual([]);
  });

  it("a Partner with zero current Sub-partners renders as a leaf -- subPartners: [], not omitted (I/O matrix row 9)", () => {
    const raw = emptyRaw({ currentPartnerShares: [makePartnerShare({ partnerId: "a" })] });
    const tree = assembleOwnershipStructure({ type: "project" }, raw);
    expect(tree.partners[0]?.subPartners).toEqual([]);
  });

  it("carries each node's own raw sharePercent unmodified -- no retained-% computed here (this module's own Decisions)", () => {
    const raw = emptyRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "a", sharePercent: "60" as PartnerShare["sharePercent"] })],
      currentSubPartnerShares: [
        makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "a", sharePercent: "25" as SubPartnerShare["sharePercent"] }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners[0]?.sharePercent).toBe("60");
    expect(tree.partners[0]?.subPartners[0]?.sharePercent).toBe("25");
    expect(tree.partners[0]).not.toHaveProperty("retainedPercent");
  });

  it("Actual Amount mode: sums only status:active investment_transactions.amount for that share, across every requirement (I/O matrix row 4)", () => {
    const raw = emptyRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "a" })],
      investmentTransactions: [
        makeInvestmentTransaction({ requirementId: "req-1", shareId: "a", amount: "1000" as InvestmentTransaction["amount"] }),
        makeInvestmentTransaction({ requirementId: "req-2", shareId: "a", amount: "500" as InvestmentTransaction["amount"] }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners[0]?.actualAmount).toBe("1500");
  });

  it("Actual Amount mode: a cancelled investment transaction is excluded (property 5)", () => {
    const raw = emptyRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "a" })],
      investmentTransactions: [
        makeInvestmentTransaction({ shareId: "a", amount: "1000" as InvestmentTransaction["amount"], status: "active" }),
        makeInvestmentTransaction({ shareId: "a", amount: "9999" as InvestmentTransaction["amount"], status: "cancelled" }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners[0]?.actualAmount).toBe("1000");
  });

  it("Money Flow mode: Total In mirrors Actual Amount's own sum; Total Out sums active withdrawal_transactions.amount (I/O matrix row 5)", () => {
    const raw = emptyRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "a" })],
      investmentTransactions: [
        makeInvestmentTransaction({ shareId: "a", amount: "1000" as InvestmentTransaction["amount"] }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ shareId: "a", amount: "300" as WithdrawalTransaction["amount"] }),
        makeWithdrawalTransaction({ shareId: "a", amount: "200" as WithdrawalTransaction["amount"] }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners[0]?.totalIn).toBe("1000");
    expect(tree.partners[0]?.totalOut).toBe("500");
  });

  it("Money Flow mode: a cancelled withdrawal is excluded from Total Out (property 5)", () => {
    const raw = emptyRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "a" })],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ shareId: "a", amount: "300" as WithdrawalTransaction["amount"], status: "active" }),
        makeWithdrawalTransaction({ shareId: "a", amount: "9999" as WithdrawalTransaction["amount"], status: "cancelled" }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners[0]?.totalOut).toBe("300");
  });

  it("Money Flow mode: Total Out counts a withdrawal later moved to another Project exactly ONCE, never double-counted (Spec Change Log: 'money_withdrawn' alone is the correct sum -- a moved_to_project leg is a sub-allocation of an already-counted withdrawal_transactions row, not separate money leaving the share)", () => {
    const raw = emptyRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "a" })],
      // This row IS the "moved to another Project" withdrawal -- its money's
      // eventual destination (a `withdrawal_destination_allocations` leg of
      // `destinationType: "project"`, and the linked `money_movements` row)
      // lives in tables `OwnershipStructureRawData` deliberately never takes
      // as input, so there is no second amount for this function to
      // (accidentally) add on top of this one row's own `amount`.
      withdrawalTransactions: [
        makeWithdrawalTransaction({ shareId: "a", amount: "50000" as WithdrawalTransaction["amount"] }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners[0]?.totalOut).toBe("50000");
  });

  it("Money Flow mode: Total In/Total Out are genuinely date-blind -- no date filter, ever (Decision #2, 'all-time, no date filter')", () => {
    const raw = emptyRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "a" })],
      investmentTransactions: [
        makeInvestmentTransaction({ shareId: "a", amount: "1000" as InvestmentTransaction["amount"], transactionDate: "2024-01-01" }),
        makeInvestmentTransaction({ shareId: "a", amount: "2000" as InvestmentTransaction["amount"], transactionDate: "2026-09-26" }),
      ],
      withdrawalTransactions: [
        makeWithdrawalTransaction({ shareId: "a", amount: "300" as WithdrawalTransaction["amount"], transactionDate: "2023-06-15" }),
        makeWithdrawalTransaction({ shareId: "a", amount: "700" as WithdrawalTransaction["amount"], transactionDate: "2027-01-01" }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners[0]?.totalIn).toBe("3000");
    expect(tree.partners[0]?.totalOut).toBe("1000");
  });

  it("keeps a Sub-partner's own money strictly separate from their parent Partner's (never rolled up)", () => {
    const raw = emptyRaw({
      currentPartnerShares: [makePartnerShare({ partnerId: "a" })],
      currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "a" })],
      investmentTransactions: [
        makeInvestmentTransaction({ partyType: "partner", shareId: "a", amount: "1000" as InvestmentTransaction["amount"] }),
        makeInvestmentTransaction({ partyType: "sub_partner", shareId: "sub-1", amount: "9999999" as InvestmentTransaction["amount"] }),
      ],
    });

    const tree = assembleOwnershipStructure({ type: "project" }, raw);

    expect(tree.partners[0]?.actualAmount).toBe("1000");
    expect(tree.partners[0]?.subPartners[0]?.actualAmount).toBe("9999999");
  });

  describe("partner scope (Decision #3's privacy boundary)", () => {
    it("returns exactly the one requested Partner (with their own Sub-partners), never a co-partner's data anywhere in the response", () => {
      const raw = emptyRaw({
        currentPartnerShares: [
          makePartnerShare({ partnerId: "a", name: "Partner A" }),
          makePartnerShare({ partnerId: "b", name: "Partner B" }),
        ],
        currentSubPartnerShares: [
          makeSubPartnerShare({ subPartnerId: "sub-a1", partnerId: "a", name: "Sub A1" }),
          makeSubPartnerShare({ subPartnerId: "sub-b1", partnerId: "b", name: "Sub B1" }),
        ],
        investmentTransactions: [
          makeInvestmentTransaction({ partyType: "partner", shareId: "a", amount: "1000" as InvestmentTransaction["amount"] }),
          // Partner B carries a large, distinctly different amount -- must never leak into Partner A's response.
          makeInvestmentTransaction({ partyType: "partner", shareId: "b", amount: "88888888" as InvestmentTransaction["amount"] }),
        ],
      });

      const tree = assembleOwnershipStructure({ type: "partner", partnerId: "a" }, raw);

      expect(tree.partners).toHaveLength(1);
      expect(tree.partners[0]?.partnerId).toBe("a");
      expect(tree.partners[0]?.subPartners.map((s) => s.subPartnerId)).toEqual(["sub-a1"]);
      const serialized = JSON.stringify(tree);
      expect(serialized).not.toContain("Partner B");
      expect(serialized).not.toContain("Sub B1");
      expect(serialized).not.toContain("88888888");
    });

    it("returns an empty partners list when the requested partnerId isn't a current Partner Share", () => {
      const tree = assembleOwnershipStructure(
        { type: "partner", partnerId: "nonexistent" },
        emptyRaw({ currentPartnerShares: [makePartnerShare({ partnerId: "a" })] }),
      );
      expect(tree.partners).toEqual([]);
    });
  });

  describe("sub_partner scope (Story 5.6's 'no sibling, no parent data' rule)", () => {
    it("returns only that one Sub-partner's own node -- no sibling Sub-partner and no parent Partner data anywhere", () => {
      const raw = emptyRaw({
        currentPartnerShares: [makePartnerShare({ partnerId: "a", name: "Partner A" })],
        currentSubPartnerShares: [
          makeSubPartnerShare({ subPartnerId: "sub-1", partnerId: "a", name: "Sub 1" }),
          makeSubPartnerShare({ subPartnerId: "sub-2", partnerId: "a", name: "Sub 2" }),
        ],
        investmentTransactions: [
          makeInvestmentTransaction({ partyType: "sub_partner", shareId: "sub-1", amount: "500" as InvestmentTransaction["amount"] }),
          makeInvestmentTransaction({ partyType: "sub_partner", shareId: "sub-2", amount: "77777777" as InvestmentTransaction["amount"] }),
          makeInvestmentTransaction({ partyType: "partner", shareId: "a", amount: "1000" as InvestmentTransaction["amount"] }),
        ],
      });

      const tree = assembleOwnershipStructure({ type: "sub_partner", subPartnerId: "sub-1" }, raw);

      expect(tree.partners).toEqual([]);
      expect(tree.soloSubPartner?.subPartnerId).toBe("sub-1");
      expect(tree.soloSubPartner?.actualAmount).toBe("500");
      const serialized = JSON.stringify(tree);
      expect(serialized).not.toContain("Sub 2");
      expect(serialized).not.toContain("77777777");
      expect(serialized).not.toContain("Partner A");
    });

    it("returns soloSubPartner: null when the requested subPartnerId isn't a current Sub-partner Share", () => {
      const tree = assembleOwnershipStructure(
        { type: "sub_partner", subPartnerId: "nonexistent" },
        emptyRaw({ currentSubPartnerShares: [makeSubPartnerShare({ subPartnerId: "sub-1" })] }),
      );
      expect(tree.soloSubPartner).toBeNull();
    });
  });
});

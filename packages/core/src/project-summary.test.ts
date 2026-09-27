import { describe, it, expect } from "vitest";
import type { InvestmentRequirement, Money, PartnerShare, Percent, SubPartnerShare } from "@niveshbook/types";
import { assembleProjectSummaries } from "./project-summary";

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "share-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Asha",
    sharePercent: "100" as Percent,
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSubPartnerShare(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  return {
    id: "sub-share-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Bala",
    sharePercent: "50" as Percent,
    userId: null,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInvestmentRequirement(overrides: Partial<InvestmentRequirement> = {}): InvestmentRequirement {
  return {
    id: "req-1",
    projectId: "project-a",
    amount: "1000000" as Money,
    requirementDate: "2026-03-15",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("assembleProjectSummaries", () => {
  it("counts current Partner Shares and Sub-partner Shares scoped to their own Project", () => {
    const summaries = assembleProjectSummaries(["project-a", "project-b"], {
      currentPartnerShares: [
        makePartnerShare({ id: "s1", partnerId: "p1", projectId: "project-a", sharePercent: "50" as Percent }),
        makePartnerShare({ id: "s2", partnerId: "p2", projectId: "project-a", sharePercent: "50" as Percent }),
        makePartnerShare({ id: "s3", partnerId: "p3", projectId: "project-b", sharePercent: "100" as Percent }),
      ],
      currentSubPartnerShares: [
        makeSubPartnerShare({ id: "sub1", subPartnerId: "sub-1", partnerId: "p1", projectId: "project-a" }),
      ],
      investmentRequirements: [],
    });

    expect(summaries["project-a"]).toMatchObject({ partnersCount: 2, subPartnersCount: 1 });
    expect(summaries["project-b"]).toMatchObject({ partnersCount: 1, subPartnersCount: 0 });
  });

  it("sums only current Partner Shares (not Sub-partner Shares) into totalSharePercent", () => {
    const summaries = assembleProjectSummaries(["project-a"], {
      currentPartnerShares: [
        makePartnerShare({ id: "s1", partnerId: "p1", sharePercent: "60" as Percent }),
        makePartnerShare({ id: "s2", partnerId: "p2", sharePercent: "40" as Percent }),
      ],
      currentSubPartnerShares: [
        makeSubPartnerShare({ id: "sub1", subPartnerId: "sub-1", partnerId: "p1", sharePercent: "30" as Percent }),
      ],
      investmentRequirements: [],
    });

    expect(summaries["project-a"]?.totalSharePercent).toBe("100");
  });

  it("marks isFullyAllocated true only when Partner Shares sum to exactly 100", () => {
    const fully = assembleProjectSummaries(["project-a"], {
      currentPartnerShares: [makePartnerShare({ sharePercent: "100" as Percent })],
      currentSubPartnerShares: [],
      investmentRequirements: [],
    });
    expect(fully["project-a"]?.isFullyAllocated).toBe(true);

    const partial = assembleProjectSummaries(["project-a"], {
      currentPartnerShares: [makePartnerShare({ sharePercent: "60" as Percent })],
      currentSubPartnerShares: [],
      investmentRequirements: [],
    });
    expect(partial["project-a"]?.isFullyAllocated).toBe(false);
  });

  it("a Project with no current Partner Shares yet has isFullyAllocated false, not a crash", () => {
    const summaries = assembleProjectSummaries(["project-a"], {
      currentPartnerShares: [],
      currentSubPartnerShares: [],
      investmentRequirements: [],
    });
    expect(summaries["project-a"]).toMatchObject({
      partnersCount: 0,
      totalSharePercent: "0",
      isFullyAllocated: false,
    });
  });

  it("counts Investment Requirements scoped to their own Project", () => {
    const summaries = assembleProjectSummaries(["project-a", "project-b"], {
      currentPartnerShares: [],
      currentSubPartnerShares: [],
      investmentRequirements: [
        makeInvestmentRequirement({ id: "r1", projectId: "project-a" }),
        makeInvestmentRequirement({ id: "r2", projectId: "project-a" }),
        makeInvestmentRequirement({ id: "r3", projectId: "project-b" }),
      ],
    });

    expect(summaries["project-a"]?.addMoneyRoundCount).toBe(2);
    expect(summaries["project-b"]?.addMoneyRoundCount).toBe(1);
  });

  it("returns one row per requested projectId, even ones with zero matching data anywhere", () => {
    const summaries = assembleProjectSummaries(["project-empty"], {
      currentPartnerShares: [],
      currentSubPartnerShares: [],
      investmentRequirements: [],
    });
    expect(Object.keys(summaries)).toEqual(["project-empty"]);
  });
});

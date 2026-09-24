import { describe, it, expect } from "vitest";
import type { InvestmentRequirement, Money } from "@niveshbook/types";
import {
  createInvestmentRequirement,
  listInvestmentRequirements,
  InvalidRequirementAmountError,
  InvalidRequirementDateError,
  type InvestmentRequirementDeps,
} from "./investment-requirement";
import type {
  InvestmentRequirementPort,
  CreateInvestmentRequirementInput,
} from "./investment-requirement-port";

function makeRequirement(overrides: Partial<InvestmentRequirement> = {}): InvestmentRequirement {
  return {
    id: "row-1",
    projectId: "project-1",
    amount: "1000000" as Money,
    requirementDate: "2026-10-01",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** An InvestmentRequirementPort backed by a mutable in-memory array. */
function createFakeInvestmentRequirementPort(seed: InvestmentRequirement[] = []): InvestmentRequirementPort {
  const rows: InvestmentRequirement[] = [...seed];
  let nextRowId = seed.length + 1;
  return {
    async createInvestmentRequirement(input: CreateInvestmentRequirementInput) {
      const row: InvestmentRequirement = {
        id: `row-${nextRowId++}`,
        projectId: input.projectId,
        amount: input.amount,
        requirementDate: input.requirementDate,
        createdAt: new Date().toISOString(),
      };
      rows.push(row);
      return row;
    },
    async listByProjectId(projectId: string) {
      return rows.filter((r) => r.projectId === projectId);
    },
    async findById(id: string) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

describe("createInvestmentRequirement", () => {
  it("creates a requirement with the given amount and date", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    const result = await createInvestmentRequirement(
      "project-1",
      { amount: "1000000", requirementDate: "2026-10-01" },
      deps,
    );

    expect(result.projectId).toBe("project-1");
    expect(result.amount).toBe("1000000");
    expect(result.requirementDate).toBe("2026-10-01");
    expect(await investmentRequirements.listByProjectId("project-1")).toHaveLength(1);
  });

  it("accepts an amount with 2 decimal places, stored exactly", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    const result = await createInvestmentRequirement(
      "project-1",
      { amount: "1000000.50", requirementDate: "2026-10-01" },
      deps,
    );

    expect(result.amount).toBe("1000000.50");
  });

  it("rejects an amount of 0, blocked before save", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    await expect(
      createInvestmentRequirement("project-1", { amount: "0", requirementDate: "2026-10-01" }, deps),
    ).rejects.toThrow(InvalidRequirementAmountError);
    expect(await investmentRequirements.listByProjectId("project-1")).toHaveLength(0);
  });

  it("rejects a negative amount, blocked before save", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    await expect(
      createInvestmentRequirement("project-1", { amount: "-500", requirementDate: "2026-10-01" }, deps),
    ).rejects.toThrow(InvalidRequirementAmountError);
    expect(await investmentRequirements.listByProjectId("project-1")).toHaveLength(0);
  });

  it("rejects an amount with more than 2 decimal places, blocked before save", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    await expect(
      createInvestmentRequirement(
        "project-1",
        { amount: "1000.999", requirementDate: "2026-10-01" },
        deps,
      ),
    ).rejects.toThrow(InvalidRequirementAmountError);
    expect(await investmentRequirements.listByProjectId("project-1")).toHaveLength(0);
  });

  it("rejects a malformed amount, blocked before save", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    await expect(
      createInvestmentRequirement("project-1", { amount: "abc", requirementDate: "2026-10-01" }, deps),
    ).rejects.toThrow(InvalidRequirementAmountError);
  });

  it("rejects a malformed date, blocked before save", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    await expect(
      createInvestmentRequirement("project-1", { amount: "1000000", requirementDate: "not-a-date" }, deps),
    ).rejects.toThrow(InvalidRequirementDateError);
    expect(await investmentRequirements.listByProjectId("project-1")).toHaveLength(0);
  });

  it("rejects a well-shaped but impossible calendar date (e.g. Feb 30)", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    await expect(
      createInvestmentRequirement(
        "project-1",
        { amount: "1000000", requirementDate: "2026-02-30" },
        deps,
      ),
    ).rejects.toThrow(InvalidRequirementDateError);
  });

  it("rejects a date missing leading zeros", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    await expect(
      createInvestmentRequirement("project-1", { amount: "1000000", requirementDate: "2026-9-1" }, deps),
    ).rejects.toThrow(InvalidRequirementDateError);
  });

  it("creates two separate rows for two separate requirements -- never versioned/edited", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    await createInvestmentRequirement(
      "project-1",
      { amount: "1000000", requirementDate: "2026-10-01" },
      deps,
    );
    await createInvestmentRequirement(
      "project-1",
      { amount: "500000", requirementDate: "2026-11-01" },
      deps,
    );

    const all = await investmentRequirements.listByProjectId("project-1");
    expect(all).toHaveLength(2);
  });
});

describe("listInvestmentRequirements", () => {
  it("returns an empty list for a project with none yet", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    expect(await listInvestmentRequirements("project-1", deps)).toEqual([]);
  });

  it("returns every requirement for the given project only", async () => {
    const one = makeRequirement({ id: "row-1", projectId: "project-1" });
    const two = makeRequirement({ id: "row-2", projectId: "project-2" });
    const investmentRequirements = createFakeInvestmentRequirementPort([one, two]);
    const deps: InvestmentRequirementDeps = { investmentRequirements };

    const result = await listInvestmentRequirements("project-1", deps);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("row-1");
  });
});

describe("InvestmentRequirementPort.findById (Story 3.2)", () => {
  it("returns the matching row by its own id", async () => {
    const one = makeRequirement({ id: "row-1", projectId: "project-1" });
    const investmentRequirements = createFakeInvestmentRequirementPort([one]);

    expect(await investmentRequirements.findById("row-1")).toEqual(one);
  });

  it("returns null for an id with no matching row", async () => {
    const investmentRequirements = createFakeInvestmentRequirementPort();

    expect(await investmentRequirements.findById("nonexistent")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import type { SubPartnerShare, Percent } from "@niveshbook/types";
import {
  addSubPartnerShare,
  updateSubPartnerShare,
  listCurrentSubPartnerShares,
  listCurrentSubPartnerSharesForProject,
  listAllCurrentSubPartnerShares,
  computeSubAllocationTotal,
  InvalidSubPartnerNameError,
  InvalidSubPartnerSharePercentError,
  type SubPartnerShareDeps,
} from "./subpartner-share";
import type { SubPartnerSharePort, CreateSubPartnerShareInput } from "./subpartner-share-port";

function makeSubShare(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    subPartnerId: "subpartner-1",
    partnerId: "partner-1",
    projectId: "project-1",
    name: "Sub1",
    sharePercent: "12.5" as Percent,
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

/** A SubPartnerSharePort backed by a mutable in-memory array of version rows. */
function createFakeSubPartnerSharePort(seed: SubPartnerShare[] = []): SubPartnerSharePort {
  const rows: SubPartnerShare[] = [...seed];
  let nextRowId = seed.length + 1;
  return {
    async createSubPartnerShare(input: CreateSubPartnerShareInput) {
      const now = new Date(Date.now() + nextRowId).toISOString(); // monotonically increasing effectiveFrom per call
      const row: SubPartnerShare = {
        id: `row-${nextRowId++}`,
        subPartnerId: input.subPartnerId,
        partnerId: input.partnerId,
        projectId: input.projectId,
        name: input.name,
        sharePercent: input.sharePercent,
        userId: input.userId,
        effectiveFrom: now,
        createdAt: now,
      };
      rows.push(row);
      return row;
    },
    async findLatestBySubPartnerId(subPartnerId: string) {
      const versions = rows.filter((r) => r.subPartnerId === subPartnerId);
      if (versions.length === 0) return null;
      return versions.reduce((latest, r) =>
        new Date(r.effectiveFrom).getTime() > new Date(latest.effectiveFrom).getTime() ? r : latest,
      );
    },
    async listByPartnerId(partnerId: string) {
      return rows.filter((r) => r.partnerId === partnerId);
    },
    async listByProjectId(projectId: string) {
      return rows.filter((r) => r.projectId === projectId);
    },
    async listAll() {
      return [...rows];
    },
  };
}

describe("addSubPartnerShare", () => {
  it("creates the first version row with a fresh, stable subPartnerId", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const result = await addSubPartnerShare(
      "partner-1",
      "project-1",
      { name: "Sub1", sharePercent: "12.5", userId: null },
      deps,
    );

    expect(result.name).toBe("Sub1");
    expect(result.sharePercent).toBe("12.5");
    expect(result.partnerId).toBe("partner-1");
    expect(result.projectId).toBe("project-1");
    expect(result.subPartnerId).toBeTruthy();
    expect(result.userId).toBeNull();
  });

  it("passes a linked userId straight through to the port", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const result = await addSubPartnerShare(
      "partner-1",
      "project-1",
      { name: "Sub1", sharePercent: "12.5", userId: "user-1" },
      deps,
    );

    expect(result.userId).toBe("user-1");
  });

  it("accepts a 2-decimal share (e.g. 33.33), stored exactly", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const result = await addSubPartnerShare(
      "partner-1",
      "project-1",
      { name: "Sub1", sharePercent: "33.33", userId: null },
      deps,
    );

    expect(result.sharePercent).toBe("33.33");
  });

  it.each(["0", "150", "-5"])(
    "rejects an out-of-range share (%j), blocked before save",
    async (sharePercent) => {
      const subPartnerShares = createFakeSubPartnerSharePort();
      const deps: SubPartnerShareDeps = { subPartnerShares };

      await expect(
        addSubPartnerShare(
          "partner-1",
          "project-1",
          { name: "Sub1", sharePercent, userId: null },
          deps,
        ),
      ).rejects.toThrow(InvalidSubPartnerSharePercentError);
      expect(await subPartnerShares.listByPartnerId("partner-1")).toHaveLength(0);
    },
  );

  it.each(["", "   "])("rejects an empty/whitespace-only name (%j)", async (name) => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    await expect(
      addSubPartnerShare("partner-1", "project-1", { name, sharePercent: "12.5", userId: null }, deps),
    ).rejects.toThrow(InvalidSubPartnerNameError);
    expect(await subPartnerShares.listByPartnerId("partner-1")).toHaveLength(0);
  });

  it("assigns two different sub-partners two different subPartnerIds", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const a = await addSubPartnerShare(
      "partner-1",
      "project-1",
      { name: "Sub1", sharePercent: "12.5", userId: null },
      deps,
    );
    const b = await addSubPartnerShare(
      "partner-1",
      "project-1",
      { name: "Sub2", sharePercent: "12.5", userId: null },
      deps,
    );

    expect(a.subPartnerId).not.toBe(b.subPartnerId);
  });

  it("allows a sub-partner share that, alone, exceeds the parent partner's own share -- never blocked here", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const result = await addSubPartnerShare(
      "partner-1",
      "project-1",
      { name: "Sub1", sharePercent: "80", userId: null },
      deps,
    );

    expect(result.sharePercent).toBe("80");
  });
});

describe("updateSubPartnerShare", () => {
  it("creates a new versioned row on edit -- new id/effectiveFrom, same subPartnerId -- old row untouched (AD-3)", async () => {
    const existing = makeSubShare({
      id: "row-1",
      subPartnerId: "subpartner-1",
      partnerId: "partner-1",
      sharePercent: "12.5" as Percent,
    });
    const subPartnerShares = createFakeSubPartnerSharePort([existing]);
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const updated = await updateSubPartnerShare(
      "subpartner-1",
      { name: "Sub1", sharePercent: "20", userId: null },
      deps,
    );

    expect(updated).not.toBeNull();
    expect(updated?.subPartnerId).toBe("subpartner-1");
    expect(updated?.partnerId).toBe("partner-1");
    expect(updated?.id).not.toBe("row-1");
    expect(updated?.sharePercent).toBe("20");

    const allVersions = await subPartnerShares.listByPartnerId("partner-1");
    expect(allVersions).toHaveLength(2);
    const oldRow = allVersions.find((r) => r.id === "row-1");
    expect(oldRow?.sharePercent).toBe("12.5");
  });

  it("full-overwrites userId on edit -- an unlink (null) or a new link both take effect, never carried forward implicitly", async () => {
    const existing = makeSubShare({ id: "row-1", subPartnerId: "subpartner-1", userId: "old-user" });
    const subPartnerShares = createFakeSubPartnerSharePort([existing]);
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const unlinked = await updateSubPartnerShare(
      "subpartner-1",
      { name: "Sub1", sharePercent: "12.5", userId: null },
      deps,
    );
    expect(unlinked?.userId).toBeNull();
  });

  it("always versions even when only the name changes", async () => {
    const existing = makeSubShare({ id: "row-1", subPartnerId: "subpartner-1", name: "Old Name" });
    const subPartnerShares = createFakeSubPartnerSharePort([existing]);
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const updated = await updateSubPartnerShare(
      "subpartner-1",
      { name: "New Name", sharePercent: "12.5", userId: null },
      deps,
    );

    expect(updated?.id).not.toBe("row-1");
    expect(updated?.name).toBe("New Name");
    const allVersions = await subPartnerShares.listByPartnerId("partner-1");
    expect(allVersions).toHaveLength(2);
  });

  it("resolves to null for a nonexistent subPartnerId, so the caller can surface a 404", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const result = await updateSubPartnerShare(
      "unknown-subpartner",
      { name: "X", sharePercent: "12.5", userId: null },
      deps,
    );

    expect(result).toBeNull();
  });

  it("rejects an out-of-range share on edit -- no new version created", async () => {
    const existing = makeSubShare({ id: "row-1", subPartnerId: "subpartner-1" });
    const subPartnerShares = createFakeSubPartnerSharePort([existing]);
    const deps: SubPartnerShareDeps = { subPartnerShares };

    await expect(
      updateSubPartnerShare(
        "subpartner-1",
        { name: "Sub1", sharePercent: "150", userId: null },
        deps,
      ),
    ).rejects.toThrow(InvalidSubPartnerSharePercentError);
    expect(await subPartnerShares.listByPartnerId("partner-1")).toHaveLength(1);
  });
});

describe("listCurrentSubPartnerShares", () => {
  it("reduces multiple version rows down to the latest per subPartnerId", async () => {
    const v1 = makeSubShare({
      id: "row-1",
      subPartnerId: "subpartner-1",
      sharePercent: "12.5" as Percent,
      effectiveFrom: new Date(1000).toISOString(),
    });
    const v2 = makeSubShare({
      id: "row-2",
      subPartnerId: "subpartner-1",
      sharePercent: "20" as Percent,
      effectiveFrom: new Date(2000).toISOString(),
    });
    const other = makeSubShare({
      id: "row-3",
      subPartnerId: "subpartner-2",
      name: "Sub2",
      sharePercent: "12.5" as Percent,
      effectiveFrom: new Date(1500).toISOString(),
    });
    const subPartnerShares = createFakeSubPartnerSharePort([v1, v2, other]);
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const current = await listCurrentSubPartnerShares("partner-1", deps);

    expect(current).toHaveLength(2);
    const subOne = current.find((s) => s.subPartnerId === "subpartner-1");
    expect(subOne?.sharePercent).toBe("20");
    expect(subOne?.id).toBe("row-2");
  });

  it("returns an empty list for a partner with zero sub-partners", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    expect(await listCurrentSubPartnerShares("partner-1", deps)).toEqual([]);
  });
});

describe("listCurrentSubPartnerSharesForProject", () => {
  it("reduces multiple version rows, across every Partner in the Project, down to the latest per subPartnerId", async () => {
    const v1 = makeSubShare({
      id: "row-1",
      subPartnerId: "subpartner-1",
      partnerId: "partner-1",
      projectId: "project-1",
      sharePercent: "12.5" as Percent,
      effectiveFrom: new Date(1000).toISOString(),
    });
    const v2 = makeSubShare({
      id: "row-2",
      subPartnerId: "subpartner-1",
      partnerId: "partner-1",
      projectId: "project-1",
      sharePercent: "20" as Percent,
      effectiveFrom: new Date(2000).toISOString(),
    });
    const otherPartner = makeSubShare({
      id: "row-3",
      subPartnerId: "subpartner-2",
      partnerId: "partner-2",
      projectId: "project-1",
      name: "Sub2",
      sharePercent: "12.5" as Percent,
      effectiveFrom: new Date(1500).toISOString(),
    });
    const otherProject = makeSubShare({
      id: "row-4",
      subPartnerId: "subpartner-3",
      partnerId: "partner-3",
      projectId: "project-2",
      sharePercent: "10" as Percent,
    });
    const subPartnerShares = createFakeSubPartnerSharePort([v1, v2, otherPartner, otherProject]);
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const current = await listCurrentSubPartnerSharesForProject("project-1", deps);

    expect(current).toHaveLength(2);
    const subOne = current.find((s) => s.subPartnerId === "subpartner-1");
    expect(subOne?.sharePercent).toBe("20");
    expect(subOne?.id).toBe("row-2");
    expect(current.some((s) => s.subPartnerId === "subpartner-3")).toBe(false);
  });

  it("returns an empty list for a project with zero sub-partners", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    expect(await listCurrentSubPartnerSharesForProject("project-1", deps)).toEqual([]);
  });
});

describe("listAllCurrentSubPartnerShares (Story 5.1, mirrors listAllCurrentPartnerShares one level down)", () => {
  it("reduces multiple version rows, across every Partner AND every Project, down to the latest per subPartnerId", async () => {
    const v1 = makeSubShare({
      id: "row-1",
      subPartnerId: "subpartner-1",
      partnerId: "partner-1",
      projectId: "project-1",
      sharePercent: "12.5" as Percent,
      effectiveFrom: new Date(1000).toISOString(),
    });
    const v2 = makeSubShare({
      id: "row-2",
      subPartnerId: "subpartner-1",
      partnerId: "partner-1",
      projectId: "project-1",
      sharePercent: "20" as Percent,
      effectiveFrom: new Date(2000).toISOString(),
    });
    const otherProject = makeSubShare({
      id: "row-3",
      subPartnerId: "subpartner-2",
      partnerId: "partner-2",
      projectId: "project-2",
      name: "Sub2",
      sharePercent: "10" as Percent,
      effectiveFrom: new Date(1500).toISOString(),
    });
    const subPartnerShares = createFakeSubPartnerSharePort([v1, v2, otherProject]);
    const deps: SubPartnerShareDeps = { subPartnerShares };

    const current = await listAllCurrentSubPartnerShares(deps);

    expect(current).toHaveLength(2);
    const subOne = current.find((s) => s.subPartnerId === "subpartner-1");
    expect(subOne?.sharePercent).toBe("20");
    expect(subOne?.id).toBe("row-2");
    expect(current.some((s) => s.subPartnerId === "subpartner-2" && s.projectId === "project-2")).toBe(true);
  });

  it("returns an empty list when no Sub-partners exist anywhere", async () => {
    const subPartnerShares = createFakeSubPartnerSharePort();
    const deps: SubPartnerShareDeps = { subPartnerShares };

    expect(await listAllCurrentSubPartnerShares(deps)).toEqual([]);
  });
});

describe("computeSubAllocationTotal", () => {
  it("sums two sub-partners to a total under the parent partner's 50% share", () => {
    const shares = [
      makeSubShare({ subPartnerId: "a", sharePercent: "12.5" as Percent }),
      makeSubShare({ subPartnerId: "b", sharePercent: "12.5" as Percent }),
    ];
    expect(computeSubAllocationTotal(shares)).toBe("25");
  });

  it("returns 0 for no sub-partner shares", () => {
    expect(computeSubAllocationTotal([])).toBe("0");
  });

  it("computes an over-allocated total (60) against a 50% parent share, without blocking", () => {
    const shares = [
      makeSubShare({ subPartnerId: "a", sharePercent: "30" as Percent }),
      makeSubShare({ subPartnerId: "b", sharePercent: "30" as Percent }),
    ];
    expect(computeSubAllocationTotal(shares)).toBe("60");
  });
});

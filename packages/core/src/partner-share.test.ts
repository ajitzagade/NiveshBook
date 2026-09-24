import { describe, it, expect } from "vitest";
import type { PartnerShare, Percent } from "@niveshbook/types";
import {
  addPartnerShare,
  updatePartnerShare,
  listCurrentPartnerShares,
  computeShareTotal,
  InvalidPartnerNameError,
  InvalidSharePercentError,
  type PartnerShareDeps,
} from "./partner-share";
import type { PartnerSharePort, CreatePartnerShareInput } from "./partner-share-port";

function makeShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: "project-1",
    name: "Partner A",
    sharePercent: "50" as Percent,
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

/** A PartnerSharePort backed by a mutable in-memory array of version rows. */
function createFakePartnerSharePort(seed: PartnerShare[] = []): PartnerSharePort {
  const rows: PartnerShare[] = [...seed];
  let nextRowId = seed.length + 1;
  return {
    async createPartnerShare(input: CreatePartnerShareInput) {
      const now = new Date(Date.now() + nextRowId).toISOString(); // monotonically increasing effectiveFrom per call
      const row: PartnerShare = {
        id: `row-${nextRowId++}`,
        partnerId: input.partnerId,
        projectId: input.projectId,
        name: input.name,
        sharePercent: input.sharePercent,
        userId: input.userId,
        subPartnerVisibilityGrant: input.subPartnerVisibilityGrant,
        effectiveFrom: now,
        createdAt: now,
      };
      rows.push(row);
      return row;
    },
    async findLatestByPartnerId(partnerId: string) {
      const versions = rows.filter((r) => r.partnerId === partnerId);
      if (versions.length === 0) return null;
      return versions.reduce((latest, r) =>
        new Date(r.effectiveFrom).getTime() > new Date(latest.effectiveFrom).getTime() ? r : latest,
      );
    },
    async listByProjectId(projectId: string) {
      return rows.filter((r) => r.projectId === projectId);
    },
  };
}

describe("addPartnerShare", () => {
  it("creates the first version row with a fresh, stable partnerId", async () => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    const result = await addPartnerShare(
      "project-1",
      { name: "Partner A", sharePercent: "50", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );

    expect(result.name).toBe("Partner A");
    expect(result.sharePercent).toBe("50");
    expect(result.projectId).toBe("project-1");
    expect(result.partnerId).toBeTruthy();
    expect(result.userId).toBeNull();
  });

  it("passes a linked userId straight through to the port", async () => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    const result = await addPartnerShare(
      "project-1",
      { name: "Partner A", sharePercent: "50", userId: "user-1", subPartnerVisibilityGrant: false },
      deps,
    );

    expect(result.userId).toBe("user-1");
  });

  it("passes subPartnerVisibilityGrant: true straight through to the port (Story 2.6)", async () => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    const result = await addPartnerShare(
      "project-1",
      { name: "Partner A", sharePercent: "50", userId: null, subPartnerVisibilityGrant: true },
      deps,
    );

    expect(result.subPartnerVisibilityGrant).toBe(true);
  });

  it("defaults subPartnerVisibilityGrant to false when explicitly provided as false", async () => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    const result = await addPartnerShare(
      "project-1",
      { name: "Partner A", sharePercent: "50", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );

    expect(result.subPartnerVisibilityGrant).toBe(false);
  });

  it("accepts a 2-decimal share (e.g. 33.33), stored exactly", async () => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    const result = await addPartnerShare(
      "project-1",
      { name: "Partner A", sharePercent: "33.33", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );

    expect(result.sharePercent).toBe("33.33");
  });

  it.each(["0", "150", "-5"])(
    "rejects an out-of-range share (%j), blocked before save",
    async (sharePercent) => {
      const partnerShares = createFakePartnerSharePort();
      const deps: PartnerShareDeps = { partnerShares };

      await expect(
        addPartnerShare("project-1", { name: "Partner A", sharePercent, userId: null, subPartnerVisibilityGrant: false }, deps),
      ).rejects.toThrow(InvalidSharePercentError);
      expect(await partnerShares.listByProjectId("project-1")).toHaveLength(0);
    },
  );

  it.each(["", "   "])("rejects an empty/whitespace-only name (%j)", async (name) => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    await expect(
      addPartnerShare("project-1", { name, sharePercent: "50", userId: null, subPartnerVisibilityGrant: false }, deps),
    ).rejects.toThrow(InvalidPartnerNameError);
    expect(await partnerShares.listByProjectId("project-1")).toHaveLength(0);
  });

  it("assigns two different partners two different partnerIds", async () => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    const a = await addPartnerShare(
      "project-1",
      { name: "Partner A", sharePercent: "50", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );
    const b = await addPartnerShare(
      "project-1",
      { name: "Partner B", sharePercent: "30", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );

    expect(a.partnerId).not.toBe(b.partnerId);
  });
});

describe("updatePartnerShare", () => {
  it("creates a new versioned row on edit -- new id/effectiveFrom, same partnerId -- old row untouched (AD-3)", async () => {
    const existing = makeShare({ id: "row-1", partnerId: "partner-1", sharePercent: "50" as Percent });
    const partnerShares = createFakePartnerSharePort([existing]);
    const deps: PartnerShareDeps = { partnerShares };

    const updated = await updatePartnerShare(
      "partner-1",
      { name: "Partner A", sharePercent: "60", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );

    expect(updated).not.toBeNull();
    expect(updated?.partnerId).toBe("partner-1");
    expect(updated?.id).not.toBe("row-1");
    expect(updated?.sharePercent).toBe("60");

    const allVersions = await partnerShares.listByProjectId("project-1");
    expect(allVersions).toHaveLength(2);
    const oldRow = allVersions.find((r) => r.id === "row-1");
    expect(oldRow?.sharePercent).toBe("50");
  });

  it("full-overwrites userId on edit -- an unlink (null) or a new link both take effect, never carried forward implicitly", async () => {
    const existing = makeShare({ id: "row-1", partnerId: "partner-1", userId: "old-user" });
    const partnerShares = createFakePartnerSharePort([existing]);
    const deps: PartnerShareDeps = { partnerShares };

    const unlinked = await updatePartnerShare(
      "partner-1",
      { name: "Partner A", sharePercent: "50", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );
    expect(unlinked?.userId).toBeNull();
  });

  it("full-overwrites subPartnerVisibilityGrant on edit -- toggling it true takes effect on the new version row (Story 2.6)", async () => {
    const existing = makeShare({ id: "row-1", partnerId: "partner-1", subPartnerVisibilityGrant: false });
    const partnerShares = createFakePartnerSharePort([existing]);
    const deps: PartnerShareDeps = { partnerShares };

    const updated = await updatePartnerShare(
      "partner-1",
      { name: "Partner A", sharePercent: "50", userId: null, subPartnerVisibilityGrant: true },
      deps,
    );

    expect(updated?.subPartnerVisibilityGrant).toBe(true);
    const oldRow = (await partnerShares.listByProjectId("project-1")).find((r) => r.id === "row-1");
    expect(oldRow?.subPartnerVisibilityGrant).toBe(false);
  });

  it("toggling subPartnerVisibilityGrant back to false takes effect on the next version row", async () => {
    const existing = makeShare({ id: "row-1", partnerId: "partner-1", subPartnerVisibilityGrant: true });
    const partnerShares = createFakePartnerSharePort([existing]);
    const deps: PartnerShareDeps = { partnerShares };

    const updated = await updatePartnerShare(
      "partner-1",
      { name: "Partner A", sharePercent: "50", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );

    expect(updated?.subPartnerVisibilityGrant).toBe(false);
  });

  it("always versions even when only the name changes", async () => {
    const existing = makeShare({ id: "row-1", partnerId: "partner-1", name: "Old Name" });
    const partnerShares = createFakePartnerSharePort([existing]);
    const deps: PartnerShareDeps = { partnerShares };

    const updated = await updatePartnerShare(
      "partner-1",
      { name: "New Name", sharePercent: "50", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );

    expect(updated?.id).not.toBe("row-1");
    expect(updated?.name).toBe("New Name");
    const allVersions = await partnerShares.listByProjectId("project-1");
    expect(allVersions).toHaveLength(2);
  });

  it("resolves to null for a nonexistent partnerId, so the caller can surface a 404", async () => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    const result = await updatePartnerShare(
      "unknown-partner",
      { name: "X", sharePercent: "50", userId: null, subPartnerVisibilityGrant: false },
      deps,
    );

    expect(result).toBeNull();
  });

  it("rejects an out-of-range share on edit -- no new version created", async () => {
    const existing = makeShare({ id: "row-1", partnerId: "partner-1" });
    const partnerShares = createFakePartnerSharePort([existing]);
    const deps: PartnerShareDeps = { partnerShares };

    await expect(
      updatePartnerShare("partner-1", { name: "Partner A", sharePercent: "150", userId: null, subPartnerVisibilityGrant: false }, deps),
    ).rejects.toThrow(InvalidSharePercentError);
    expect(await partnerShares.listByProjectId("project-1")).toHaveLength(1);
  });
});

describe("listCurrentPartnerShares", () => {
  it("reduces multiple version rows down to the latest per partnerId", async () => {
    const v1 = makeShare({
      id: "row-1",
      partnerId: "partner-1",
      sharePercent: "50" as Percent,
      effectiveFrom: new Date(1000).toISOString(),
    });
    const v2 = makeShare({
      id: "row-2",
      partnerId: "partner-1",
      sharePercent: "60" as Percent,
      effectiveFrom: new Date(2000).toISOString(),
    });
    const other = makeShare({
      id: "row-3",
      partnerId: "partner-2",
      name: "Partner B",
      sharePercent: "30" as Percent,
      effectiveFrom: new Date(1500).toISOString(),
    });
    const partnerShares = createFakePartnerSharePort([v1, v2, other]);
    const deps: PartnerShareDeps = { partnerShares };

    const current = await listCurrentPartnerShares("project-1", deps);

    expect(current).toHaveLength(2);
    const partnerOne = current.find((s) => s.partnerId === "partner-1");
    expect(partnerOne?.sharePercent).toBe("60");
    expect(partnerOne?.id).toBe("row-2");
  });

  it("returns an empty list for a project with zero partners", async () => {
    const partnerShares = createFakePartnerSharePort();
    const deps: PartnerShareDeps = { partnerShares };

    expect(await listCurrentPartnerShares("project-1", deps)).toEqual([]);
  });
});

describe("computeShareTotal", () => {
  it("sums three partners to 100", () => {
    const shares = [
      makeShare({ partnerId: "a", sharePercent: "50" as Percent }),
      makeShare({ partnerId: "b", sharePercent: "30" as Percent }),
      makeShare({ partnerId: "c", sharePercent: "20" as Percent }),
    ];
    expect(computeShareTotal(shares)).toBe("100");
  });

  it("returns 0 for no shares", () => {
    expect(computeShareTotal([])).toBe("0");
  });

  it("computes an over-100 total (110)", () => {
    const shares = [
      makeShare({ partnerId: "a", sharePercent: "60" as Percent }),
      makeShare({ partnerId: "b", sharePercent: "50" as Percent }),
    ];
    expect(computeShareTotal(shares)).toBe("110");
  });
});

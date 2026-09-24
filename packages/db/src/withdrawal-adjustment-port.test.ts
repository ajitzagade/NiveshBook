import path from "node:path";
import { config } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Money } from "@niveshbook/types";
import { getDb } from "./client";
import { createWithdrawalAdjustmentPort } from "./ports";
import { projects, withdrawalAdjustments } from "./schema";

// Mirrors `withdrawal-transaction-port.test.ts`'s own defensive
// `DATABASE_URL` loading -- CI already sets it as a job-level env var (a
// no-op here, since `dotenv` never overwrites an already-set variable),
// while local `vitest run` has no other mechanism to pick it up from the
// repo-root `.env`.
config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Live-Postgres coverage for `createWithdrawalAdjustmentPort.upsert` (Story
 * 4.3) -- mirrors `withdrawal-transaction-port.test.ts`'s established
 * pattern (rows seeded/inspected directly via Drizzle against the real
 * Postgres instance CI already provisions, `DATABASE_URL`), applied here to
 * the `onConflictDoUpdate` upsert path this story's own Verification calls
 * out for real DB coverage, not just a mocked-port route test: the
 * first-call insert, the second-call update-in-place against the real
 * UNIQUE `(partyType, shareId, projectId)` constraint (never a duplicate
 * row), and `listByProjectId`'s project scoping.
 */
describe("createWithdrawalAdjustmentPort.upsert (live Postgres)", () => {
  const seededProjectIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    // `withdrawal_adjustments` rows cascade-delete via `projects` (schema.ts),
    // so a project delete alone clears them.
    for (const id of seededProjectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, id));
    }
  });

  async function seedProject(): Promise<string> {
    const db = getDb();
    const projectId = uuidv7();
    await db.insert(projects).values({ id: projectId, name: `withdrawal-adj-test-${projectId}` });
    seededProjectIds.push(projectId);
    return projectId;
  }

  it("inserts a new row on the first upsert for a (partyType, shareId, projectId) key", async () => {
    const port = createWithdrawalAdjustmentPort();
    const projectId = await seedProject();
    const shareId = uuidv7();

    const result = await port.upsert({
      projectId,
      partyType: "partner",
      shareId,
      canTake: "150000" as Money,
      taken: "0" as Money,
      adjustmentType: "keep_for_later",
      adjustmentAmount: "150000" as Money,
    });

    expect(result.projectId).toBe(projectId);
    expect(result.partyType).toBe("partner");
    expect(result.shareId).toBe(shareId);
    expect(result.canTake).toBe("150000.00");
    expect(result.taken).toBe("0.00");
    expect(result.adjustmentType).toBe("keep_for_later");
    expect(result.adjustmentAmount).toBe("150000.00");

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalAdjustments)
      .where(eq(withdrawalAdjustments.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it("updates the same row in place on a second upsert for the identical key -- never a duplicate (onConflictDoUpdate against the UNIQUE constraint)", async () => {
    const port = createWithdrawalAdjustmentPort();
    const projectId = await seedProject();
    const shareId = uuidv7();

    const first = await port.upsert({
      projectId,
      partyType: "partner",
      shareId,
      canTake: "150000" as Money,
      taken: "0" as Money,
      adjustmentType: "keep_for_later",
      adjustmentAmount: "150000" as Money,
    });

    const second = await port.upsert({
      projectId,
      partyType: "partner",
      shareId,
      canTake: "150000" as Money,
      taken: "300000" as Money,
      adjustmentType: "extra_taken",
      adjustmentAmount: "150000" as Money,
    });

    expect(second.id).toBe(first.id);
    expect(second.taken).toBe("300000.00");
    expect(second.adjustmentType).toBe("extra_taken");

    const db = getDb();
    const rows = await db
      .select()
      .from(withdrawalAdjustments)
      .where(eq(withdrawalAdjustments.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.adjustmentType).toBe("extra_taken");
  });

  it("keeps a Partner and a Sub-partner with the same shareId as distinct rows (partyType is part of the conflict target)", async () => {
    const port = createWithdrawalAdjustmentPort();
    const projectId = await seedProject();
    const sharedId = uuidv7();

    await port.upsert({
      projectId,
      partyType: "partner",
      shareId: sharedId,
      canTake: "100000" as Money,
      taken: "0" as Money,
      adjustmentType: "keep_for_later",
      adjustmentAmount: "100000" as Money,
    });
    await port.upsert({
      projectId,
      partyType: "sub_partner",
      shareId: sharedId,
      canTake: "50000" as Money,
      taken: "0" as Money,
      adjustmentType: "keep_for_later",
      adjustmentAmount: "50000" as Money,
    });

    const listed = await port.listByProjectId(projectId);
    expect(listed).toHaveLength(2);
  });

  it("scopes listByProjectId strictly to the given project", async () => {
    const port = createWithdrawalAdjustmentPort();
    const projectA = await seedProject();
    const projectB = await seedProject();

    await port.upsert({
      projectId: projectA,
      partyType: "partner",
      shareId: uuidv7(),
      canTake: "100000" as Money,
      taken: "0" as Money,
      adjustmentType: "keep_for_later",
      adjustmentAmount: "100000" as Money,
    });
    await port.upsert({
      projectId: projectB,
      partyType: "partner",
      shareId: uuidv7(),
      canTake: "200000" as Money,
      taken: "0" as Money,
      adjustmentType: "keep_for_later",
      adjustmentAmount: "200000" as Money,
    });

    const listed = await port.listByProjectId(projectA);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.projectId).toBe(projectA);
  });

  it("returns an empty array for a project with no adjustments yet", async () => {
    const port = createWithdrawalAdjustmentPort();
    const projectId = await seedProject();

    const listed = await port.listByProjectId(projectId);

    expect(listed).toEqual([]);
  });
});

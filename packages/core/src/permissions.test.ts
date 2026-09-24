import { describe, it, expect } from "vitest";
import type { PartnerShare, Percent, User } from "@niveshbook/types";
import {
  getPermissionsOverview,
  setApprovalAuthority,
  InvalidApprovalAuthorityTargetError,
  type PermissionsDeps,
  type PermissionsOverviewDeps,
} from "./permissions";
import type { UserPort } from "./user-port";
import type { PartnerSharePort, CreatePartnerShareInput } from "./partner-share-port";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "user@niveshbook.test",
    passwordHash: "irrelevant",
    role: "partner",
    active: true,
    canApproveExtraWithdrawal: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A UserPort backed by a mutable in-memory map, so a test can mutate a
 * user's role/active/grant mid-test to prove this view never caches. */
function createFakeUserPort(users: User[]): UserPort {
  const store = new Map(users.map((u) => [u.id, u]));
  return {
    async findUserByEmail(email) {
      return [...store.values()].find((u) => u.email === email) ?? null;
    },
    async findUserById(id) {
      return store.get(id) ?? null;
    },
    async listAllUsers() {
      return [...store.values()];
    },
    async setUserActive(id, active) {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, active };
      store.set(id, updated);
      return updated;
    },
    async setApprovalAuthority(id, granted) {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, canApproveExtraWithdrawal: granted };
      store.set(id, updated);
      return updated;
    },
  } as UserPort & {
    setRoleForTest: (id: string, role: User["role"]) => void;
    setActiveForTest: (id: string, active: boolean) => void;
  };
}

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
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

/** A PartnerSharePort backed by a fixed, read-only list of version rows -- sufficient for `getPermissionsOverview`'s read-only `listAll()` call. */
function createFakePartnerSharePort(rows: PartnerShare[] = []): PartnerSharePort {
  return {
    async createPartnerShare(input: CreatePartnerShareInput) {
      throw new Error(`not implemented in this fake: ${input.partnerId}`);
    },
    async findLatestByPartnerId() {
      throw new Error("not implemented in this fake");
    },
    async listByProjectId(projectId: string) {
      return rows.filter((r) => r.projectId === projectId);
    },
    async listAll() {
      return [...rows];
    },
  };
}

describe("getPermissionsOverview", () => {
  it("reports enabledRoles.project_admin: true from projectAdminEnabled, even with no project_admin user at all", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: PermissionsOverviewDeps = { users, projectAdminEnabled: true, partnerShares: createFakePartnerSharePort() };

    const overview = await getPermissionsOverview(deps);

    expect(overview.enabledRoles.project_admin).toBe(true);
  });

  it("reports enabledRoles.project_admin: false from projectAdminEnabled, even with an active project_admin user", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
      makeUser({ id: "pa-1", role: "project_admin", active: true }),
    ]);
    const deps: PermissionsOverviewDeps = { users, projectAdminEnabled: false, partnerShares: createFakePartnerSharePort() };

    const overview = await getPermissionsOverview(deps);

    expect(overview.enabledRoles.project_admin).toBe(false);
  });

  it("does not re-derive enabledRoles.project_admin from user rows — deactivating/reactivating project_admin users never changes it", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
      makeUser({ id: "pa-1", role: "project_admin", active: true }),
    ]);
    const deps: PermissionsOverviewDeps = { users, projectAdminEnabled: false, partnerShares: createFakePartnerSharePort() };

    const before = await getPermissionsOverview(deps);
    expect(before.enabledRoles.project_admin).toBe(false);

    await users.setUserActive("pa-1", false);

    const after = await getPermissionsOverview(deps);
    expect(after.enabledRoles.project_admin).toBe(false);
  });

  it("lists every owner_admin as an approver, with id/email/canApproveExtraWithdrawal only", async () => {
    const users = createFakeUserPort([
      makeUser({
        id: "owner-1",
        email: "owner1@niveshbook.test",
        role: "owner_admin",
        canApproveExtraWithdrawal: true,
      }),
      makeUser({
        id: "owner-2",
        email: "owner2@niveshbook.test",
        role: "owner_admin",
        canApproveExtraWithdrawal: false,
      }),
      makeUser({ id: "partner-1", role: "partner" }),
    ]);
    const deps: PermissionsOverviewDeps = { users, projectAdminEnabled: false, partnerShares: createFakePartnerSharePort() };

    const overview = await getPermissionsOverview(deps);

    expect(overview.approvers).toEqual([
      { id: "owner-1", email: "owner1@niveshbook.test", canApproveExtraWithdrawal: true },
      { id: "owner-2", email: "owner2@niveshbook.test", canApproveExtraWithdrawal: false },
    ]);
  });

  it("excludes a deactivated owner_admin from approvers, even with a stale canApproveExtraWithdrawal grant", async () => {
    const users = createFakeUserPort([
      makeUser({
        id: "owner-1",
        email: "owner1@niveshbook.test",
        role: "owner_admin",
        active: false,
        canApproveExtraWithdrawal: true,
      }),
      makeUser({
        id: "owner-2",
        email: "owner2@niveshbook.test",
        role: "owner_admin",
        active: true,
        canApproveExtraWithdrawal: false,
      }),
    ]);
    const deps: PermissionsOverviewDeps = { users, projectAdminEnabled: false, partnerShares: createFakePartnerSharePort() };

    const overview = await getPermissionsOverview(deps);

    expect(overview.approvers).toEqual([
      { id: "owner-2", email: "owner2@niveshbook.test", canApproveExtraWithdrawal: false },
    ]);
  });

  it("re-reads live approver grants — a toggle is reflected on the very next call", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin", canApproveExtraWithdrawal: true }),
    ]);
    const deps: PermissionsOverviewDeps = { users, projectAdminEnabled: false, partnerShares: createFakePartnerSharePort() };

    const before = await getPermissionsOverview(deps);
    expect(before.approvers[0]?.canApproveExtraWithdrawal).toBe(true);

    await users.setApprovalAuthority("owner-1", false);

    const after = await getPermissionsOverview(deps);
    expect(after.approvers[0]?.canApproveExtraWithdrawal).toBe(false);
  });

  it("lists every current Partner across every Project with the minimal projection (Story 2.7)", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const partnerShares = createFakePartnerSharePort([
      makePartnerShare({
        id: "row-1",
        partnerId: "partner-1",
        projectId: "project-1",
        name: "Partner A",
        sharePercent: "50" as Percent,
        userId: "user-1",
        subPartnerVisibilityGrant: true,
      }),
      makePartnerShare({
        id: "row-2",
        partnerId: "partner-2",
        projectId: "project-1",
        name: "Partner B",
        sharePercent: "50" as Percent,
        subPartnerVisibilityGrant: false,
      }),
      makePartnerShare({
        id: "row-3",
        partnerId: "partner-3",
        projectId: "project-2",
        name: "Partner C",
        sharePercent: "100" as Percent,
        subPartnerVisibilityGrant: false,
      }),
    ]);
    const deps: PermissionsOverviewDeps = { users, projectAdminEnabled: false, partnerShares };

    const overview = await getPermissionsOverview(deps);

    expect(overview.partners).toEqual(
      expect.arrayContaining([
        { partnerId: "partner-1", projectId: "project-1", name: "Partner A", subPartnerVisibilityGrant: true },
        { partnerId: "partner-2", projectId: "project-1", name: "Partner B", subPartnerVisibilityGrant: false },
        { partnerId: "partner-3", projectId: "project-2", name: "Partner C", subPartnerVisibilityGrant: false },
      ]),
    );
    expect(overview.partners).toHaveLength(3);
    // Minimal projection -- never sharePercent/userId/id/effectiveFrom/createdAt.
    expect(Object.keys(overview.partners[0] ?? {}).sort()).toEqual(
      ["name", "partnerId", "projectId", "subPartnerVisibilityGrant"].sort(),
    );
  });

  it("returns partners: [] when no Partners exist anywhere yet", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: PermissionsOverviewDeps = {
      users,
      projectAdminEnabled: false,
      partnerShares: createFakePartnerSharePort([]),
    };

    const overview = await getPermissionsOverview(deps);

    expect(overview.partners).toEqual([]);
  });

  it("reflects only the latest version's grant state when a Partner was edited after their grant was toggled", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const partnerShares = createFakePartnerSharePort([
      makePartnerShare({
        id: "row-1",
        partnerId: "partner-1",
        subPartnerVisibilityGrant: false,
        effectiveFrom: new Date(1000).toISOString(),
      }),
      makePartnerShare({
        id: "row-2",
        partnerId: "partner-1",
        subPartnerVisibilityGrant: true,
        effectiveFrom: new Date(2000).toISOString(),
      }),
    ]);
    const deps: PermissionsOverviewDeps = { users, projectAdminEnabled: false, partnerShares };

    const overview = await getPermissionsOverview(deps);

    expect(overview.partners).toHaveLength(1);
    expect(overview.partners[0]?.subPartnerVisibilityGrant).toBe(true);
  });
});

describe("setApprovalAuthority", () => {
  it("grants approval authority to an owner_admin", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin", canApproveExtraWithdrawal: false }),
    ]);
    const deps: PermissionsDeps = { users };

    const updated = await setApprovalAuthority("owner-1", true, deps);

    expect(updated?.canApproveExtraWithdrawal).toBe(true);
  });

  it("revokes approval authority from an owner_admin", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin", canApproveExtraWithdrawal: true }),
    ]);
    const deps: PermissionsDeps = { users };

    const updated = await setApprovalAuthority("owner-1", false, deps);

    expect(updated?.canApproveExtraWithdrawal).toBe(false);
  });

  it("returns null for an unknown target id", async () => {
    const users = createFakeUserPort([]);
    const deps: PermissionsDeps = { users };

    const updated = await setApprovalAuthority("ghost", true, deps);

    expect(updated).toBeNull();
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "rejects (throws) when the target is a %s, and makes no change",
    async (role) => {
      const users = createFakeUserPort([
        makeUser({ id: "target-1", role, canApproveExtraWithdrawal: false }),
      ]);
      const deps: PermissionsDeps = { users };

      await expect(setApprovalAuthority("target-1", true, deps)).rejects.toBeInstanceOf(
        InvalidApprovalAuthorityTargetError,
      );

      const target = await users.findUserById("target-1");
      expect(target?.canApproveExtraWithdrawal).toBe(false);
    },
  );
});

import { describe, it, expect } from "vitest";
import type { User } from "@niveshbook/types";
import {
  getPermissionsOverview,
  setApprovalAuthority,
  InvalidApprovalAuthorityTargetError,
  type PermissionsDeps,
} from "./permissions";
import type { UserPort } from "./user-port";

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

describe("getPermissionsOverview", () => {
  it("reports enabledRoles.project_admin: true when at least one active project_admin exists", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
      makeUser({ id: "pa-1", role: "project_admin", active: true }),
    ]);
    const deps: PermissionsDeps = { users };

    const overview = await getPermissionsOverview(deps);

    expect(overview.enabledRoles.project_admin).toBe(true);
  });

  it("reports enabledRoles.project_admin: false when no project_admin user exists", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: PermissionsDeps = { users };

    const overview = await getPermissionsOverview(deps);

    expect(overview.enabledRoles.project_admin).toBe(false);
  });

  it("reports enabledRoles.project_admin: false when the only project_admin is inactive", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
      makeUser({ id: "pa-1", role: "project_admin", active: false }),
    ]);
    const deps: PermissionsDeps = { users };

    const overview = await getPermissionsOverview(deps);

    expect(overview.enabledRoles.project_admin).toBe(false);
  });

  it("re-reads live usage — deactivating the last project_admin flips the result on the very next call", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
      makeUser({ id: "pa-1", role: "project_admin", active: true }),
    ]);
    const deps: PermissionsDeps = { users };

    const before = await getPermissionsOverview(deps);
    expect(before.enabledRoles.project_admin).toBe(true);

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
    const deps: PermissionsDeps = { users };

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
    const deps: PermissionsDeps = { users };

    const overview = await getPermissionsOverview(deps);

    expect(overview.approvers).toEqual([
      { id: "owner-2", email: "owner2@niveshbook.test", canApproveExtraWithdrawal: false },
    ]);
  });

  it("re-reads live approver grants — a toggle is reflected on the very next call", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin", canApproveExtraWithdrawal: true }),
    ]);
    const deps: PermissionsDeps = { users };

    const before = await getPermissionsOverview(deps);
    expect(before.approvers[0]?.canApproveExtraWithdrawal).toBe(true);

    await users.setApprovalAuthority("owner-1", false);

    const after = await getPermissionsOverview(deps);
    expect(after.approvers[0]?.canApproveExtraWithdrawal).toBe(false);
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

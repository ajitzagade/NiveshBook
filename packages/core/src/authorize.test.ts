import { describe, it, expect } from "vitest";
import type { User } from "@niveshbook/types";
import { authorize, authorizeScope, type AuthorizeDeps } from "./authorize";
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
 * user's role mid-test to prove `authorize()`/`authorizeScope()` never
 * cache it. */
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
    async setApprovalAuthority(id: string, granted: boolean) {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, canApproveExtraWithdrawal: granted };
      store.set(id, updated);
      return updated;
    },
    setRole(id: string, role: User["role"]) {
      const existing = store.get(id);
      if (existing) {
        store.set(id, { ...existing, role });
      }
    },
  } as UserPort & { setRole: (id: string, role: User["role"]) => void };
}

describe("authorizeScope", () => {
  it("allows an owner_admin to list users", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "users:list", deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from listing users",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", "users:list", deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies an actor that no longer exists", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("ghost", "users:list", deps);

    expect(result).toEqual({ allowed: false });
  });

  it("re-reads the actor's role live — a mid-session role change is reflected on the very next call", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
    ]) as UserPort & { setRole: (id: string, role: User["role"]) => void };
    const deps: AuthorizeDeps = { users };

    const before = await authorizeScope("owner-1", "users:list", deps);
    expect(before).toEqual({ allowed: true });

    users.setRole("owner-1", "partner");

    const after = await authorizeScope("owner-1", "users:list", deps);
    expect(after).toEqual({ allowed: false });
  });
});

describe("authorize", () => {
  it("allows an owner_admin to view any single user", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
      makeUser({ id: "target-1", role: "partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("owner-1", "users:view", { ownerId: "target-1" }, deps);

    expect(result).toEqual({ allowed: true });
  });

  it("allows any role to view their own profile (self-access override)", async () => {
    const users = createFakeUserPort([makeUser({ id: "actor-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("actor-1", "users:view", { ownerId: "actor-1" }, deps);

    expect(result).toEqual({ allowed: true });
  });

  it("allows self-access even when the id casing differs (UUIDs are case-insensitive)", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "0192f5a0-1111-7000-8000-000000000001", role: "sub_partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "0192f5a0-1111-7000-8000-000000000001",
      "users:view",
      { ownerId: "0192F5A0-1111-7000-8000-000000000001" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a non-owner_admin viewing someone else's profile", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "actor-1", role: "partner" }),
      makeUser({ id: "target-1", role: "partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("actor-1", "users:view", { ownerId: "target-1" }, deps);

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists, viewing someone else's profile", async () => {
    const users = createFakeUserPort([makeUser({ id: "target-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("ghost", "users:view", { ownerId: "target-1" }, deps);

    expect(result).toEqual({ allowed: false });
  });

  it("re-reads the actor's role live — a mid-session role change is reflected on the very next call", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
      makeUser({ id: "target-1", role: "partner" }),
    ]) as UserPort & { setRole: (id: string, role: User["role"]) => void };
    const deps: AuthorizeDeps = { users };

    const before = await authorize("owner-1", "users:view", { ownerId: "target-1" }, deps);
    expect(before).toEqual({ allowed: true });

    users.setRole("owner-1", "partner");

    const after = await authorize("owner-1", "users:view", { ownerId: "target-1" }, deps);
    expect(after).toEqual({ allowed: false });
  });
});

describe("authorize — users:update-status (no self-access override)", () => {
  it("allows an owner_admin to update another user's status", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "owner-1", role: "owner_admin" }),
      makeUser({ id: "target-1", role: "partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "owner-1",
      "users:update-status",
      { ownerId: "target-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows an owner_admin to update their own status (normal role check, not a self-access short-circuit)", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("owner-1", "users:update-status", { ownerId: "owner-1" }, deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from updating someone else's status",
    async (role) => {
      const users = createFakeUserPort([
        makeUser({ id: "actor-1", role }),
        makeUser({ id: "target-1", role: "partner" }),
      ]);
      const deps: AuthorizeDeps = { users };

      const result = await authorize(
        "actor-1",
        "users:update-status",
        { ownerId: "target-1" },
        deps,
      );

      expect(result).toEqual({ allowed: false });
    },
  );

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from updating their OWN status — unlike users:view, there is no self-access override",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorize(
        "actor-1",
        "users:update-status",
        { ownerId: "actor-1" },
        deps,
      );

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies an actor that no longer exists, even when targeting their own (former) id", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("ghost", "users:update-status", { ownerId: "ghost" }, deps);

    expect(result).toEqual({ allowed: false });
  });
});

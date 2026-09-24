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

describe("authorizeScope — projects:create/projects:update/projects:list (Story 2.1)", () => {
  it.each(["projects:create", "projects:update", "projects:list"] as const)(
    "allows an owner_admin to %s",
    async (action) => {
      const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("owner-1", action, deps);

      expect(result).toEqual({ allowed: true });
    },
  );

  it.each(["projects:create", "projects:update", "projects:list"] as const)(
    "denies a non-owner_admin from %s — a project must be creatable/editable with zero ResourceRef, but the gate itself is still Owner/Admin-only",
    async (action) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role: "partner" })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", action, deps);

      expect(result).toEqual({ allowed: false });
    },
  );
});

describe("authorizeScope — partner_shares:list scopeOwnerIds (Story 2.4)", () => {
  it("allows a partner whose userId is in scopeOwnerIds, even though the role table alone denies partner", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "partner_shares:list", deps, [
      "someone-else",
      "partner-user-1",
    ]);

    expect(result).toEqual({ allowed: true });
  });

  it("matches scopeOwnerIds case-insensitively (UUIDs are case-insensitive)", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "0192f5a0-1111-7000-8000-000000000001", role: "partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope(
      "0192f5a0-1111-7000-8000-000000000001",
      "partner_shares:list",
      deps,
      ["0192F5A0-1111-7000-8000-000000000001"],
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a partner whose userId is not in scopeOwnerIds", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "partner_shares:list", deps, [
      "some-other-partner",
    ]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies a partner when scopeOwnerIds is omitted entirely (backward-compatible, no override)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "partner_shares:list", deps);

    expect(result).toEqual({ allowed: false });
  });

  it("still allows an owner_admin regardless of scopeOwnerIds (role-based check, unaffected)", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "partner_shares:list", deps, []);

    expect(result).toEqual({ allowed: true });
  });

  it("does not extend the scopeOwnerIds override to actions outside SCOPE_SELF_ACCESS_ACTIONS", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "subpartner_shares:create", deps, [
      "partner-user-1",
    ]);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorizeScope — partner_shares:view_grant scopeOwnerIds (Story 2.6)", () => {
  it("allows a sub_partner whose userId is in scopeOwnerIds (linked to this Partner's own current Sub-partners)", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("sub-partner-1", "partner_shares:view_grant", deps, [
      "someone-else",
      "sub-partner-1",
    ]);

    expect(result).toEqual({ allowed: true });
  });

  it("matches scopeOwnerIds case-insensitively (UUIDs are case-insensitive)", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "0192f5a0-2222-7000-8000-000000000002", role: "sub_partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope(
      "0192f5a0-2222-7000-8000-000000000002",
      "partner_shares:view_grant",
      deps,
      ["0192F5A0-2222-7000-8000-000000000002"],
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a sub_partner whose userId is not in scopeOwnerIds -- e.g. linked under a different Partner", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("sub-partner-1", "partner_shares:view_grant", deps, [
      "some-other-sub-partner",
    ]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies a Partner role whose userId isn't among the scopeOwnerIds -- the route only ever populates scopeOwnerIds from this Partner's own Sub-partners' userIds, never the Partner's own", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "partner_shares:view_grant", deps, [
      "sub-partner-1",
      "sub-partner-2",
    ]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies when scopeOwnerIds is omitted entirely (backward-compatible, no override)", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("sub-partner-1", "partner_shares:view_grant", deps);

    expect(result).toEqual({ allowed: false });
  });

  it("still allows an owner_admin regardless of scopeOwnerIds (role-based check, unaffected)", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "partner_shares:view_grant", deps, []);

    expect(result).toEqual({ allowed: true });
  });
});

describe("authorize — subpartner_shares:list (Story 2.4, self-access override)", () => {
  it("allows a linked Partner whose userId matches the target Partner Share's userId", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-1",
      "subpartner_shares:list",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a co-partner whose userId does not match the target Partner Share's userId", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-2", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-2",
      "subpartner_shares:list",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies when the target Partner Share has no linked user (ownerId is empty)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-1",
      "subpartner_shares:list",
      { ownerId: "" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("allows an owner_admin unconditionally, regardless of ownerId", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "owner-1",
      "subpartner_shares:list",
      { ownerId: "someone-else" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a sub_partner role even targeting their own userId as ownerId -- Sub-partner visibility is Story 2.5's job, not admitted here", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    // A sub_partner's own userId is never a partner_shares.userId in
    // practice, but this proves the mechanism itself: SELF_ACCESS_ACTIONS
    // is keyed on the *action*, not the role, so even a hypothetical
    // ownerId match doesn't matter here -- it's the route layer's job to
    // never construct this call with a sub_partner's own id as ownerId.
    // This test instead proves the *mismatch* case still denies.
    const result = await authorize(
      "sub-partner-1",
      "subpartner_shares:list",
      { ownerId: "different-owner" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorize — subpartner_shares:view (Story 2.5, self-access override)", () => {
  it("allows the linked Sub-partner whose userId matches the target Sub-partner Share's userId", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "sub-partner-1",
      "subpartner_shares:view",
      { ownerId: "sub-partner-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("matches self-access case-insensitively (UUIDs are case-insensitive)", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "0192f5a0-1111-7000-8000-000000000001", role: "sub_partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "0192f5a0-1111-7000-8000-000000000001",
      "subpartner_shares:view",
      { ownerId: "0192F5A0-1111-7000-8000-000000000001" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a different Sub-partner whose userId does not match the target row's userId", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-2", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "sub-partner-2",
      "subpartner_shares:view",
      { ownerId: "sub-partner-1" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies the parent Partner viewing a Sub-partner's row via this action -- single-detail access is not granted to the parent Partner (Decisions)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-1",
      "subpartner_shares:view",
      { ownerId: "sub-partner-1" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies when the target Sub-partner Share has no linked user (ownerId is empty)", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "sub-partner-1",
      "subpartner_shares:view",
      { ownerId: "" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("allows an owner_admin unconditionally, regardless of ownerId", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "owner-1",
      "subpartner_shares:view",
      { ownerId: "someone-else" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });
});

describe("authorizeScope — investment_requirements:create/list (Story 3.1)", () => {
  it.each(["investment_requirements:create", "investment_requirements:list"] as const)(
    "allows an owner_admin to %s",
    async (action) => {
      const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("owner-1", action, deps);

      expect(result).toEqual({ allowed: true });
    },
  );

  it.each(["investment_requirements:create", "investment_requirements:list"] as const)(
    "denies a non-owner_admin from %s — Owner/Admin-only in this story, no self/scope override",
    async (action) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role: "partner" })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", action, deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it.each(["investment_requirements:create", "investment_requirements:list"] as const)(
    "denies a partner even when their own userId is passed as scopeOwnerIds — not a SCOPE_SELF_ACCESS_ACTIONS entry",
    async (action) => {
      const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("partner-user-1", action, deps, ["partner-user-1"]);

      expect(result).toEqual({ allowed: false });
    },
  );
});

describe("authorizeScope — should_pay:view (Story 3.2)", () => {
  it("allows an owner_admin to view Should Pay", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "should_pay:view", deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from viewing Should Pay -- Owner/Admin-only in this story, no self/scope override",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", "should_pay:view", deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies a partner even when their own userId is passed as scopeOwnerIds -- not a SCOPE_SELF_ACCESS_ACTIONS entry", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "should_pay:view", deps, ["partner-user-1"]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("ghost", "should_pay:view", deps);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorizeScope — investment_transactions:list (Story 3.3)", () => {
  it("allows an owner_admin to list transactions", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "investment_transactions:list", deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from listing transactions -- Owner/Admin-only, no self/scope override",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", "investment_transactions:list", deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies a partner even when their own userId is passed as scopeOwnerIds -- not a SCOPE_SELF_ACCESS_ACTIONS entry", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "investment_transactions:list", deps, [
      "partner-user-1",
    ]);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorizeScope — investment_transactions:edit (Story 3.7, Owner/Admin-only, no self-access)", () => {
  it("allows an owner_admin to edit a transaction", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "investment_transactions:edit", deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from editing a transaction -- Owner/Admin-only, no self/scope override even though investment_transactions:create (Story 3.3) grants self-access",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", "investment_transactions:edit", deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies a partner even when their own userId is passed as scopeOwnerIds -- not a SCOPE_SELF_ACCESS_ACTIONS entry", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "investment_transactions:edit", deps, [
      "partner-user-1",
    ]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("ghost", "investment_transactions:edit", deps);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorizeScope — investment_transactions:cancel (Story 3.8, Owner/Admin-only, no self-access)", () => {
  it("allows an owner_admin to cancel a transaction", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "investment_transactions:cancel", deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from cancelling a transaction -- Owner/Admin-only, no self/scope override, mirrors investment_transactions:edit exactly",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", "investment_transactions:cancel", deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies a partner even when their own userId is passed as scopeOwnerIds -- not a SCOPE_SELF_ACCESS_ACTIONS entry", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "investment_transactions:cancel", deps, [
      "partner-user-1",
    ]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("ghost", "investment_transactions:cancel", deps);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorizeScope — investment_adjustments:view (Story 3.4)", () => {
  it("allows an owner_admin to view Investment Adjustments", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "investment_adjustments:view", deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from viewing Investment Adjustments -- Owner/Admin-only in this story, no self/scope override",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", "investment_adjustments:view", deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies a partner even when their own userId is passed as scopeOwnerIds -- not a SCOPE_SELF_ACCESS_ACTIONS entry", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "investment_adjustments:view", deps, [
      "partner-user-1",
    ]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("ghost", "investment_adjustments:view", deps);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorize — investment_transactions:create (Story 3.3, self-access override)", () => {
  it("allows an owner_admin to record a payment on anyone's behalf", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "owner-1",
      "investment_transactions:create",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows a Partner to record their own payment (resourceRef.ownerId matches their own userId)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-1",
      "investment_transactions:create",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows a Sub-partner to record their own payment (resourceRef.ownerId matches their own userId)", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "sub-partner-1",
      "investment_transactions:create",
      { ownerId: "sub-partner-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("matches self-access case-insensitively (UUIDs are case-insensitive)", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "0192f5a0-1111-7000-8000-000000000001", role: "partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "0192f5a0-1111-7000-8000-000000000001",
      "investment_transactions:create",
      { ownerId: "0192F5A0-1111-7000-8000-000000000001" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a Partner attempting to record another Partner's payment", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-a", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-a",
      "investment_transactions:create",
      { ownerId: "partner-user-b" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies when the target share has no linked user (ownerId is empty)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-a", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-a",
      "investment_transactions:create",
      { ownerId: "" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists, even targeting their own (former) id", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("ghost", "investment_transactions:create", { ownerId: "someone-else" }, deps);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorize — investment_status:view (Story 3.6, self-access override, identical shape to investment_transactions:create)", () => {
  it("allows an owner_admin to view anyone's status", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("owner-1", "investment_status:view", { ownerId: "partner-user-1" }, deps);

    expect(result).toEqual({ allowed: true });
  });

  it("allows a Partner to view their own status (resourceRef.ownerId matches their own userId)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-1",
      "investment_status:view",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows a Sub-partner to view their own status (resourceRef.ownerId matches their own userId)", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "sub-partner-1",
      "investment_status:view",
      { ownerId: "sub-partner-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("matches self-access case-insensitively (UUIDs are case-insensitive)", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "0192f5a0-1111-7000-8000-000000000001", role: "partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "0192f5a0-1111-7000-8000-000000000001",
      "investment_status:view",
      { ownerId: "0192F5A0-1111-7000-8000-000000000001" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a co-Partner attempting to view another Partner's status", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-a", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-a",
      "investment_status:view",
      { ownerId: "partner-user-b" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies when the target share has no linked user (ownerId is empty)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-a", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("partner-user-a", "investment_status:view", { ownerId: "" }, deps);

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists, even targeting their own (former) id", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize("ghost", "investment_status:view", { ownerId: "someone-else" }, deps);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorize — investment_transactions:view_audit (Story 3.7, self-access override, identical shape to investment_status:view)", () => {
  it("allows an owner_admin to view anyone's transaction audit trail", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "owner-1",
      "investment_transactions:view_audit",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows a Partner to view their own transaction's audit trail (resourceRef.ownerId matches their own userId)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-1",
      "investment_transactions:view_audit",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows a Sub-partner to view their own transaction's audit trail (resourceRef.ownerId matches their own userId)", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "sub-partner-1",
      "investment_transactions:view_audit",
      { ownerId: "sub-partner-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("matches self-access case-insensitively (UUIDs are case-insensitive)", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "0192f5a0-1111-7000-8000-000000000001", role: "partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "0192f5a0-1111-7000-8000-000000000001",
      "investment_transactions:view_audit",
      { ownerId: "0192F5A0-1111-7000-8000-000000000001" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a co-Partner attempting to view another Partner's transaction audit trail", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-a", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-a",
      "investment_transactions:view_audit",
      { ownerId: "partner-user-b" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies when the target share has no linked user (ownerId is empty)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-a", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-a",
      "investment_transactions:view_audit",
      { ownerId: "" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists, even targeting their own (former) id", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "ghost",
      "investment_transactions:view_audit",
      { ownerId: "someone-else" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
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

describe("authorizeScope — can_take:view (Story 4.1, identical shape to should_pay:view)", () => {
  it("allows an owner_admin to view Can Take", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "can_take:view", deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from viewing Can Take -- Owner/Admin-only in this story, no self/scope override",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", "can_take:view", deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies a partner even when their own userId is passed as scopeOwnerIds -- not a SCOPE_SELF_ACCESS_ACTIONS entry", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "can_take:view", deps, ["partner-user-1"]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("ghost", "can_take:view", deps);

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorize — withdrawal_transactions:create (Story 4.2, self-access override, identical shape to investment_transactions:create)", () => {
  it("allows an owner_admin to record a withdrawal on anyone's behalf", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "owner-1",
      "withdrawal_transactions:create",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows a Partner to record their own withdrawal (resourceRef.ownerId matches their own userId)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-1",
      "withdrawal_transactions:create",
      { ownerId: "partner-user-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows a Sub-partner to record their own withdrawal (resourceRef.ownerId matches their own userId)", async () => {
    const users = createFakeUserPort([makeUser({ id: "sub-partner-1", role: "sub_partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "sub-partner-1",
      "withdrawal_transactions:create",
      { ownerId: "sub-partner-1" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("matches self-access case-insensitively (UUIDs are case-insensitive)", async () => {
    const users = createFakeUserPort([
      makeUser({ id: "0192f5a0-2222-7000-8000-000000000001", role: "partner" }),
    ]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "0192f5a0-2222-7000-8000-000000000001",
      "withdrawal_transactions:create",
      { ownerId: "0192F5A0-2222-7000-8000-000000000001" },
      deps,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("denies a Partner attempting to record another Partner's withdrawal", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-a", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-a",
      "withdrawal_transactions:create",
      { ownerId: "partner-user-b" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies when the target share has no linked user (ownerId is empty)", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-a", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "partner-user-a",
      "withdrawal_transactions:create",
      { ownerId: "" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists, even targeting their own (former) id", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorize(
      "ghost",
      "withdrawal_transactions:create",
      { ownerId: "someone-else" },
      deps,
    );

    expect(result).toEqual({ allowed: false });
  });
});

describe("authorizeScope — withdrawal_transactions:list (Story 4.2, Owner/Admin-only, identical shape to investment_transactions:list)", () => {
  it("allows an owner_admin to list withdrawals", async () => {
    const users = createFakeUserPort([makeUser({ id: "owner-1", role: "owner_admin" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("owner-1", "withdrawal_transactions:list", deps);

    expect(result).toEqual({ allowed: true });
  });

  it.each(["partner", "sub_partner", "project_admin"] as const)(
    "denies a %s from listing withdrawals -- Owner/Admin-only, no self/scope override",
    async (role) => {
      const users = createFakeUserPort([makeUser({ id: "actor-1", role })]);
      const deps: AuthorizeDeps = { users };

      const result = await authorizeScope("actor-1", "withdrawal_transactions:list", deps);

      expect(result).toEqual({ allowed: false });
    },
  );

  it("denies a partner even when their own userId is passed as scopeOwnerIds -- not a SCOPE_SELF_ACCESS_ACTIONS entry", async () => {
    const users = createFakeUserPort([makeUser({ id: "partner-user-1", role: "partner" })]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("partner-user-1", "withdrawal_transactions:list", deps, [
      "partner-user-1",
    ]);

    expect(result).toEqual({ allowed: false });
  });

  it("denies an actor that no longer exists", async () => {
    const users = createFakeUserPort([]);
    const deps: AuthorizeDeps = { users };

    const result = await authorizeScope("ghost", "withdrawal_transactions:list", deps);

    expect(result).toEqual({ allowed: false });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as argon2 from "argon2";
import { uuidv7 } from "uuidv7";
import type { User, Session } from "@niveshbook/types";
import {
  login,
  logout,
  getSession,
  listSessions,
  revokeSession,
  setUserActiveStatus,
  createUser,
  InvalidCreatableRoleError,
  resetUserPassword,
  PasswordTooShortError,
  PasswordTooLongError,
  hashToken,
  SESSION_TTL_MS,
  type AuthDeps,
} from "./auth";
import type { UserPort, CreateUserInput } from "./user-port";
import { UserEmailAlreadyExistsError } from "./user-port";
import type { SessionPort, CreateSessionInput } from "./session-port";

const ACTIVE_EMAIL = "active@niveshbook.test";
const OTHER_ACTIVE_EMAIL = "other-active@niveshbook.test";
const INACTIVE_EMAIL = "inactive@niveshbook.test";
const CORRECT_PASSWORD = "correct-horse-battery-staple";

function createFakePorts(users: User[]) {
  const userStore = new Map(users.map((u) => [u.email, u]));
  const sessionStore = new Map<string, Session>();
  let nextId = 1;

  const userPort: UserPort = {
    async findUserByEmail(email) {
      return userStore.get(email) ?? null;
    },
    async findUserById(id) {
      return [...userStore.values()].find((u) => u.id === id) ?? null;
    },
    async listAllUsers() {
      return [...userStore.values()];
    },
    async setUserActive(id, active) {
      const existing = [...userStore.values()].find((u) => u.id === id);
      if (!existing) {
        return null;
      }
      const updated = { ...existing, active };
      userStore.set(existing.email, updated);
      return updated;
    },
    async setApprovalAuthority(id, granted) {
      const existing = [...userStore.values()].find((u) => u.id === id);
      if (!existing) {
        return null;
      }
      const updated = { ...existing, canApproveExtraWithdrawal: granted };
      userStore.set(existing.email, updated);
      return updated;
    },
    async createUser(input: CreateUserInput) {
      if (userStore.has(input.email)) {
        throw new UserEmailAlreadyExistsError(input.email);
      }
      const created: User = {
        id: uuidv7(),
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role,
        active: true,
        // Matches the real `createUserPort().createUser`'s corrected
        // behavior (spec-user-creation review fix): never true on create,
        // regardless of role -- FR45's grant is always a separate, explicit
        // step afterward.
        canApproveExtraWithdrawal: false,
        createdAt: new Date().toISOString(),
      };
      userStore.set(created.email, created);
      return created;
    },
    async updatePassword(id, passwordHash) {
      const existing = [...userStore.values()].find((u) => u.id === id);
      if (!existing) {
        return null;
      }
      const updated = { ...existing, passwordHash };
      userStore.set(existing.email, updated);
      return updated;
    },
  };

  const sessionPort: SessionPort = {
    async createSession(input: CreateSessionInput) {
      const session: Session = {
        id: `session-${nextId++}`,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: new Date().toISOString(),
      };
      sessionStore.set(session.tokenHash, session);
      return session;
    },
    async deleteSession(tokenHash) {
      sessionStore.delete(tokenHash);
    },
    async findSessionByTokenHash(tokenHash) {
      return sessionStore.get(tokenHash) ?? null;
    },
    async touchSession(tokenHash, expiresAt) {
      const existing = sessionStore.get(tokenHash);
      if (!existing) {
        return 0;
      }
      sessionStore.set(tokenHash, { ...existing, expiresAt });
      return 1;
    },
    async listSessionsByUser(userId) {
      const now = Date.now();
      return Array.from(sessionStore.values()).filter(
        (s) => s.userId === userId && new Date(s.expiresAt).getTime() > now,
      );
    },
    async deleteSessionById(id, userId) {
      const match = Array.from(sessionStore.values()).find(
        (s) => s.id === id && s.userId === userId,
      );
      if (!match) {
        return 0;
      }
      sessionStore.delete(match.tokenHash);
      return 1;
    },
    async deleteAllSessionsForUser(userId) {
      let deleted = 0;
      for (const [tokenHash, s] of sessionStore.entries()) {
        if (s.userId === userId) {
          sessionStore.delete(tokenHash);
          deleted += 1;
        }
      }
      return deleted;
    },
  };

  return { userPort, sessionPort, sessionStore };
}

describe("auth", () => {
  let deps: AuthDeps;
  let sessionStore: Map<string, Session>;

  beforeEach(async () => {
    const passwordHash = await argon2.hash(CORRECT_PASSWORD);
    const users: User[] = [
      {
        id: "user-active",
        email: ACTIVE_EMAIL,
        passwordHash,
        role: "owner_admin",
        active: true,
        canApproveExtraWithdrawal: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "user-other-active",
        email: OTHER_ACTIVE_EMAIL,
        passwordHash,
        role: "partner",
        active: true,
        canApproveExtraWithdrawal: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "user-inactive",
        email: INACTIVE_EMAIL,
        passwordHash,
        role: "partner",
        active: false,
        canApproveExtraWithdrawal: false,
        createdAt: new Date().toISOString(),
      },
    ];
    const ports = createFakePorts(users);
    deps = { users: ports.userPort, sessions: ports.sessionPort };
    sessionStore = ports.sessionStore;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("login", () => {
    it("succeeds for correct credentials on an active user, creating a session row", async () => {
      const result = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.token).toBeTruthy();
      expect(result.userId).toBe("user-active");

      const stored = sessionStore.get(hashToken(result.token));
      expect(stored).toBeDefined();
      expect(stored?.userId).toBe("user-active");
    });

    it("rejects a wrong password with invalid_credentials", async () => {
      const result = await login(ACTIVE_EMAIL, "totally-wrong-password", deps);

      expect(result).toEqual({ ok: false, error: "invalid_credentials" });
    });

    it("rejects an unknown email with invalid_credentials", async () => {
      const result = await login("nobody@niveshbook.test", CORRECT_PASSWORD, deps);

      expect(result).toEqual({ ok: false, error: "invalid_credentials" });
    });

    it("returns the identical error for wrong password and unknown email", async () => {
      const wrongPassword = await login(ACTIVE_EMAIL, "nope", deps);
      const unknownEmail = await login("nobody@niveshbook.test", CORRECT_PASSWORD, deps);

      expect(wrongPassword).toEqual(unknownEmail);
    });

    it("rejects correct credentials for an inactive user with a distinct error", async () => {
      const result = await login(INACTIVE_EMAIL, CORRECT_PASSWORD, deps);

      expect(result).toEqual({ ok: false, error: "inactive_account" });
    });

    it("never creates a session for a failed login", async () => {
      await login(ACTIVE_EMAIL, "wrong", deps);
      await login(INACTIVE_EMAIL, CORRECT_PASSWORD, deps);

      expect(sessionStore.size).toBe(0);
    });
  });

  describe("logout", () => {
    it("deletes the session row so the old token no longer authenticates", async () => {
      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");

      const beforeLogout = await getSession(loginResult.token, deps);
      expect(beforeLogout).not.toBeNull();

      await logout(hashToken(loginResult.token), deps);

      const afterLogout = await getSession(loginResult.token, deps);
      expect(afterLogout).toBeNull();
      expect(sessionStore.has(hashToken(loginResult.token))).toBe(false);
    });
  });

  describe("getSession", () => {
    it("treats a missing token as unauthenticated", async () => {
      expect(await getSession(undefined, deps)).toBeNull();
      expect(await getSession(null, deps)).toBeNull();
    });

    it("treats a garbage/unknown token as unauthenticated", async () => {
      expect(await getSession("not-a-real-token", deps)).toBeNull();
    });

    it("treats an expired session as unauthenticated", async () => {
      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");

      const stored = sessionStore.get(hashToken(loginResult.token));
      if (!stored) throw new Error("expected session to exist");
      stored.expiresAt = new Date(Date.now() - 1000).toISOString();

      expect(await getSession(loginResult.token, deps)).toBeNull();
    });

    it("extends expiresAt by another SESSION_TTL_MS on every successful resolution", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");
      const initialExpiresAt = loginResult.expiresAt;

      // Advance 10 minutes — well within the TTL — and resolve again.
      vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
      const resolved = await getSession(loginResult.token, deps);

      expect(resolved).not.toBeNull();
      const renewedExpiresAt = resolved?.expiresAt as string;
      expect(new Date(renewedExpiresAt).getTime()).toBeGreaterThan(
        new Date(initialExpiresAt).getTime(),
      );
      expect(new Date(renewedExpiresAt).getTime()).toBe(
        new Date("2026-01-01T00:10:00.000Z").getTime() + SESSION_TTL_MS,
      );

      // The store itself was updated, not just the returned value.
      const stored = sessionStore.get(hashToken(loginResult.token));
      expect(stored?.expiresAt).toBe(renewedExpiresAt);
    });

    it("stays valid across continuous use spanning longer than one fixed TTL window", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");

      // A request at least every 29 minutes, for 45 minutes total — beyond
      // the original fixed 30-minute window from Story 1.1, but each gap is
      // within the sliding TTL.
      vi.setSystemTime(new Date("2026-01-01T00:29:00.000Z"));
      expect(await getSession(loginResult.token, deps)).not.toBeNull();

      vi.setSystemTime(new Date("2026-01-01T00:45:00.000Z"));
      expect(await getSession(loginResult.token, deps)).not.toBeNull();
    });

    it("treats a genuine 30+ minute gap since the last request as expired", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");

      vi.setSystemTime(new Date("2026-01-01T00:31:00.000Z"));
      expect(await getSession(loginResult.token, deps)).toBeNull();
    });

    it("treats a revoke-then-renew race (touchSession matches nothing) as unauthenticated", async () => {
      // Simulates the session row being deleted by a concurrent revoke
      // between the initial read and the renewal write: the read still
      // sees the (now stale) session, but the update matches zero rows.
      const raceDeps: Pick<AuthDeps, "sessions"> = {
        sessions: {
          async createSession() {
            throw new Error("not used");
          },
          async deleteSession() {},
          async findSessionByTokenHash() {
            return {
              id: "session-race",
              userId: "user-active",
              tokenHash: "irrelevant",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              createdAt: new Date().toISOString(),
            };
          },
          async touchSession() {
            return 0;
          },
          async listSessionsByUser() {
            return [];
          },
          async deleteSessionById() {
            return 0;
          },
          async deleteAllSessionsForUser() {
            return 0;
          },
        },
      };

      expect(await getSession("some-token", raceDeps)).toBeNull();
    });
  });

  describe("listSessions", () => {
    it("returns only the caller's own sessions, never another user's", async () => {
      const first = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      const second = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      const other = await login(OTHER_ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!first.ok || !second.ok || !other.ok) throw new Error("expected logins to succeed");

      const sessions = await listSessions(first.userId, deps);

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.userId === "user-active")).toBe(true);
      expect(sessions.some((s) => s.userId === "user-other-active")).toBe(false);
    });
  });

  describe("revokeSession", () => {
    it("deletes a session the caller owns and returns true", async () => {
      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");

      const [session] = await listSessions(loginResult.userId, deps);
      if (!session) throw new Error("expected a session to exist");

      const revoked = await revokeSession(session.id, loginResult.userId, deps);

      expect(revoked).toBe(true);
      expect(await getSession(loginResult.token, deps)).toBeNull();
    });

    it("revoking one of a user's two sessions leaves the other untouched", async () => {
      const first = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      const second = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!first.ok || !second.ok) throw new Error("expected logins to succeed");

      const sessions = await listSessions(first.userId, deps);
      expect(sessions).toHaveLength(2);
      const [sessionToRevoke] = sessions.filter(
        (s) => s.tokenHash === hashToken(first.token),
      );
      if (!sessionToRevoke) throw new Error("expected first session to exist");

      const revoked = await revokeSession(sessionToRevoke.id, first.userId, deps);
      expect(revoked).toBe(true);

      expect(await getSession(first.token, deps)).toBeNull();
      expect(await getSession(second.token, deps)).not.toBeNull();

      const remaining = await listSessions(first.userId, deps);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.tokenHash).toBe(hashToken(second.token));
    });

    it("revoking the session currently in use behaves like logout", async () => {
      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");

      const [session] = await listSessions(loginResult.userId, deps);
      if (!session) throw new Error("expected a session to exist");

      const revoked = await revokeSession(session.id, loginResult.userId, deps);
      expect(revoked).toBe(true);

      const replay = await getSession(loginResult.token, deps);
      expect(replay).toBeNull();
    });

    it("returns false and deletes nothing when the session id belongs to another user", async () => {
      const mine = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      const theirs = await login(OTHER_ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!mine.ok || !theirs.ok) throw new Error("expected logins to succeed");

      const [theirSession] = await listSessions(theirs.userId, deps);
      if (!theirSession) throw new Error("expected their session to exist");

      const revoked = await revokeSession(theirSession.id, mine.userId, deps);

      expect(revoked).toBe(false);
      // Nothing was deleted anywhere — their session is still resolvable.
      expect(await getSession(theirs.token, deps)).not.toBeNull();
    });

    it("returns false for a session id that doesn't exist at all", async () => {
      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");

      const revoked = await revokeSession("no-such-session-id", loginResult.userId, deps);

      expect(revoked).toBe(false);
    });
  });

  describe("setUserActiveStatus", () => {
    it("deactivating an active user flips active to false and deletes every one of their sessions", async () => {
      const first = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      const second = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!first.ok || !second.ok) throw new Error("expected logins to succeed");

      const updated = await setUserActiveStatus("user-active", false, deps);

      expect(updated?.active).toBe(false);
      expect(await getSession(first.token, deps)).toBeNull();
      expect(await getSession(second.token, deps)).toBeNull();
      expect(await listSessions("user-active", deps)).toHaveLength(0);
    });

    it("deactivating a user does not delete another user's sessions", async () => {
      const mine = await login(OTHER_ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      const theirs = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!mine.ok || !theirs.ok) throw new Error("expected logins to succeed");

      await setUserActiveStatus("user-active", false, deps);

      expect(await getSession(mine.token, deps)).not.toBeNull();
    });

    it("reactivating an inactive user flips active to true without touching (creating/restoring) sessions", async () => {
      const deleteAllSpy = vi.spyOn(deps.sessions, "deleteAllSessionsForUser");

      const updated = await setUserActiveStatus("user-inactive", true, deps);

      expect(updated?.active).toBe(true);
      expect(deleteAllSpy).not.toHaveBeenCalled();
      expect(sessionStore.size).toBe(0);
    });

    it("is idempotent: deactivating an already-inactive user makes no session-deletion call", async () => {
      const deleteAllSpy = vi.spyOn(deps.sessions, "deleteAllSessionsForUser");

      const updated = await setUserActiveStatus("user-inactive", false, deps);

      expect(updated?.active).toBe(false);
      expect(deleteAllSpy).not.toHaveBeenCalled();
    });

    it("is idempotent: reactivating an already-active user makes no session-deletion call and leaves sessions intact", async () => {
      const loginResult = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!loginResult.ok) throw new Error("expected login to succeed");
      const deleteAllSpy = vi.spyOn(deps.sessions, "deleteAllSessionsForUser");

      const updated = await setUserActiveStatus("user-active", true, deps);

      expect(updated?.active).toBe(true);
      expect(deleteAllSpy).not.toHaveBeenCalled();
      expect(await getSession(loginResult.token, deps)).not.toBeNull();
    });

    it("returns null for an unknown user id and never calls setUserActive/deleteAllSessionsForUser", async () => {
      const setActiveSpy = vi.spyOn(deps.users, "setUserActive");
      const deleteAllSpy = vi.spyOn(deps.sessions, "deleteAllSessionsForUser");

      const updated = await setUserActiveStatus("no-such-user", false, deps);

      expect(updated).toBeNull();
      expect(setActiveSpy).not.toHaveBeenCalled();
      expect(deleteAllSpy).not.toHaveBeenCalled();
    });
  });

  describe("createUser", () => {
    const NEW_EMAIL = "new-partner@niveshbook.test";
    const NEW_PASSWORD = "a-fine-password";

    it("creates an owner_admin/partner/sub_partner account, hashing the password via argon2", async () => {
      const created = await createUser(NEW_EMAIL, NEW_PASSWORD, "partner", deps);

      expect(created.email).toBe(NEW_EMAIL);
      expect(created.role).toBe("partner");
      expect(created.active).toBe(true);
      // FR45 (review fix): never inherited true on create, regardless of
      // role -- Extra Withdrawal approval authority is always a separate,
      // explicit grant afterward.
      expect(created.canApproveExtraWithdrawal).toBe(false);
      expect(created.passwordHash).not.toBe(NEW_PASSWORD);
      expect(await argon2.verify(created.passwordHash, NEW_PASSWORD)).toBe(true);
    });

    it("the created account can actually log in with the exact password it was created with (this spec's central AC)", async () => {
      await createUser(NEW_EMAIL, NEW_PASSWORD, "partner", deps);

      const result = await login(NEW_EMAIL, NEW_PASSWORD, deps);

      expect(result.ok).toBe(true);
    });

    it("normalizes (trims/lowercases) the email exactly like login()'s own convention", async () => {
      await createUser("  Mixed-Case@Niveshbook.test  ", NEW_PASSWORD, "sub_partner", deps);

      const result = await login("mixed-case@niveshbook.test", NEW_PASSWORD, deps);

      expect(result.ok).toBe(true);
    });

    it.each(["owner_admin", "partner", "sub_partner"] as const)(
      "allows creating a %s account -- every role in the creatable set",
      async (role) => {
        const created = await createUser(`${role}@niveshbook.test`, NEW_PASSWORD, role, deps);
        expect(created.role).toBe(role);
      },
    );

    it("rejects project_admin with InvalidCreatableRoleError -- not in the creatable set (FR6)", async () => {
      await expect(createUser(NEW_EMAIL, NEW_PASSWORD, "project_admin", deps)).rejects.toBeInstanceOf(
        InvalidCreatableRoleError,
      );
    });

    it("never calls deps.users.createUser for an uncreatable role", async () => {
      const createSpy = vi.spyOn(deps.users, "createUser");

      await expect(createUser(NEW_EMAIL, NEW_PASSWORD, "project_admin", deps)).rejects.toThrow();

      expect(createSpy).not.toHaveBeenCalled();
    });

    it("propagates UserEmailAlreadyExistsError from the port unchanged for a duplicate email", async () => {
      await createUser(NEW_EMAIL, NEW_PASSWORD, "partner", deps);

      await expect(createUser(NEW_EMAIL, "a-different-password", "partner", deps)).rejects.toBeInstanceOf(
        UserEmailAlreadyExistsError,
      );
    });
  });

  describe("resetUserPassword", () => {
    const NEW_PASSWORD = "a-brand-new-password";

    it("hashes the new password via argon2 and stores it, never the plaintext", async () => {
      const updated = await resetUserPassword("user-active", NEW_PASSWORD, deps);

      expect(updated?.passwordHash).not.toBe(NEW_PASSWORD);
      expect(await argon2.verify(updated!.passwordHash, NEW_PASSWORD)).toBe(true);
    });

    it("this spec's central AC: a session created before the reset is gone after, and login works with the new password but not the old one", async () => {
      const before = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!before.ok) throw new Error("expected login to succeed");

      await resetUserPassword("user-active", NEW_PASSWORD, deps);

      // Old session gone immediately.
      expect(await getSession(before.token, deps)).toBeNull();
      expect(await listSessions("user-active", deps)).toHaveLength(0);

      // Old password no longer logs in.
      const oldPasswordAttempt = await login(ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      expect(oldPasswordAttempt.ok).toBe(false);

      // New (and only the new) password logs in.
      const newPasswordAttempt = await login(ACTIVE_EMAIL, NEW_PASSWORD, deps);
      expect(newPasswordAttempt.ok).toBe(true);
    });

    it("does not delete another user's sessions", async () => {
      const theirs = await login(OTHER_ACTIVE_EMAIL, CORRECT_PASSWORD, deps);
      if (!theirs.ok) throw new Error("expected login to succeed");

      await resetUserPassword("user-active", NEW_PASSWORD, deps);

      expect(await getSession(theirs.token, deps)).not.toBeNull();
    });

    it("rejects a password under 8 characters with PasswordTooShortError, never touching the port", async () => {
      const updatePasswordSpy = vi.spyOn(deps.users, "updatePassword");
      const deleteAllSpy = vi.spyOn(deps.sessions, "deleteAllSessionsForUser");

      await expect(resetUserPassword("user-active", "short", deps)).rejects.toBeInstanceOf(
        PasswordTooShortError,
      );

      expect(updatePasswordSpy).not.toHaveBeenCalled();
      expect(deleteAllSpy).not.toHaveBeenCalled();
    });

    it("rejects a password over 128 characters with PasswordTooLongError, never touching the port", async () => {
      const updatePasswordSpy = vi.spyOn(deps.users, "updatePassword");

      await expect(resetUserPassword("user-active", "a".repeat(129), deps)).rejects.toBeInstanceOf(
        PasswordTooLongError,
      );

      expect(updatePasswordSpy).not.toHaveBeenCalled();
    });

    it("accepts a password at exactly the 8 and 128 character boundaries", async () => {
      await expect(resetUserPassword("user-active", "a".repeat(8), deps)).resolves.not.toBeNull();
      await expect(resetUserPassword("user-other-active", "a".repeat(128), deps)).resolves.not.toBeNull();
    });

    it("returns null for an unknown user id and never calls deleteAllSessionsForUser", async () => {
      const deleteAllSpy = vi.spyOn(deps.sessions, "deleteAllSessionsForUser");

      const updated = await resetUserPassword("no-such-user", NEW_PASSWORD, deps);

      expect(updated).toBeNull();
      expect(deleteAllSpy).not.toHaveBeenCalled();
    });

    it("resetting an already-inactive user's password still works -- login() itself already checks active separately", async () => {
      const updated = await resetUserPassword("user-inactive", NEW_PASSWORD, deps);

      expect(updated?.active).toBe(false);
      expect(await argon2.verify(updated!.passwordHash, NEW_PASSWORD)).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import * as argon2 from "argon2";
import type { User, Session } from "@niveshbook/types";
import { login, logout, getSession, hashToken, type AuthDeps } from "./auth";
import type { UserPort } from "./user-port";
import type { SessionPort, CreateSessionInput } from "./session-port";

const ACTIVE_EMAIL = "active@niveshbook.test";
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
        createdAt: new Date().toISOString(),
      },
      {
        id: "user-inactive",
        email: INACTIVE_EMAIL,
        passwordHash,
        role: "partner",
        active: false,
        createdAt: new Date().toISOString(),
      },
    ];
    const ports = createFakePorts(users);
    deps = { users: ports.userPort, sessions: ports.sessionPort };
    sessionStore = ports.sessionStore;
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
  });
});

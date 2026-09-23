import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { cookies } from "next/headers";
import HomePage from "./page";
import { LoginForm } from "./LoginForm";
import { LogoutButton } from "./LogoutButton";
import { SessionList } from "./SessionList";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const listSessionsByUser = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    findSessionByTokenHash,
    touchSession,
    listSessionsByUser,
    deleteSessionById: vi.fn(),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

function mockCookies(token: string | undefined) {
  (cookies as unknown as Mock).mockResolvedValue({
    get: (name: string) => (name === SESSION_COOKIE_NAME && token ? { value: token } : undefined),
  });
}

/** Walks the returned element tree looking for a component of the given type. */
function containsComponent(node: ReactNode, type: unknown): boolean {
  return findComponent(node, type) !== null;
}

/** Walks the returned element tree and returns the first element of the given type. */
function findComponent(node: ReactNode, type: unknown): ReactElement | null {
  if (node === null || node === undefined || typeof node !== "object") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findComponent(child, type);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) {
    return element;
  }
  return findComponent(element.props?.children, type);
}

describe("HomePage", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    listSessionsByUser.mockReset().mockResolvedValue([]);
  });

  it("renders the login form when there is no session", async () => {
    mockCookies(undefined);

    const result = await HomePage();

    expect(containsComponent(result, LoginForm)).toBe(true);
    expect(containsComponent(result, LogoutButton)).toBe(false);
  });

  it("renders the logged-in view when there is a live session", async () => {
    mockCookies("a-valid-token");
    findSessionByTokenHash.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      tokenHash: "irrelevant",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const result = await HomePage();

    expect(containsComponent(result, LogoutButton)).toBe(true);
    expect(containsComponent(result, LoginForm)).toBe(false);
  });

  it("passes the caller's sessions (and the current session id) to SessionList", async () => {
    mockCookies("a-valid-token");
    findSessionByTokenHash.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      tokenHash: "irrelevant",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    listSessionsByUser.mockResolvedValue([
      {
        id: "session-1",
        userId: "user-1",
        tokenHash: "irrelevant",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: "session-2",
        userId: "user-1",
        tokenHash: "irrelevant-2",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    const result = await HomePage();

    const sessionList = findComponent(result, SessionList) as ReactElement<{
      sessions: Array<{ id: string }>;
      currentSessionId?: string;
    }> | null;

    expect(sessionList).not.toBeNull();
    expect(sessionList?.props.sessions).toHaveLength(2);
    expect(sessionList?.props.sessions.map((s) => s.id)).toEqual(["session-1", "session-2"]);
    expect(sessionList?.props.currentSessionId).toBe("session-1");
  });
});

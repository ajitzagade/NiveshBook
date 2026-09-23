import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession, requireOwnerAdminSession } from "./session-guard";
import { SESSION_COOKIE_NAME } from "./session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();

vi.mock("@niveshbook/db", () => ({
  createSessionPort: () => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    findSessionByTokenHash,
    touchSession,
    listSessionsByUser: vi.fn(),
    deleteSessionById: vi.fn(),
  }),
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById,
    listAllUsers: vi.fn(),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

function mockCookies(token: string | undefined) {
  (cookies as unknown as Mock).mockResolvedValue({
    get: (name: string) => (name === SESSION_COOKIE_NAME && token ? { value: token } : undefined),
  });
}

const LIVE_SESSION = {
  id: "session-1",
  userId: "user-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

describe("requireSession", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    (redirect as unknown as Mock).mockClear();
  });

  it("redirects to / when there is no session", async () => {
    mockCookies(undefined);

    await expect(requireSession()).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("resolves the session normally when there is a live session", async () => {
    mockCookies("a-valid-token");
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);

    const session = await requireSession();

    expect(session.id).toBe(LIVE_SESSION.id);
    expect(session.userId).toBe(LIVE_SESSION.userId);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("requireOwnerAdminSession", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    (redirect as unknown as Mock).mockClear();
    mockCookies("a-valid-token");
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
  });

  it("redirects to / for an authenticated non-owner_admin role", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "partner", active: true });

    await expect(requireOwnerAdminSession()).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("resolves the session normally for an owner_admin", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "owner_admin", active: true });

    const session = await requireOwnerAdminSession();

    expect(session.id).toBe(LIVE_SESSION.id);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to / when the session's user can no longer be found", async () => {
    findUserById.mockResolvedValue(null);

    await expect(requireOwnerAdminSession()).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
  });
});

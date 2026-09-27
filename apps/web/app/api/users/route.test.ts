import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import * as argon2 from "argon2";
import { UserEmailAlreadyExistsError } from "@niveshbook/core";
import { GET, POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const findSessionByTokenHash = vi.fn();
const touchSession = vi.fn();
const findUserById = vi.fn();
const findUserByEmail = vi.fn();
const listAllUsers = vi.fn();
const createUserOnPort = vi.fn();

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
    findUserByEmail,
    findUserById,
    listAllUsers,
    createUser: createUserOnPort,
  }),
}));

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/users", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function makePostRequest(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const LIVE_SESSION = {
  id: "session-1",
  userId: "owner-1",
  tokenHash: "irrelevant",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

const OWNER_USER = {
  id: "owner-1",
  email: "owner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "owner_admin" as const,
  active: true,
  createdAt: new Date().toISOString(),
};

const PARTNER_USER = {
  id: "partner-1",
  email: "partner@niveshbook.test",
  passwordHash: "hash-should-never-leave-server",
  role: "partner" as const,
  active: true,
  createdAt: new Date().toISOString(),
};

describe("GET /api/users", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    findUserByEmail.mockReset();
    listAllUsers.mockReset();
    createUserOnPort.mockReset();
  });

  it("returns 401 with no session cookie", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(listAllUsers).not.toHaveBeenCalled();
  });

  it("returns 401 when the session cookie doesn't resolve", async () => {
    findSessionByTokenHash.mockResolvedValue(null);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(401);
    expect(listAllUsers).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(403);
    expect(listAllUsers).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("returns 200 with a sanitized user list for an owner_admin, never passwordHash", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    listAllUsers.mockResolvedValue([OWNER_USER, PARTNER_USER]);

    const response = await GET(makeRequest(`${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([
      {
        id: OWNER_USER.id,
        email: OWNER_USER.email,
        role: OWNER_USER.role,
        active: OWNER_USER.active,
        createdAt: OWNER_USER.createdAt,
      },
      {
        id: PARTNER_USER.id,
        email: PARTNER_USER.email,
        role: PARTNER_USER.role,
        active: PARTNER_USER.active,
        createdAt: PARTNER_USER.createdAt,
      },
    ]);
    for (const user of body) {
      expect(user.passwordHash).toBeUndefined();
    }
  });
});

describe("POST /api/users (spec-user-creation)", () => {
  beforeEach(() => {
    findSessionByTokenHash.mockReset();
    touchSession.mockReset();
    touchSession.mockResolvedValue(1);
    findUserById.mockReset();
    findUserByEmail.mockReset();
    listAllUsers.mockReset();
    createUserOnPort.mockReset();
  });

  const VALID_BODY = { email: "new-partner@niveshbook.test", password: "a-fine-password", role: "partner" };

  it("returns 401 with no session cookie, and never touches the port", async () => {
    const response = await POST(makePostRequest(VALID_BODY));

    expect(response.status).toBe(401);
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-owner_admin, before the body is ever read (AD-1)", async () => {
    findSessionByTokenHash.mockResolvedValue({ ...LIVE_SESSION, userId: "partner-1" });
    findUserById.mockResolvedValue(PARTNER_USER);

    const response = await POST(makePostRequest(VALID_BODY, `${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(403);
    expect(findUserByEmail).not.toHaveBeenCalled();
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body from an owner_admin", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const request = new NextRequest("http://localhost/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE_NAME}=some-token` },
      body: "not-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for an invalid email", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ ...VALID_BODY, email: "not-an-email" }, `${SESSION_COOKIE_NAME}=some-token`),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for a password under 8 characters", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ ...VALID_BODY, password: "short" }, `${SESSION_COOKIE_NAME}=some-token`),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for a password over 128 characters -- caps input reaching argon2.hash() (review fix)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ ...VALID_BODY, password: "a".repeat(129) }, `${SESSION_COOKIE_NAME}=some-token`),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for role: project_admin -- not in the creatable set (FR6)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ ...VALID_BODY, role: "project_admin" }, `${SESSION_COOKIE_NAME}=some-token`),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 400 validation_error for an unrecognized role", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);

    const response = await POST(
      makePostRequest({ ...VALID_BODY, role: "superuser" }, `${SESSION_COOKIE_NAME}=some-token`),
    );

    expect(response.status).toBe(400);
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 400 'Email already in use.' when findUserByEmail's pre-check finds an existing account -- never calls the port's createUser", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(PARTNER_USER);

    const response = await POST(makePostRequest(VALID_BODY, `${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(body.message).toBe("Email already in use.");
    expect(createUserOnPort).not.toHaveBeenCalled();
  });

  it("returns 400 'Email already in use.' when the pre-check misses but the port throws a duplicate-email conflict (the race-safe backstop)", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(null);
    createUserOnPort.mockImplementation(async () => {
      throw new UserEmailAlreadyExistsError(VALID_BODY.email);
    });

    const response = await POST(makePostRequest(VALID_BODY, `${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("validation_error");
    expect(body.message).toBe("Email already in use.");
  });

  it("returns 201 with the sanitized created user (never passwordHash) on the happy path, hashing the password before it ever reaches the port", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(null);
    const createdRow = {
      id: "new-user-1",
      email: VALID_BODY.email,
      passwordHash: "irrelevant",
      role: "partner",
      active: true,
      createdAt: new Date().toISOString(),
    };
    createUserOnPort.mockImplementation(async (input: { email: string; passwordHash: string; role: string }) => ({
      ...createdRow,
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
    }));

    const response = await POST(makePostRequest(VALID_BODY, `${SESSION_COOKIE_NAME}=some-token`));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      id: createdRow.id,
      email: VALID_BODY.email,
      role: "partner",
      active: true,
      createdAt: createdRow.createdAt,
    });
    expect(body.passwordHash).toBeUndefined();

    expect(createUserOnPort).toHaveBeenCalledTimes(1);
    const portInput = createUserOnPort.mock.calls[0]?.[0] as { email: string; passwordHash: string; role: string };
    expect(portInput.email).toBe(VALID_BODY.email);
    expect(portInput.role).toBe("partner");
    expect(portInput.passwordHash).not.toBe(VALID_BODY.password);
    expect(await argon2.verify(portInput.passwordHash, VALID_BODY.password)).toBe(true);
  });

  it("lowercases/trims the email before checking uniqueness and creating the account", async () => {
    findSessionByTokenHash.mockResolvedValue(LIVE_SESSION);
    findUserById.mockResolvedValue(OWNER_USER);
    findUserByEmail.mockResolvedValue(null);
    createUserOnPort.mockImplementation(async (input: { email: string; passwordHash: string; role: string }) => ({
      id: "new-user-2",
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      active: true,
      createdAt: new Date().toISOString(),
    }));

    const response = await POST(
      makePostRequest(
        { ...VALID_BODY, email: "  Mixed-Case@Niveshbook.test  " },
        `${SESSION_COOKIE_NAME}=some-token`,
      ),
    );

    expect(response.status).toBe(201);
    const portInput = createUserOnPort.mock.calls[0]?.[0] as { email: string };
    expect(portInput.email).toBe("mixed-case@niveshbook.test");
  });
});

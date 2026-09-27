import type { User, UserRole } from "@niveshbook/types";
import type { UserPort } from "@niveshbook/core";

export const UNAUTHENTICATED_MESSAGE = "You must be logged in to do that.";
export const FORBIDDEN_MESSAGE = "You don't have permission to do that.";

/** Never includes `passwordHash` — this is the only shape a user route ever returns. */
export function sanitizeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
  };
}

/** The shape `sanitizeUser()` returns -- what `GET`/`POST /api/users` actually send over the wire, never `passwordHash`. */
export type SanitizedUser = ReturnType<typeof sanitizeUser>;

export type LinkedUserResolution = { ok: true; userId: string | null } | { ok: false; message: string };

export const ROLE_LABEL: Record<UserRole, string> = {
  owner_admin: "Owner/Admin",
  partner: "Partner",
  sub_partner: "Sub-partner",
  project_admin: "Project Admin",
};

/**
 * The roles an Owner/Admin may create an account with from the new Users
 * screen (spec-user-creation, Decision #1) -- deliberately excludes
 * `project_admin` (FR6, see `packages/core`'s `CREATABLE_USER_ROLES` doc
 * comment for why). Duplicated here rather than imported from
 * `@niveshbook/core` because this file is imported by a `"use client"` page
 * (`users/page.tsx`) -- a runtime import from `@niveshbook/core` breaks the
 * client bundle (argon2 has no browser-safe subpath export); `POST
 * /api/users`'s own server-side `createUser()` call is what actually
 * enforces this set, this array/type only drive what the form offers.
 */
export type CreatableUserRole = "owner_admin" | "partner" | "sub_partner";
export const CREATABLE_USER_ROLES: readonly CreatableUserRole[] = ["owner_admin", "partner", "sub_partner"];

/**
 * Server-side (route-layer) guard for `POST /api/users`'s `role` field --
 * the one place this creatable-role rule is actually ENFORCED (this is a
 * plain type guard, not itself a security boundary; `createUser()` in
 * `packages/core` re-checks the same set independently as the domain
 * layer's own invariant).
 */
export function isCreatableUserRole(value: string): value is CreatableUserRole {
  return (CREATABLE_USER_ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the "Linked user (email)" field shared by the Add/Edit Partner
 * and Add/Edit Sub-partner dialogs (Story 2.4) into a `userId | null` --
 * email resolution deliberately happens here, at the route layer, never in
 * `packages/core` (spec-2-4's Decisions: keeps `packages/core`'s port
 * dependencies narrow -- the domain layer never needs a `UserPort`).
 *
 * An empty string always means "no link", never "leave unchanged" -- every
 * POST/PATCH body is a full overwrite (matches `name`/`sharePercent`'s
 * existing convention, AD-3). A non-empty email that doesn't resolve to any
 * user, or resolves to a user whose global `role` doesn't match
 * `expectedRole` (`"partner"` for Partner Shares, `"sub_partner"` for
 * Sub-partner Shares), is rejected -- the caller surfaces this as a 400
 * `validation_error` before ever calling into `packages/core`.
 */
export async function resolveLinkedUserId(
  linkedUserEmail: string,
  expectedRole: UserRole,
  userPort: UserPort,
): Promise<LinkedUserResolution> {
  const trimmed = linkedUserEmail.trim();
  if (trimmed.length === 0) {
    return { ok: true, userId: null };
  }

  const user = await userPort.findUserByEmail(trimmed);
  if (!user) {
    return { ok: false, message: "No user found with that email." };
  }

  if (user.role !== expectedRole) {
    return {
      ok: false,
      message: `That user is not a ${ROLE_LABEL[expectedRole]}.`,
    };
  }

  return { ok: true, userId: user.id };
}

/**
 * Thin client-side fetch helpers for the new Users screen (spec-user-
 * creation) -- mirrors `apps/web/lib/projects.ts`'s `readErrorMessage`/
 * fetch-wrapper pattern. Everything above this point in the file runs
 * server-side only (route handlers); everything below is safe to import
 * from a `"use client"` page too (no runtime `@niveshbook/core` import,
 * per the client-bundle gotcha noted above).
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Body wasn't JSON (or had no message) -- fall through to the generic one.
  }
  return GENERIC_ERROR_MESSAGE;
}

/** `GET /api/users` -- the existing Owner/Admin-only user directory, reused unchanged for the new Users screen's own list (spec-user-creation, Decision #4: no new list endpoint needed). */
export async function listUsers(): Promise<SanitizedUser[]> {
  const response = await fetch("/api/users");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SanitizedUser[];
}

/**
 * `GET /api/users/me` (spec-user-reset-deactivate) -- resolves the caller's
 * own sanitized profile, used only so the Users screen can tell "which row
 * is mine" for its own UI-only "disable Deactivate on my own row" safeguard
 * (Decision #2). Not used for anything permission-sensitive -- the actual
 * self-deactivation risk this mitigates is still an accepted, unenforced
 * risk at the API layer (Story 1.6/1.7's own precedent, this spec's
 * Boundaries).
 */
export async function getCurrentUser(): Promise<SanitizedUser> {
  const response = await fetch("/api/users/me");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SanitizedUser;
}

export interface CreateUserAccountInput {
  email: string;
  password: string;
  role: CreatableUserRole;
}

/** `POST /api/users` (spec-user-creation). Throws on 401/403/400 -- the caller renders the message inline in the still-open dialog. */
export async function createUserAccount(input: CreateUserAccountInput): Promise<SanitizedUser> {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SanitizedUser;
}

/**
 * `PATCH /api/users/[id]` (Story 1.6, previously wired to no UI anywhere --
 * spec-user-reset-deactivate is what finally gives it one). Throws on
 * 401/403/404 -- the caller renders the message as a toast, mirroring this
 * screen's existing create-error handling.
 */
export async function setUserActive(userId: string, active: boolean): Promise<SanitizedUser> {
  const response = await fetch(`/api/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SanitizedUser;
}

export interface ResetUserPasswordInput {
  userId: string;
  password: string;
}

/**
 * `POST /api/users/[id]/reset-password` (spec-user-reset-deactivate). Throws
 * on 401/403/404/400 -- the caller renders the message inline in the still-
 * open Reset Password dialog, mirroring `createUserAccount()`'s identical
 * error-handling contract.
 */
export async function resetUserPassword({ userId, password }: ResetUserPasswordInput): Promise<SanitizedUser> {
  const response = await fetch(`/api/users/${userId}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SanitizedUser;
}

const GENERATED_PASSWORD_LENGTH = 12;
// Excludes visually-ambiguous characters (0/O, 1/l/I) -- this is a
// once-shown, copy-pasted credential (spec-user-creation, Decision #2), not
// one anyone is expected to type from memory, but ambiguity still makes a
// mis-transcription (e.g. into a password manager by hand) more likely.
const GENERATED_PASSWORD_LETTERS_DIGITS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const GENERATED_PASSWORD_SYMBOLS = "!@#$%^&*";

/**
 * Fills a random 12-character password (spec-user-creation, Decision #2):
 * letters+digits for every position except one, which is forced to a
 * symbol, then the whole string is shuffled so the symbol's position isn't
 * always the same -- via the browser's `crypto.getRandomValues()` (never
 * `Math.random()`, which isn't cryptographically secure).
 */
export function generatePassword(): string {
  const letterDigitValues = new Uint32Array(GENERATED_PASSWORD_LENGTH - 1);
  crypto.getRandomValues(letterDigitValues);
  const chars = Array.from(
    letterDigitValues,
    (value) => GENERATED_PASSWORD_LETTERS_DIGITS[value % GENERATED_PASSWORD_LETTERS_DIGITS.length],
  );

  const symbolValue = new Uint32Array(1);
  crypto.getRandomValues(symbolValue);
  chars.push(GENERATED_PASSWORD_SYMBOLS[(symbolValue[0] as number) % GENERATED_PASSWORD_SYMBOLS.length]);

  // Fisher-Yates shuffle, so the symbol (always pushed last above) doesn't
  // always land in the same position.
  const shuffleValues = new Uint32Array(chars.length);
  crypto.getRandomValues(shuffleValues);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = (shuffleValues[i] as number) % (i + 1);
    const temp = chars[i];
    chars[i] = chars[j] as string;
    chars[j] = temp as string;
  }

  return chars.join("");
}

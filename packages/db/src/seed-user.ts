import { uuidv7 } from "uuidv7";

/**
 * Builds the insert-values object for the single dev-seed user record.
 * `role` is always explicitly `"owner_admin"` — this seed script never
 * produces a user without a role (FR6). Pulled out of `seed.ts` so it's
 * testable without a live DB connection (`seed.ts` connects to Postgres at
 * import time via `main()`).
 */
export function buildSeedUserRecord(email: string, passwordHash: string) {
  return {
    id: uuidv7(),
    email,
    passwordHash,
    role: "owner_admin" as const,
    active: true,
  };
}

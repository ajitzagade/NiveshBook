/**
 * Dedicated e2e test account -- distinct from any real seeded admin, so the
 * suite never depends on (or risks colliding with) credentials a human is
 * also using locally. Seeded idempotently by `global-setup.ts` via the
 * existing `packages/db` seed script, against the local Docker Postgres
 * only (`.env`'s DATABASE_URL) -- this suite must never point at a
 * deployed/shared database.
 */
export const E2E_EMAIL = "e2e@niveshbook.test";
export const E2E_PASSWORD = "E2ePlaywright123!";

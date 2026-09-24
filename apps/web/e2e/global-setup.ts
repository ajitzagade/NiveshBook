import { execFileSync } from "node:child_process";
import path from "node:path";
import { E2E_EMAIL, E2E_PASSWORD } from "./test-credentials";

/**
 * Runs once before the whole suite. Reuses `packages/db`'s existing
 * dev-seed script (idempotent -- `onConflictDoNothing` on email) rather
 * than reaching into its internal, unexported `buildSeedUserRecord`
 * directly, which would reach past `@niveshbook/db`'s public surface
 * (`dist/index.js`) into its `src/`.
 */
export default function globalSetup() {
  const repoRoot = path.resolve(__dirname, "../../..");
  execFileSync("pnpm", ["--filter", "@niveshbook/db", "db:seed"], {
    cwd: repoRoot,
    env: { ...process.env, SEED_EMAIL: E2E_EMAIL, SEED_PASSWORD: E2E_PASSWORD },
    stdio: "inherit",
  });
}

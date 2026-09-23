import path from "node:path";
import { config } from "dotenv";
import * as argon2 from "argon2";
import { getDb, closeDb } from "./client";
import { users } from "./schema";
import { buildSeedUserRecord } from "./seed-user";

config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Dev-only helper: seeds one active user so login can be exercised manually
 * against the local Docker Compose Postgres. Not part of the app's runtime
 * path. Usage: SEED_EMAIL=... SEED_PASSWORD=... pnpm --filter @niveshbook/db db:seed
 */
async function main() {
  const email = (process.env.SEED_EMAIL ?? "owner@niveshbook.test").trim().toLowerCase();
  const password = process.env.SEED_PASSWORD ?? "changeme123";

  const db = getDb();
  const passwordHash = await argon2.hash(password);

  await db
    .insert(users)
    .values(buildSeedUserRecord(email, passwordHash))
    .onConflictDoNothing({ target: users.email });

  // eslint-disable-next-line no-console
  console.log(`Seeded user ${email} / ${password} (if not already present).`);
  await closeDb();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

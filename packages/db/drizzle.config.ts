import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load the repo-root .env regardless of where this is invoked from, so
// local dev only needs one DATABASE_URL definition.
config({ path: path.resolve(process.cwd(), "../../.env") });

const connectionString =
  process.env.DATABASE_URL ?? "postgres://niveshbook:niveshbook_dev@localhost:5433/niveshbook";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});

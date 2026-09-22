import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let sql: ReturnType<typeof postgres> | undefined;
let db: Database | undefined;

/**
 * Lazily creates a singleton Drizzle client against `DATABASE_URL`. Local
 * dev/test point this at the Docker Compose Postgres; production points it
 * at Neon — same wire protocol, same schema, no code branches (AD-7).
 */
export function getDb(): Database {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    sql = postgres(connectionString);
    db = drizzle(sql, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await sql?.end();
  sql = undefined;
  db = undefined;
}

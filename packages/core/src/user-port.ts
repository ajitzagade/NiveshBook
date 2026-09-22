import type { User } from "@niveshbook/types";

/**
 * Port for reading user records. Implemented by `packages/db` against
 * Postgres; `packages/core` never imports a DB driver directly (AD-9).
 */
export interface UserPort {
  findUserByEmail(email: string): Promise<User | null>;
}

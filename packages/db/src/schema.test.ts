import { describe, it, expect } from "vitest";
import { users } from "./schema";

describe("users table schema (FR6)", () => {
  it("marks role NOT NULL — the DB itself rejects a null/missing role", () => {
    expect(users.role.notNull).toBe(true);
  });

  it("gives role no implicit default — every insert must supply one explicitly", () => {
    expect(users.role.hasDefault).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { users, projects } from "./schema";

describe("users table schema (FR6)", () => {
  it("marks role NOT NULL — the DB itself rejects a null/missing role", () => {
    expect(users.role.notNull).toBe(true);
  });

  it("gives role no implicit default — every insert must supply one explicitly", () => {
    expect(users.role.hasDefault).toBe(false);
  });
});

describe("projects table schema (Story 2.1)", () => {
  it("marks name NOT NULL — a project must always have a name", () => {
    expect(projects.name.notNull).toBe(true);
  });

  it("leaves description nullable — a project can exist with none", () => {
    expect(projects.description.notNull).toBe(false);
  });

  it("gives id no implicit default — application code (uuidv7) always supplies one", () => {
    expect(projects.id.hasDefault).toBe(false);
  });

  it("marks createdAt/updatedAt NOT NULL with a DB-side default", () => {
    expect(projects.createdAt.notNull).toBe(true);
    expect(projects.createdAt.hasDefault).toBe(true);
    expect(projects.updatedAt.notNull).toBe(true);
    expect(projects.updatedAt.hasDefault).toBe(true);
  });
});

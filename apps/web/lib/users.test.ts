import { describe, it, expect } from "vitest";
import { CREATABLE_USER_ROLES as CORE_CREATABLE_USER_ROLES } from "@niveshbook/core";
import { CREATABLE_USER_ROLES as WEB_CREATABLE_USER_ROLES } from "./users";

/**
 * `apps/web/lib/users.ts`'s `CREATABLE_USER_ROLES` is a deliberate, separate
 * literal from `packages/core`'s own `CREATABLE_USER_ROLES` (a runtime
 * import from `@niveshbook/core` in a `"use client"` page breaks the build --
 * argon2 has no browser-safe subpath export). This test is the guard against
 * the two ever drifting apart silently -- if either list gains/loses a role
 * without the other, this fails instead of nothing.
 */
describe("CREATABLE_USER_ROLES (core vs. apps/web copy) stay in sync", () => {
  it("contain exactly the same roles", () => {
    expect(new Set(WEB_CREATABLE_USER_ROLES)).toEqual(new Set(CORE_CREATABLE_USER_ROLES));
  });
});

import { describe, it, expect } from "vitest";
import { buildSeedUserRecord } from "./seed-user";

describe("buildSeedUserRecord (FR6)", () => {
  it("always assigns a role, regardless of email/password inputs", () => {
    const record = buildSeedUserRecord("someone@niveshbook.test", "irrelevant-hash");

    expect(record.role).toBe("owner_admin");
  });

  it("never produces a falsy/missing role across different inputs", () => {
    const a = buildSeedUserRecord("a@niveshbook.test", "hash-a");
    const b = buildSeedUserRecord("b@niveshbook.test", "hash-b");

    expect(a.role).toBeTruthy();
    expect(b.role).toBeTruthy();
  });
});

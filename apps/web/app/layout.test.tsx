import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_CLIENT_APP_NAME = process.env.CLIENT_APP_NAME;

describe("layout metadata", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_CLIENT_APP_NAME === undefined) {
      delete process.env.CLIENT_APP_NAME;
    } else {
      process.env.CLIENT_APP_NAME = ORIGINAL_CLIENT_APP_NAME;
    }
  });

  it("derives title/description from CLIENT_APP_NAME instead of the literal string \"NiveshBook\"", async () => {
    process.env.CLIENT_APP_NAME = "Acme Capital";

    const { metadata } = await import("./layout");

    expect(metadata.title).toBe("Acme Capital");
    expect(metadata.description).toContain("Acme Capital");
    expect(metadata.description).not.toContain("NiveshBook");
  });

  it("falls back to NiveshBook when CLIENT_APP_NAME is unset", async () => {
    delete process.env.CLIENT_APP_NAME;

    const { metadata } = await import("./layout");

    expect(metadata.title).toBe("NiveshBook");
    expect(metadata.description).toContain("NiveshBook");
  });
});

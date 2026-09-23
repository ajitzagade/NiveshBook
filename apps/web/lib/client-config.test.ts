import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getClientConfig } from "./client-config";

const CLIENT_ENV_KEYS = [
  "CLIENT_APP_NAME",
  "CLIENT_LOCALE",
  "CLIENT_CURRENCY",
  "CLIENT_ENABLE_PROJECT_ADMIN",
] as const;

describe("getClientConfig", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of CLIENT_ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CLIENT_ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  it("defaults to NiveshBook / en-IN / INR / projectAdmin: false when no CLIENT_* vars are set", () => {
    expect(getClientConfig()).toEqual({
      branding: { appName: "NiveshBook" },
      locale: "en-IN",
      currency: "INR",
      enabledModules: { projectAdmin: false },
    });
  });

  it("reflects every override when all four CLIENT_* vars are set", () => {
    process.env.CLIENT_APP_NAME = "Acme Capital";
    process.env.CLIENT_LOCALE = "en-US";
    process.env.CLIENT_CURRENCY = "USD";
    process.env.CLIENT_ENABLE_PROJECT_ADMIN = "true";

    expect(getClientConfig()).toEqual({
      branding: { appName: "Acme Capital" },
      locale: "en-US",
      currency: "USD",
      enabledModules: { projectAdmin: true },
    });
  });

  it("falls back to the default (false) for a malformed boolean, e.g. \"yes\"", () => {
    process.env.CLIENT_ENABLE_PROJECT_ADMIN = "yes";

    expect(getClientConfig().enabledModules.projectAdmin).toBe(false);
  });

  it("only the literal string \"true\" parses as enabled — \"TRUE\"/\"1\" fall back to disabled", () => {
    process.env.CLIENT_ENABLE_PROJECT_ADMIN = "TRUE";
    expect(getClientConfig().enabledModules.projectAdmin).toBe(false);

    process.env.CLIENT_ENABLE_PROJECT_ADMIN = "1";
    expect(getClientConfig().enabledModules.projectAdmin).toBe(false);
  });
});

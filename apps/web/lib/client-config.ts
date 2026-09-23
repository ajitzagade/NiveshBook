/**
 * One `client.config` resolved from `CLIENT_*` env vars at boot (AD-7):
 * branding, locale, currency, and enabled-modules for this deployment. This
 * is the only file in the codebase that reads a `CLIENT_*` env var or
 * branches on client identity — `packages/core` never imports this module
 * (AD-9); callers resolve config here and pass the plain values down as
 * caller-supplied dependencies.
 *
 * A malformed or missing env var always falls back to its documented
 * default rather than throwing.
 */
export interface ClientConfig {
  branding: {
    appName: string;
  };
  locale: string;
  currency: string;
  enabledModules: {
    /** Project Admin ships disabled by default; toggled per client via config. */
    projectAdmin: boolean;
  };
}

const DEFAULT_APP_NAME = "NiveshBook";
const DEFAULT_LOCALE = "en-IN";
const DEFAULT_CURRENCY = "INR";
const DEFAULT_ENABLE_PROJECT_ADMIN = false;

export function getClientConfig(): ClientConfig {
  return {
    branding: {
      appName: process.env.CLIENT_APP_NAME || DEFAULT_APP_NAME,
    },
    locale: process.env.CLIENT_LOCALE || DEFAULT_LOCALE,
    currency: process.env.CLIENT_CURRENCY || DEFAULT_CURRENCY,
    enabledModules: {
      // Only the literal string "true" parses as enabled; anything else
      // (unset, "false", "yes", "1", ...) falls back to the documented
      // default of disabled.
      projectAdmin:
        process.env.CLIENT_ENABLE_PROJECT_ADMIN === "true"
          ? true
          : DEFAULT_ENABLE_PROJECT_ADMIN,
    },
  };
}

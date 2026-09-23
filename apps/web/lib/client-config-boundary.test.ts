import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * AD-7/AD-9 guarantee: `apps/web/lib/client-config.ts` is the only file in
 * the codebase that reads a `CLIENT_*` env var. This test greps the
 * `packages/core/src` and `apps/web` source trees for the four documented
 * `CLIENT_*` env var names and fails if any file outside `client-config.ts`
 * (and test files, which are allowed to reference the names as strings)
 * references them, so a regression on that boundary is caught automatically
 * instead of relying on a one-time manual grep.
 */

const ENV_VAR_NAMES = [
  "CLIENT_APP_NAME",
  "CLIENT_LOCALE",
  "CLIENT_CURRENCY",
  "CLIENT_ENABLE_PROJECT_ADMIN",
] as const;

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SEARCH_ROOTS = [
  path.join(REPO_ROOT, "packages", "core", "src"),
  path.join(REPO_ROOT, "apps", "web"),
];

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".git",
]);

const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function isTestFile(fileName: string): boolean {
  return /\.test\.(ts|tsx|js|jsx)$/.test(fileName);
}

function collectSourceFiles(dir: string, results: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;

    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      collectSourceFiles(fullPath, results);
    } else if (
      stats.isFile() &&
      SOURCE_FILE_EXTENSIONS.has(path.extname(entry)) &&
      !isTestFile(entry)
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

describe("CLIENT_* env var boundary", () => {
  it("only client-config.ts references CLIENT_APP_NAME/CLIENT_LOCALE/CLIENT_CURRENCY/CLIENT_ENABLE_PROJECT_ADMIN", () => {
    const clientConfigPath = path.join(REPO_ROOT, "apps", "web", "lib", "client-config.ts");

    const offenders: { file: string; matches: string[] }[] = [];

    for (const root of SEARCH_ROOTS) {
      const files = collectSourceFiles(root);

      for (const file of files) {
        if (file === clientConfigPath) continue;

        const content = readFileSync(file, "utf8");
        const matches = ENV_VAR_NAMES.filter((name) => content.includes(name));

        if (matches.length > 0) {
          offenders.push({ file: path.relative(REPO_ROOT, file), matches });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

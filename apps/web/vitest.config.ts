import path from "node:path";
import { defineConfig, defaultExclude } from "vitest/config";

export default defineConfig({
  // apps/web's tsconfig sets "jsx": "preserve" for Next's own SWC compiler;
  // override it here so Vite's transform compiles JSX itself instead of
  // passing it through untouched.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    // e2e/*.spec.ts use @playwright/test's own `test`/`expect`, not
    // vitest's -- Vitest's default include pattern would otherwise also
    // match them and try (and fail) to run them here.
    exclude: [...defaultExclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // apps/web's tsconfig sets "jsx": "preserve" for Next's own SWC compiler;
  // override it here so Vite's transform compiles JSX itself instead of
  // passing it through untouched.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

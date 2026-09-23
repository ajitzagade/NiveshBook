import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["dist/**", ".next/**", ".turbo/**", "node_modules/**"],
  },
);

export default base;

// AD-2: money and percentage values are exact end-to-end through one
// designated arithmetic module. Compose this into packages/core and
// packages/db only -- it names decimal-math.ts as the sole exemption.
const moneyBanMessage = (fn) =>
  `AD-2: ${fn}() is banned outside packages/core/src/decimal-math.ts -- monetary and percentage values must go through decimal-safe arithmetic there, never native float coercion.`;

export const noRawMoneyArithmetic = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/decimal-math.ts", "**/*.test.ts", "**/*.test.tsx"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.name='parseFloat']",
        message: moneyBanMessage("parseFloat"),
      },
      {
        selector: "CallExpression[callee.name='parseInt']",
        message: moneyBanMessage("parseInt"),
      },
      {
        selector: "CallExpression[callee.name='Number']",
        message: moneyBanMessage("Number"),
      },
    ],
  },
};

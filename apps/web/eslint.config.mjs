// Next.js 16 removed the `next lint` command; ESLint now runs directly via
// its flat config. `eslint-config-next` ships a flat config array.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default config;

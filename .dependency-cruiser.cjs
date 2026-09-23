/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-no-db",
      comment:
        "packages/core is framework-agnostic domain logic + ports (Dependency Inversion): it may depend on packages/types only, never on packages/db, apps/web, or a concrete DB driver.",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "^(packages/db|apps/web)" },
    },
    {
      name: "db-no-app",
      comment:
        "packages/db implements packages/core's ports; it may depend on packages/core and packages/types only, never on apps/web.",
      severity: "error",
      from: { path: "^packages/db" },
      to: { path: "^apps/web" },
    },
    {
      name: "no-circular",
      comment: "Circular dependencies make the port/adapter boundary meaningless.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    exclude: {
      path: "(^|/)node_modules/|(^|/)dist/|(^|/)\\.next/|(^|/)\\.turbo/",
    },
  },
};

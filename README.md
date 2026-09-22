# NiveshBook

Monorepo for NiveshBook, managed with pnpm workspaces + Turborepo.

## Structure

```
apps/
  web/      Next.js frontend
  api/      Fastify backend API
packages/
  core/     Framework-agnostic business logic (plug-and-play across products)
  ui/       Shared React UI components
  types/    Shared TypeScript types/contracts
  config/   Shared eslint/tsconfig base configs
```

## Getting started

```bash
pnpm install
pnpm dev      # run all apps in dev mode
pnpm build    # build all apps/packages
pnpm lint
pnpm typecheck
```

## Design goal

`packages/core`, `packages/types`, and `packages/ui` are built to be reusable
("plug and play") across other products/companies — keep them framework-light
and free of app-specific assumptions so they can be extracted or published
independently later.

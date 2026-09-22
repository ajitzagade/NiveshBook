# NiveshBook

Monorepo for NiveshBook, managed with pnpm workspaces + Turborepo.

## Structure

```
apps/
  web/      Next.js frontend + Route Handlers (the only HTTP boundary)
packages/
  core/     Framework-agnostic domain logic + ports (zero DB/HTTP imports)
  db/       Drizzle/Postgres adapter implementing packages/core's ports
  ui/       Shared React UI components
  types/    Shared TypeScript types/contracts
  config/   Shared eslint/tsconfig base configs
```

## Getting started

```bash
cp .env.example .env               # repo-root DATABASE_URL for packages/db scripts
cp apps/web/.env.example apps/web/.env.local
docker compose up -d --wait         # local Postgres 17, waits for healthcheck
pnpm install
pnpm db:migrate                    # apply packages/db/drizzle migrations
pnpm dev                           # run all apps in dev mode
pnpm build                         # build all apps/packages
pnpm lint
pnpm typecheck
pnpm test
```

## Design goal

`packages/core`, `packages/types`, and `packages/ui` are built to be reusable
("plug and play") across other products/companies — keep them framework-light
and free of app-specific assumptions so they can be extracted or published
independently later.

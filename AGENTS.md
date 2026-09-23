<!-- bmad:context -->
<!-- Verified 2026-09-23 against 797b790c2a9a6ee850c8d843fcde9b5730e5e8fb. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## NiveshBook

Monorepo (pnpm + Turborepo) for NiveshBook, a partner/investment-tracking app. Architecture decisions live in `_bmad-output/planning-artifacts/architecture/architecture-NiveshBook-2026-09-22/ARCHITECTURE-SPINE.md`; epics/stories in `_bmad-output/planning-artifacts/epics.md`; sprint status in `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## Policy

- Follow SOLID in all application code: single-responsibility modules/functions; extend via new implementations rather than editing stable ones (Open/Closed); any `packages/core` port implementation (e.g. `packages/db`) must be substitutable without changing caller code (Liskov); keep port interfaces narrow and role-specific, not one wide interface (Interface Segregation); callers depend on `packages/core`'s port interfaces, never directly on a concrete implementation like `packages/db` or a DB driver (Dependency Inversion).
- Import direction is enforced by `pnpm lint` (`dependency-cruiser`, `.dependency-cruiser.cjs`): `packages/core` → `packages/types` only, never `packages/db` or `apps/web`; `packages/db` → `packages/core`/`packages/types` only, never `apps/web`. A violation fails lint, not just code review.
- Every `app/api/**/route.ts` handler calls `packages/core`'s `authorize()`/`authorizeScope()` before touching data (AD-1) — never infer a permission from client-supplied data.
- `.github/workflows/ci.yml` runs `pnpm lint` (incl. `eslint-plugin-security`), `typecheck`, `test`, `build`, and `pnpm audit` on every push to `main` and every PR — required green before merge, not advisory.

## Running and verifying

- `pnpm audit` must show zero vulnerabilities before merging a dependency bump — same command CI runs (root script wraps pnpm's own audit, full scope including dev tooling). Example: the Next.js pin was bumped 16.2.10 → 16.3.6 on 2026-09-23 to clear 2 critical unauthenticated-RCE CVEs this audit caught; a pnpm override pins `esbuild` to `>=0.25.0` to clear a moderate finding in `drizzle-kit`'s transitive dev dependency.
- Dashboards, Money History, and report views must return in under 2 seconds at expected data volume (NFR10) — no automated perf check exists yet; treat this as a manual review criterion on any story touching those views until one is added.

<!-- /bmad:context -->

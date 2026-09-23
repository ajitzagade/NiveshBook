<!-- bmad:context -->
<!-- Verified 2026-09-23 against 6bef2172ab53c2c1fea78e73f0c2684e6103a6fc. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## NiveshBook

Monorepo (pnpm + Turborepo) for NiveshBook, a partner/investment-tracking app. Architecture decisions live in `_bmad-output/planning-artifacts/architecture/architecture-NiveshBook-2026-09-22/ARCHITECTURE-SPINE.md`; epics/stories in `_bmad-output/planning-artifacts/epics.md`; sprint status in `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## Policy

- Follow SOLID in all application code: single-responsibility modules/functions; extend via new implementations rather than editing stable ones (Open/Closed); any `packages/core` port implementation (e.g. `packages/db`) must be substitutable without changing caller code (Liskov); keep port interfaces narrow and role-specific, not one wide interface (Interface Segregation); callers depend on `packages/core`'s port interfaces, never directly on a concrete implementation like `packages/db` or a DB driver (Dependency Inversion).
- Import direction is enforced by `pnpm lint` (`dependency-cruiser`, `.dependency-cruiser.cjs`): `packages/core` → `packages/types` only, never `packages/db` or `apps/web`; `packages/db` → `packages/core`/`packages/types` only, never `apps/web`. A violation fails lint, not just code review.

<!-- /bmad:context -->

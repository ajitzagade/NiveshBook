- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: Session TTL is an absolute 30-minute expiry, not renewed on activity ("inactivity timeout" per PRD FR5 implies sliding window).
  evidence: `packages/core/src/auth.ts` sets `expiresAt` once at session creation; nothing extends it on later requests. Explicitly Story 1.4's scope (session timeout & revocation), excluded from Story 1.1's frozen Boundaries.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: A user deactivated after logging in keeps their authenticated session until natural expiry.
  evidence: `getSession()` never re-checks `users.active`. Deactivation itself (Story 1.6) doesn't exist yet in the codebase; Story 1.6 or 1.4 should make deactivation invalidate live sessions.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: `packages/db/src/ports.ts` (the Drizzle-backed port implementations) has zero test coverage against a real database.
  evidence: only `packages/core/src/auth.ts` is unit-tested, against in-memory fake ports. A correct DB-integration test needs a test-infra decision (e.g. testcontainers) beyond a trivial patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: Expired `sessions` rows are never purged — unbounded table growth over time.
  evidence: `getSession` filters expired rows client-side; no cleanup job exists. Low urgency given the PRD's small-to-medium data volume NFR, but needs an eventual cron/scheduled-cleanup decision.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: `users.role` has no DB-level enum/check constraint — trusted from the app-level `UserRole` TypeScript union only.
  evidence: `packages/db/src/schema.ts` declares `role: text("role").notNull()` with no constraint. Worth tightening when Story 1.5 builds out full role-based enforcement.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: AD-9's dependency-direction boundary is true by inspection only — no dependency-cruiser (or equivalent) tooling is installed to enforce it.
  evidence: `epic-1-context.md` claimed it was "lint-enforced via dependency-cruiser"; no such config/dependency exists anywhere in the repo. Recommend wiring this during Story 1.5, the authorization-gate story, when the package boundaries start carrying real security weight.

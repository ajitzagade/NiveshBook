- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: ~~Session TTL is an absolute 30-minute expiry, not renewed on activity.~~ **Resolved by Story 1.4** — `getSession()` now renews `expiresAt` on every successful resolution.
  evidence: n/a — kept for history only.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: ~~A user deactivated after logging in keeps their authenticated session until natural expiry.~~ **Resolved by Story 1.6** — `PATCH /api/users/[id]` (`setUserActiveStatus`) deletes every one of the target's `sessions` rows on a true→false transition, so `getSession()` still never re-checks `users.active`, but there's no live session left for it to resolve.
  evidence: n/a — kept for history only.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`, `_bmad-output/implementation-artifacts/spec-1-4-session-timeout-owner-admin-revocation.md`, `_bmad-output/implementation-artifacts/spec-1-5-roles-the-server-side-authorization-gate.md`, `_bmad-output/implementation-artifacts/spec-1-6-owner-admin-activates-or-deactivates-a-user.md`
  summary: `packages/db/src/ports.ts` (the Drizzle-backed port implementations) has zero test coverage against a real database.
  evidence: only `packages/core/src/auth.ts` is unit-tested, against in-memory fake ports; every `apps/web` route test mocks `@niveshbook/db` away entirely. Story 1.4 added three more untested methods (`touchSession`, `listSessionsByUser`, `deleteSessionById`) on top of Story 1.1's three; Story 1.5 added two more (`findUserById`, `listAllUsers`); Story 1.6 added two more (`setUserActive`, `deleteAllSessionsForUser`) — ten methods now unverified against a real database, including `deleteSessionById`'s and `deleteAllSessionsForUser`'s security-relevant `userId` scoping. A correct DB-integration test needs a test-infra decision (e.g. testcontainers) beyond a trivial patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: Expired `sessions` rows are never purged from the database — unbounded table growth over time.
  evidence: Story 1.4's patch filters expired rows out of the *list view* (`listSessionsByUser`), but the rows themselves are never deleted. No cleanup job exists. Low urgency given the PRD's small-to-medium data volume NFR, but needs an eventual cron/scheduled-cleanup decision.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: `users.role` has no DB-level enum/check constraint — trusted from the app-level `UserRole` TypeScript union only.
  evidence: `packages/db/src/schema.ts` declares `role: text("role").notNull()` with no constraint. Worth tightening when Story 1.5 builds out full role-based enforcement.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-user-login-and-logout.md`
  summary: AD-9's dependency-direction boundary is true by inspection only — no dependency-cruiser (or equivalent) tooling is installed to enforce it.
  evidence: `epic-1-context.md` claimed it was "lint-enforced via dependency-cruiser"; no such config/dependency exists anywhere in the repo. Recommend wiring this during Story 1.5, the authorization-gate story, when the package boundaries start carrying real security weight.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-owner-admin-activates-or-deactivates-a-user.md`
  summary: No audit trail (who/when) for `PATCH /api/users/[id]` activating/deactivating a user.
  evidence: this is a security-sensitive admin action recording no actor/timestamp anywhere in the schema or code. Pre-existing pattern — no story has built audit logging yet; epics.md's nav list names a future "Audit History" area as a separate, later concern.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-owner-admin-activates-or-deactivates-a-user.md`
  summary: `setUserActiveStatus`'s `setUserActive` write and `deleteAllSessionsForUser` bulk-delete are two sequential, non-transactional operations; a login racing a deactivation PATCH could create a new session after the bulk-delete step, which `getSession()` would still accept (it never re-checks `users.active`).
  evidence: `packages/core/src/auth.ts`'s `setUserActiveStatus` awaits `deps.users.setUserActive` then, only on a true→false transition, `deps.sessions.deleteAllSessionsForUser` — no transaction wraps the two. This narrows (but doesn't fully close) the pre-existing "`getSession()` never checks `active`" gap tracked above: existing sessions at the moment of deactivation are now correctly wiped, but a session created by a concurrently in-flight login is not. Closing it needs either a cross-port DB transaction (an AD-9 port-composition question) or a live `active` check in `login()`/`getSession()` — both larger than a trivial patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-owner-admin-manages-role-level-permissions.md`
  summary: No audit trail (who/when) for granting/revoking Extra Withdrawal approval authority via `PATCH /api/permissions/[userId]`.
  evidence: a financially-sensitive permission (FR25/FR45) recording no actor/timestamp anywhere. Same pre-existing pattern as Story 1.6's deactivation-audit gap — no story has built audit logging yet.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-owner-admin-manages-role-level-permissions.md`
  summary: Generated migration `packages/db/drizzle/0002_misty_warpath.sql` (adds `can_approve_extra_withdrawal`) has not been applied to any live database.
  evidence: no project Postgres instance was reachable (docker/colima not running) during implementation or review. Run `pnpm --filter @niveshbook/db db:migrate` against every environment with real data before this ships.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-owner-admin-manages-role-level-permissions.md`
  summary: No guard against revoking the last remaining Extra Withdrawal approver, or an Owner/Admin revoking their own grant — could leave zero users able to approve once Epic 4 enforces it.
  evidence: `packages/core/src/permissions.ts`'s `setApprovalAuthority` performs no such check; re-confirmed with the human as an accepted risk during Story 1.7's review, consistent with Story 1.6's identical self-lockout precedent. No functional consequence today since Epic 4 (the only consumer) doesn't exist yet — revisit if/when it's built.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-per-client-configuration.md`
  summary: `client.config`'s `enabledModules.projectAdmin` only affects what `GET /api/permissions` displays — nothing in `authorize.ts`, `login()`, or user creation actually consults it, so a manually-seeded `project_admin` user can log in and act regardless of the config value.
  evidence: this is a pre-existing gap since Story 1.5 first introduced `project_admin` as a valid-but-ungated role value; Story 1.8's Approach explicitly scoped itself to the Permissions view and `layout.tsx` only. Revisit once a story actually needs to enforce this role's availability (e.g. a user-creation/role-assignment endpoint, or `authorize()` gaining a project_admin-scoped action).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-create-and-edit-a-project.md`
  summary: Generated migration `packages/db/drizzle/0003_nifty_caretaker.sql` (adds the `projects` table) had not been applied to any live database at implementation time; since resolved for local dev.
  evidence: no Postgres instance was reachable (docker/colima not running) during implementation — same constraint noted for Story 1.7's migration. Applied and verified locally during step-03 review (colima + `docker compose up`, `db:migrate` + `db:seed`, full flow exercised against real Postgres — see spec-2-1's Implementation Notes). Still needs `pnpm --filter @niveshbook/db db:migrate` run against staging/production before this ships to any environment with real data.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-create-and-edit-a-project.md`
  summary: `GET`/`POST`/`PATCH /api/projects[/[id]]` are Owner/Admin-only for every role, including `GET` (list/view) — a Partner or Sub-partner gets 403 on the Projects screen entirely, even though `EXPERIENCE.md`'s IA table lists Projects as "Everyone (scoped)".
  evidence: `packages/core/src/authorize.ts`'s `PERMISSIONS` map grants all three `projects:*` actions to `owner_admin` only, per spec-2-1's Decisions ("no Project-shaped `ResourceRef` yet"). This is by design for this story — Partner/Sub-partner project-scoped visibility is Story 2.4+'s job once Partner Share records exist to scope against. `apps/web/lib/session-guard.ts`'s `requireOwnerAdminSession()` now gates the entire `(dashboard)` route group to `owner_admin` (redirecting any other authenticated role to `/`), so the sidebar's "Projects" nav item no longer renders for a role that can't use it — that stopgap holds until Story 2.4+ builds real per-role scoping and the shell can open back up to "everyone (scoped)" per `EXPERIENCE.md`'s IA table.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-create-and-edit-a-project.md`
  summary: No audit trail (who/when) for Project creation/edits via `POST`/`PATCH /api/projects`.
  evidence: same pre-existing pattern as Story 1.6/1.7's audit-trail gaps — no story has built audit logging yet; `epics.md`'s nav list names a future "Audit History" area as a separate, later concern.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-add-edit-partner-shares-with-100-validation.md`
  summary: No way to remove a mistakenly-added Partner Share — Owner/Admin can only overwrite via edit (which still versions it, per AD-3), never retract an accidental add.
  evidence: not required by epics.md's Story 2.2 AC, which only covers add/edit. Found during step-04 review (blind-hunter); flagged as a real gap since a fat-fingered add currently has no undo path. Implementing removal is a new feature, not a small patch — needs a design decision (soft-delete flag vs. a zero-percent "retracted" version vs. something else) that should weigh against AD-3's versioning philosophy before being built.

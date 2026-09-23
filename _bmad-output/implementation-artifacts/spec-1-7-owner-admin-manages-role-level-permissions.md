---
title: 'Owner/Admin Manages Role-Level Permissions'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
baseline_commit: 'aca0c31020bc3593d5213f9860ef2418f6051b3d'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR45 requires a Permissions area showing which roles are in use and who holds Owner/Admin-level approval authority (e.g. Extra Withdrawal, FR25) — none exists yet. Authority must be a distinct, revocable grant, not just "is this user `owner_admin`": FR45 names it separately from role membership, and its AC tests *revoking* a grant, not holding a role.

**Approach:** Add `users.canApproveExtraWithdrawal` (boolean), plus `GET /api/permissions` (roles in use + every Owner/Admin's grant status) and `PATCH /api/permissions/[userId]` (toggle one Owner/Admin's grant), gated by new `permissions:view`/`permissions:manage` actions (Owner/Admin-only, no self-access override, matching Story 1.6's `users:update-status`). "Roles enabled" is computed read-only from actual usage (`project_admin` is "in use" iff an active user holds it) — Story 1.8's later per-client toggle is separate and not depended on here.

## Boundaries & Constraints

**Always:** `canApproveExtraWithdrawal` only means something for `owner_admin`; setting it on another role is a caller error (400). Both actions re-read live data (AD-1) — never cached; a change is visible on the very next `GET`. Defaults to `true` for every existing/seeded `owner_admin` (decided 2026-09-23) — matches current de-facto full authority; nothing changes in practice until Epic 4 enforces it.

**Never:** No enforcement of the grant anywhere yet — Epic 4's Extra Withdrawal flow is its first consumer and doesn't exist yet. No per-client role enable/disable (Story 1.8's job; this view is read-only). No Partner/Sub-partner visibility grants (Epic 2, per epics.md's own note).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Admin views Permissions | `owner_admin` | 200, `{ enabledRoles: { project_admin }, approvers: [{id,email,canApproveExtraWithdrawal}, ...] }` for every `owner_admin` user | N/A |
| Grant reflects live role usage | At least one active `project_admin` user exists | `enabledRoles.project_admin: true`; `false` when none do | N/A |
| Owner/Admin grants approval authority | Target is `owner_admin`, body `{ canApproveExtraWithdrawal: true }` | 200, updated grant; visible on next `GET` | N/A |
| Owner/Admin revokes approval authority | Target is `owner_admin`, currently granted, body `{ canApproveExtraWithdrawal: false }` | 200; revoked immediately, next `GET` reflects it | N/A |
| Target isn't an Owner/Admin | Target role is `partner`/`sub_partner`/`project_admin` | 400, no change made | N/A |
| Non-Owner/Admin reaches either endpoint | `partner`/`sub_partner`/`project_admin` | 403 | N/A |
| Unauthenticated | No/expired session | 401 | N/A |
| Unknown target id | `owner_admin`, unknown id | 404 | N/A |
| Malformed body | `canApproveExtraWithdrawal` missing/non-boolean, or invalid JSON | 400 | N/A |

</frozen-after-approval>

## Code Map

- `packages/types` -- add `canApproveExtraWithdrawal: boolean` to `User`
- `packages/db/src/schema.ts` -- add `can_approve_extra_withdrawal` column, `notNull().default(true)`; `drizzle-kit generate` for the migration
- `packages/core/src/authorize.ts` -- add `"permissions:view"`, `"permissions:manage"` (owner_admin only, not in `SELF_ACCESS_ACTIONS`)
- `packages/core/src/user-port.ts` -- add `setApprovalAuthority(id, granted): Promise<User | null>` (`null` if unknown id)
- `packages/core/src/permissions.ts` -- NEW: `getPermissionsOverview(deps)` (computes `enabledRoles.project_admin` from `listAllUsers()`, filters `owner_admin`s into `approvers`); `setApprovalAuthority(userId, granted, deps)` (rejects a non-`owner_admin` target, `null` on unknown id)
- `packages/db/src/ports.ts` -- implement `setApprovalAuthority` (Drizzle `UPDATE ... RETURNING`)
- `apps/web/app/api/permissions/route.ts` -- NEW `GET`, `authorizeScope(callerId, "permissions:view", ...)`
- `apps/web/app/api/permissions/[userId]/route.ts` -- NEW `PATCH`, `authorize(callerId, "permissions:manage", { ownerId: userId }, ...)`, reuses the 400/UUID/404 pattern from `apps/web/app/api/users/[id]/route.ts`
- `apps/web/lib/users.ts` -- reuse `UNAUTHENTICATED_MESSAGE`/`FORBIDDEN_MESSAGE`

## Tasks & Acceptance

**Execution:**
- [x] `packages/types`, `packages/db/src/schema.ts` -- add column + migration
- [x] `packages/core/src/authorize.ts` -- add both actions to `PERMISSIONS`
- [x] `packages/core/src/user-port.ts`, `packages/db/src/ports.ts` -- add/implement `setApprovalAuthority`
- [x] `packages/core/src/permissions.ts` -- add `getPermissionsOverview`/`setApprovalAuthority` domain functions
- [x] `apps/web/app/api/permissions/route.ts` -- add `GET`
- [x] `apps/web/app/api/permissions/[userId]/route.ts` -- add `PATCH`
- [x] Vitest tests: `permissions.ts` domain functions (live role-usage computation, non-owner_admin-target rejection, unknown-id); both routes covering every I/O Matrix row

**Acceptance Criteria:**
- Given `enabledRoles.project_admin` was `true`, when the last `project_admin` user is later deactivated, then the next `GET /api/permissions` reflects `false` — this view never caches role-usage state.

## Implementation Notes

All tasks complete. `setApprovalAuthority(userId, granted, deps)` in `packages/core/src/permissions.ts` resolves to `null` on an unknown target id, and throws `InvalidApprovalAuthorityTargetError` (a plain `Error` subclass) when the target exists but isn't `owner_admin` — the `PATCH /api/permissions/[userId]` route catches that specific error type and surfaces it as 400, making no change. `GET /api/permissions` returns `{ enabledRoles: { project_admin }, approvers: [{id,email,canApproveExtraWithdrawal}] }` exactly per the I/O Matrix; `PATCH` returns the updated approver as `{id,email,canApproveExtraWithdrawal}` (not the full sanitized user shape, since `canApproveExtraWithdrawal` isn't part of `apps/web/lib/users.ts`'s `sanitizeUser`).

`packages/types`, `packages/core`, and `packages/db` are consumed by `apps/web` via built `dist/` output, so `@niveshbook/types` and `@niveshbook/core` had to be rebuilt (`pnpm --filter @niveshbook/types build`, `pnpm --filter @niveshbook/core build`) after adding the `canApproveExtraWithdrawal` field/actions, before `packages/db`'s and `apps/web`'s typecheck could see them — same build-order note Story 1.6 left behind.

Extending `User` with a new required field required touching every existing test file that builds a full `User`/`UserPort` literal, even though none of them are new to this story: `packages/core/src/auth.test.ts` (fake `UserPort` + 3 seed users), `packages/core/src/authorize.test.ts` (`makeUser` default + fake `UserPort`), `apps/web/app/api/auth/login/route.test.ts`, and `apps/web/app/api/users/[id]/route.test.ts` (three `User`-typed fixtures) all needed `canApproveExtraWithdrawal` added to stay type-correct; none of their actual assertions changed. `apps/web/app/api/users/route.test.ts` and the `vi.mock` factories in `apps/web/app/api/auth/login/route.test.ts` were untouched since their mocked return values aren't statically checked against the real `User`/`UserPort` types.

Full verification run 2026-09-23:
- `pnpm --filter @niveshbook/core test` -- 59 passed, including 12 new `permissions.test.ts` cases (live role-usage computation/re-read, approver listing/re-read, grant/revoke, unknown-id, non-owner_admin-target rejection)
- `pnpm --filter web test` -- 74 passed, including 8 new `GET /api/permissions` cases and 13 new `PATCH /api/permissions/[userId]` cases covering every I/O Matrix row
- `pnpm --filter @niveshbook/db test` -- 4 passed (unchanged; no new DB-level tests were in scope beyond the `ports.ts` implementation itself)
- `pnpm typecheck` -- clean across all 6 packages
- `pnpm build` -- clean; `next build`'s route list now includes `/api/permissions` and `/api/permissions/[userId]`
- `pnpm lint:boundaries` -- clean, no dependency violations
- `pnpm lint` -- clean; only pre-existing warnings (unrelated `no-console` disable-directive warnings in `packages/db`, and two pre-existing `security/detect-object-injection` warnings on `PERMISSIONS[action]` in `authorize.ts` that already existed before this story's two new actions were added to that same map)

Drizzle migration `packages/db/drizzle/0002_misty_warpath.sql` was generated via `drizzle-kit generate` (not hand-written): `ALTER TABLE "users" ADD COLUMN "can_approve_extra_withdrawal" boolean DEFAULT true NOT NULL;` — matches the spec's `notNull().default(true)` requirement, so every existing row backfills to `true` in the same statement. Migration was generated and reviewed but not applied against a live database in this session (no local Postgres was started); `pnpm --filter @niveshbook/db db:migrate` still needs to run against a real environment before this ships.

## Spec Change Log

## Review Triage Log

Reviewed 2026-09-23 (blind-hunter, edge-case-hunter, verification-gap).

**patch** (auto-fixed):
- `getPermissionsOverview`'s `approvers` list filters `enabledRoles.project_admin` by `active` but not the `approvers` array itself — a deactivated `owner_admin` with a stale `canApproveExtraWithdrawal: true` still appears as a current approver, contradicting the feature's "live, never-cached" framing — `low`, real: filter `approvers` by `active` too. [packages/core/src/permissions.ts] — fixed: `approvers` now filters on `role === "owner_admin" && active`
- The `UUID_PATTERN` regex is now duplicated verbatim in a third route file (`sessions/[id]`, `users/[id]`, and this story's `permissions/[userId]`) — `low`, real, same class of finding already fixed once in Story 1.5 for `sanitizeUser`: extract to a shared constant. [apps/web/app/api/permissions/[userId]/route.ts and the two prior route files] — fixed: extracted to `apps/web/lib/ids.ts`, all three routes import it

**defer:**
- No audit trail (who/when) for granting/revoking Extra Withdrawal approval authority — a financially-sensitive permission. Same pre-existing pattern already deferred for Story 1.6's user deactivation; no story has built audit logging yet.
- Generated migration `packages/db/drizzle/0002_misty_warpath.sql` has not been applied to a live database — no project Postgres instance (docker/colima) is reachable in this environment to apply it now. Needs `pnpm --filter @niveshbook/db db:migrate` before this ships to any environment with real data.
- `packages/db/src/ports.ts`'s new `setApprovalAuthority` Drizzle implementation has no test coverage against a real database — every test mocks `@niveshbook/db` or uses an in-memory fake. Same pre-existing, already-tracked gap covering every `UserPort`/`SessionPort` method; closing it needs a file-wide DB-integration test-infra decision, not a per-method patch.
- No guard against revoking the last remaining approver or an Owner/Admin revoking their own grant, leaving zero users able to approve Extra Withdrawal. Re-confirmed with the human during this review (consistent with Story 1.6's identical self-lockout precedent): accepted as-is — no functional consequence today since Epic 4 (the only consumer) doesn't exist yet.

**Rejected:**
- `false` — `PATCH /api/permissions/[userId]` validates the request body (400) before calling `authorize()` (403), so an unauthorized caller with a malformed body sees 400 instead of 403. Same reasoning as Story 1.6's identical, already-rejected finding: no information leak (400 vs 403 reveals nothing about permission/existence), and the I/O Matrix never specifies a precedence between those rows.
- `false` — `setApprovalAuthority`'s DB write has no role guard in its own SQL (only an earlier, separate domain-layer read), a claimed TOCTOU gap if the target's role changed between the check and the write. Unreachable in this system: no endpoint anywhere lets any caller change a user's `role` after creation (only `active` and now `canApproveExtraWithdrawal` are mutable), so the race this finding describes cannot currently occur.
- `false`, rejected — `can_approve_extra_withdrawal` defaults to `true` at the schema level for every role, not just `owner_admin`. Inert today: `getPermissionsOverview` only ever surfaces the field for `owner_admin` rows, and the only write path (`setApprovalAuthority`) already rejects non-`owner_admin` targets. A schema-level constraint to prevent this would add real complexity (a cross-column `CHECK`, or per-role insert defaults) for a value nothing currently reads on those rows.
- `low`, rejected — Generated migration/snapshot files (`0002_misty_warpath.sql`, `0002_snapshot.json`) are missing a trailing newline, inconsistent with the rest of the diff. Cosmetic, drizzle-kit-generated, and hand-editing them risks a spurious diff on the next `drizzle-kit generate`.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` -- expected: all `permissions.ts`/`authorize.ts` cases pass
- `pnpm --filter web test` -- expected: new `/api/permissions` route tests pass
- `pnpm typecheck` && `pnpm build` && `pnpm lint:boundaries` -- expected: clean

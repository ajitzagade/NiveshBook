---
title: 'Roles & the Server-Side Authorization Gate'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
baseline_commit: '6bef2172ab53c2c1fea78e73f0c2684e6103a6fc'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing in the codebase yet checks a user's *role* before allowing an action — Stories 1.1/1.4's routes are only self-scoped ("manage my own session"), never role-gated. There's no canonical authorization gate for the role-based access every later epic depends on (AD-1).

**Approach:** Build `packages/core`'s `authorize()` (single-resource) and `authorizeScope()` (list/scope) gate functions, and prove both against a real protected action: an Owner/Admin-only user directory (list + single-user view). This story's original scope note (epics.md) proved the gate via Story 1.6's activate/deactivate endpoint — since that story hasn't been built yet, this spec proves the gate against a user-directory read instead, which needs no other unbuilt story and still exercises both gate forms honestly. Role *assignment* (FR6) is already satisfied by existing infrastructure (the `users.role` NOT NULL column, the `UserRole` type, the seed script) — this story adds a test confirming that, not new role-editing UI (that belongs to whichever story first needs to create/edit users, e.g. 1.6/1.7).

## Boundaries & Constraints

**Always:** `authorize()`/`authorizeScope()` always re-read the actor's *current* role from the `users` table via a port call — never from the session row (AD-1: no role/grant cached on `sessions`). Every new protected route in this story calls one of these before touching data. A denied check returns HTTP 403 with no data body beyond a generic error, indistinguishable from a resource that doesn't exist.

**Never:** No retrofit of Story 1.1/1.4's session routes (list/revoke) — those are self-scoped ("manage my own session"), not role-gated, so they don't need `authorize()`. No user-creation or role-editing endpoint — out of scope until a story actually needs one. No Project Admin config-gating (per-client enable/disable) — that's Story 1.8's job; this story only needs `project_admin` to exist as a valid role value, not be config-toggleable yet.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Admin lists all users | Authenticated as `owner_admin` | 200, array of `{id, email, role, active, createdAt}` for every user — never `passwordHash` | N/A |
| Non-Owner/Admin lists users | Authenticated as `partner`/`sub_partner`/`project_admin` | 403, generic error, no data body | N/A |
| Unauthenticated list | No/expired session | 401, generic error | N/A |
| Owner/Admin views any single user | Authenticated as `owner_admin`, any target user id | 200, that user's sanitized profile | N/A |
| User views their own profile | Authenticated as any role, target id === own id | 200, own sanitized profile (self-access always allowed regardless of role) | N/A |
| Non-Owner/Admin views someone else's profile | Authenticated as `partner`, target id ≠ own id | 403, same shape as the list-denial case | N/A |
| View a nonexistent user id | Authenticated as `owner_admin`, unknown id | 404 | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/authorize.ts` -- NEW: `Role`/`Action` types, a small role→action permission table, `authorize(actorUserId, action, resourceRef, deps)` (single-resource, supports a `resourceRef.ownerId` self-access override), `authorizeScope(actorUserId, action, deps)` (list-level; returns `{ allowed: boolean }` — full scope-filtering logic arrives in Epic 2 once Project/Partner resources exist)
- `packages/core/src/user-port.ts` -- extend `UserPort` with `findUserById(id)` and `listAllUsers()` -- both DB-free at this layer (AD-9)
- `packages/db/src/ports.ts` -- implement `findUserById`/`listAllUsers` against the existing `users` table
- `apps/web/app/api/users/route.ts` -- NEW: `GET`, list endpoint using `authorizeScope()`
- `apps/web/app/api/users/[id]/route.ts` -- NEW: `GET`, single-resource endpoint using `authorize()` with self-access override
- `packages/core/src/user-port.ts`'s existing `findUserByEmail` stays as-is (login path unaffected)

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/authorize.ts` -- define `Role`, `Action` (`"users:list"`, `"users:view"`), permission table (`owner_admin` only for both actions), `authorize()` and `authorizeScope()`, both reading the actor's live role via `deps.users.findUserById`
- [x] `packages/core/src/user-port.ts` -- add `findUserById(id): Promise<User | null>`, `listAllUsers(): Promise<User[]>` to `UserPort`
- [x] `packages/db/src/ports.ts` -- implement both new methods against `users`
- [x] `packages/core/src/index.ts` -- export the new `authorize.ts` module
- [x] `apps/web/app/api/users/route.ts` -- resolve caller via existing session cookie helpers (401 if none), call `authorizeScope(callerId, "users:list", ...)` (403 if denied), else return sanitized user list (never `passwordHash`)
- [x] `apps/web/app/api/users/[id]/route.ts` -- resolve caller, call `authorize(callerId, "users:view", { ownerId: targetId }, ...)` — allowed if caller is `owner_admin` OR `callerId === targetId`; 403 if denied, 404 if the target id doesn't exist, else sanitized profile
- [x] Vitest tests for `authorize.ts`/`authorizeScope.ts` covering every I/O Matrix row, plus: role read is always live (a role change between two calls is reflected on the second call, not cached)
- [x] Vitest tests for both new Route Handlers, mocking `@niveshbook/db`, covering 401/403/404/200 per the matrix
- [x] A short test confirming FR6: the `users` table rejects a null/missing role (schema-level) and the seed script always assigns one

**Acceptance Criteria:**
- Given a user calls `GET /api/users` directly (bypassing any UI), when their role isn't `owner_admin`, then 403 with no data — no endpoint infers permission from anything the frontend would or wouldn't render.
- Given an `owner_admin`'s role is changed in the database mid-session, when they next call a gated endpoint, then the *new* role is enforced immediately — nothing about the decision was cached on the session.
- Given `GET /api/users/[id]` for a nonexistent id, when called by `owner_admin`, then 404 (not 403 — existence and permission are distinguishable to an authorized caller, only ever conflated toward an *unauthorized* one).

## Implementation Notes

All tasks complete. Full verification run 2026-09-23:
- `pnpm --filter @niveshbook/core test` -- 31 passed
- `pnpm --filter @niveshbook/db test` -- 4 passed
- `pnpm --filter web test` -- 36 passed
- `pnpm typecheck` -- clean across all 6 packages
- `pnpm build` -- clean, `/api/users` and `/api/users/[id]` both compiled as dynamic routes

`apps/web/app/api/users/[id]/route.ts` adds a UUID-format pre-check before hitting the DB on an authorized lookup — not in the original Code Map, but a natural extension of the 404 path since user ids are uuidv7.

Code review (2026-09-23) applied 5 patches: extracted `sanitizeUser()`/error messages to `apps/web/lib/users.ts`, made `authorize()`'s self-access check case-insensitive, added a malformed-id test, fixed a stale schema.ts comment, and synced this file's frontmatter status. Re-verified after patches: 32 core / 4 db / 37 web tests passed, typecheck and build clean.

## Spec Change Log

## Review Triage Log

### Review Findings (2026-09-23)

**Patch:**
- [x] [Review][Patch] `sanitizeUser()` and the `UNAUTHENTICATED_MESSAGE`/`FORBIDDEN_MESSAGE` constants are duplicated verbatim across both route files — a future field added to one sanitizer and not the other would silently diverge what each route redacts [apps/web/app/api/users/route.ts:7-19, apps/web/app/api/users/[id]/route.ts:7-30] — fixed: extracted to `apps/web/lib/users.ts`, imported by both routes
- [x] [Review][Patch] `authorize()`'s self-access check (`resourceRef.ownerId === actorUserId`) is a case-sensitive string comparison — a caller viewing their own profile via a differently-cased (but equal) UUID is wrongly denied with 403 instead of getting their own profile [packages/core/src/authorize.ts:59] — fixed: compares `.toLowerCase()` on both sides, regression test added
- [x] [Review][Patch] Spec frontmatter `status: 'in-progress'` was left stale after sprint-status.yaml moved this story to `review` [spec-1-5-roles-the-server-side-authorization-gate.md:5] — fixed: set to `review`
- [x] [Review][Patch] No test covers an authorized (`owner_admin`) caller requesting a malformed, non-UUID id on `GET /api/users/[id]` — only the well-formed-but-unknown-id 404 path is tested [apps/web/app/api/users/[id]/route.test.ts] — fixed: added test
- [x] [Review][Patch] `packages/db/src/schema.ts`'s comment ("`role` exists but is unused until Story 1.5's authorization gate") is now stale — this diff is Story 1.5, and `role` is used [packages/db/src/schema.ts:5-6] — fixed: comment updated

**Defer:**
- [x] [Review][Defer] `authorize()`/`authorizeScope()` never check `actor.active` — a deactivated user's still-live session would keep passing role checks [packages/core/src/authorize.ts] — deferred: pre-existing, not introduced by this diff (`getSession()` itself never re-checks `active` either, and no deactivation mechanism exists yet — Story 1.6). Already tracked in `deferred-work.md`.
- [x] [Review][Defer] `packages/db/src/ports.ts`'s new `findUserById`/`listAllUsers` have no test coverage against a real database — every consumer test mocks `@niveshbook/db` away [packages/db/src/ports.ts:43-52] — deferred: pre-existing repo-wide gap (no DB-integration test infra exists), consistent with how `findUserByEmail` and the Story 1.4 session-port methods were left untested. Already tracked in `deferred-work.md`.

**Rejected:**
- `false` — Moving the `UUID_PATTERN` format check before `authorize()` to save a DB round-trip: would make malformed ids 404 immediately regardless of caller permission, causing an unauthorized caller to see 404 for malformed ids but 403 for well-formed-but-nonexistent ones — a distinction the spec's AC3 explicitly forbids leaking to an unauthorized caller. Current ordering is required, not accidental.
- `false` — `authorize()`'s self-access override being unconditional on `action`: only one `ResourceRef`-taking action (`users:view`) exists today, so no reachable code path exercises the hypothetical future-action concern.
- `false` — `listAllUsers()` lacking pagination: the Code Map already documents this as a deliberate scope decision ("never sorted/filtered at this layer"); no current row-volume problem, not required by this story.
- `false` — `schema.test.ts` checking Drizzle's static `notNull`/`hasDefault` metadata rather than a live insert-rejection: the task text explicitly scopes FR6's test to "(schema-level)", and the repo has no DB-integration test infrastructure to do more.
- `false` — `authorizeScope()` returning `{ allowed: boolean }` instead of a filter (per `epic-1-context.md` AD-1): the spec's own Intent/Code-Map text explicitly defers full scope-filtering to Epic 2 once Project/Partner resources exist — a documented trade-off, not an oversight.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` -- expected: all `authorize.ts` cases pass
- `pnpm --filter @niveshbook/web test` -- expected: new route tests pass
- `pnpm typecheck` && `pnpm build` -- expected: clean across the workspace

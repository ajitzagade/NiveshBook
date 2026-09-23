---
title: 'Owner/Admin Activates or Deactivates a User'
type: 'feature'
created: '2026-09-23'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
baseline_commit: '6bef2172ab53c2c1fea78e73f0c2684e6103a6fc'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An Owner/Admin can view the user directory (Story 1.5) but has no way to revoke access — deactivation doesn't exist yet. This is also Story 1.5's designated proof of a real write-side, Owner/Admin-only action gated by `authorize()`.

**Approach:** Add `PATCH /api/users/[id]` accepting `{ active: boolean }`, gated by a new `users:update-status` action (Owner/Admin-only, **no self-access override**, unlike `users:view`). Deactivation also deletes the target's live sessions, so access ends on the very next request, not just the next login.

## Boundaries & Constraints

**Always:** Deactivating a user deletes all of that user's `sessions` rows immediately (reuses Story 1.4's session port). Reactivating only flips `active` back to `true` — no session is restored/recreated. `users:update-status` never self-overrides: an Owner/Admin acting on their own id still goes through the normal role check. An Owner/Admin may deactivate their own account like any other (decided 2026-09-23) — no last-Owner/Admin guard; a single careless self-deactivation locking out the deployment is an accepted risk, matching epics.md's ACs as written.

**Never:** No change to Story 1.5's `GET` routes. No cascading changes to other tables (none reference `users` yet). No email/notification side effects.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Admin deactivates a user | `owner_admin`, target `active: true`, body `{ active: false }` | 200, sanitized profile `active: false`; target's sessions all deleted | N/A |
| Owner/Admin reactivates a user | `owner_admin`, target `active: false`, body `{ active: true }` | 200, sanitized profile `active: true`; target can log in again | N/A |
| Sets the same status again | Target already at requested value | 200, unchanged profile; no session deletion (idempotent no-op) | N/A |
| Owner/Admin deactivates own account | Target id === caller id | 200; caller's own sessions deleted, including the one making this request | N/A |
| Non-Owner/Admin deactivates any user, incl. self | `partner`/`sub_partner`/`project_admin` | 403, no self-access override | N/A |
| Unauthenticated | No/expired session | 401 | N/A |
| Unknown target id | `owner_admin`, unknown id | 404 | N/A |
| Malformed body | `active` missing/non-boolean, or invalid JSON | 400 | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/authorize.ts` -- add `"users:update-status"` (owner_admin only); change the self-access short-circuit from unconditional to an explicit action allow-list (currently only `"users:view"`) so this new action doesn't inherit it
- `packages/core/src/user-port.ts` -- add `setUserActive(id, active): Promise<User | null>` (`null` if id unknown)
- `packages/core/src/session-port.ts` -- add `deleteAllSessionsForUser(userId): Promise<void>` (admin-scoped bulk delete; existing methods are caller-scoped only)
- `packages/core/src/auth.ts` -- add a domain function that calls `setUserActive`, then `deleteAllSessionsForUser` only on a true→false transition
- `packages/db/src/ports.ts` -- implement both new port methods against the existing `users`/`sessions` tables (no schema change)
- `apps/web/app/api/users/[id]/route.ts` -- add `PATCH` beside the existing `GET`: parse `{ active: boolean }` (400 on bad JSON/type, matching `apps/web/app/api/auth/login/route.ts`'s pattern), `authorize(callerId, "users:update-status", { ownerId: targetId }, deps)`, then the new domain function; reuse `sanitizeUser`/message constants from `apps/web/lib/users.ts` and the existing `UUID_PATTERN`/`NOT_FOUND_MESSAGE`

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/authorize.ts` -- add action + permission entry; scope self-access override to an allow-list
- [x] `packages/core/src/session-port.ts` -- add `deleteAllSessionsForUser`
- [x] `packages/core/src/user-port.ts` -- add `setUserActive`
- [x] `packages/core/src/auth.ts` -- add the status-update domain function with conditional session deletion
- [x] `packages/db/src/ports.ts` -- implement both new port methods
- [x] `apps/web/app/api/users/[id]/route.ts` -- add `PATCH` handler
- [x] Vitest tests: `authorize.ts` self-access allow-list (non-owner_admin targeting own id for `users:update-status` still denied); domain function (session deletion only on true→false)
- [x] Vitest tests for `PATCH` covering every I/O Matrix row

**Acceptance Criteria:**
- Given a user was deactivated while holding a live session, when they make their very next request, then it's unauthenticated — the session row is gone, not merely destined to expire.

## Implementation Notes

All tasks complete. Full verification run 2026-09-23:
- `pnpm --filter @niveshbook/core test` -- 47 passed (authorize.ts self-access allow-list cases + auth.ts `setUserActiveStatus` transition/idempotency/unknown-id cases)
- `pnpm --filter web test` -- 52 passed (new `PATCH /api/users/[id]` tests cover every I/O Matrix row)
- `pnpm typecheck` -- clean across all 6 packages
- `pnpm build` -- clean; `/api/users/[id]` still compiles as a single dynamic route now serving both `GET` and `PATCH`
- `pnpm lint:boundaries` -- clean, no dependency violations

`packages/core`/`packages/db` are consumed by `apps/web` via their built `dist/` output (not source), so after editing `authorize.ts`/`user-port.ts`/`session-port.ts`/`auth.ts`/`ports.ts` both packages had to be rebuilt (`pnpm --filter @niveshbook/core build`, `pnpm --filter @niveshbook/db build`) before the new web route tests could see the new `Action`/port methods — otherwise the stale `dist` caused a runtime `Cannot read properties of undefined (reading 'has')` in `authorize()` and `setUserActiveStatus is not a function`. Not a code defect, just a build-order note for whoever runs this next.

The self-access allow-list refactor in `authorize.ts` is additive/behavior-preserving for `users:view` (the only action previously covered by the unconditional self-access short-circuit) — all of Story 1.5's existing tests for it still pass unmodified.

## Spec Change Log

## Review Triage Log

Reviewed 2026-09-23 (blind-hunter, edge-case-hunter, verification-gap). verification-gap: no findings.

**patch** (auto-fixed):
- `SessionPort.deleteAllSessionsForUser(userId): Promise<void>` can't distinguish "deleted N" from "deleted 0" on a security-critical bulk-delete, unlike sibling `deleteSessionById` which returns a count — `low`, real: change return type to `Promise<number>`. [packages/core/src/session-port.ts, packages/db/src/ports.ts]
- `deferred-work.md`'s DB-port-coverage entry undercounts untested methods as 8, omitting Story 1.5's `findUserById`/`listAllUsers` (should be 10, and should list spec-1-5 in `source_spec`) — `low`, real doc-accuracy gap: fix the count and source list. [deferred-work.md]
- No test proves `PATCH /api/users/[id]` ignores extra/unexpected body fields (e.g. `{ active: true, role: "owner_admin" }`) — already safe by construction (only `body.active` is ever read), but untested — `low`, real: add one test. [apps/web/app/api/users/[id]/route.test.ts]

**defer:**
- No audit trail (who/when) for `PATCH /api/users/[id]` — a security-sensitive admin action. Pre-existing pattern: no story has built audit logging yet anywhere in the app (epics.md's nav list names a future "Audit History" area as a separate concern). Not this story's problem to solve.
- This diff bundles Story 1.5, Story 1.6, and unrelated dependency-cruiser/AGENTS.md tooling in one uncommitted working tree (an artifact of how this session's work landed, not of the code) — makes independent review/revert harder. Process note, not a code defect; recommend committing Story 1.5 separately before continuing.
- `setUserActive` and `deleteAllSessionsForUser` in `setUserActiveStatus` are two sequential, non-transactional writes, and `getSession()` still never re-checks `users.active` (pre-existing, tracked since Story 1.1). A login racing a deactivation PATCH could create a new session *after* the bulk-delete runs, which `getSession()` would still accept — `medium`, real, but the underlying gap (`getSession()` not checking `active`) is the same pre-existing tracked item this story narrows without fully closing; already disclosed in `deferred-work.md`'s Story 1.6 resolution note. Closing it fully needs either cross-port transactional writes (an AD-9 architecture question) or a live `active` check in `login()`/`getSession()` — both bigger than this story's scope.

**Rejected:**
- `false` — `PATCH` validates the request body (400) before calling `authorize()` (403), so an unauthorized caller with a malformed body sees 400 instead of 403. No information leak results (400 vs 403 reveals nothing about permission or existence, only that the caller's own request was malformed) and the I/O Matrix never specifies a precedence between those rows. Validating shape before checking permission is a defensible, common convention.
- `false` — `authorize()`'s self-access short-circuit (`users:view`) never confirms the actor still exists, unlike the non-self-access branch. Unreachable in this system: no story or endpoint ever deletes a `users` row (accounts are deactivated, never deleted, per this story's own Boundaries), so a "ghost actor" self-access request cannot currently occur; even hypothetically, the downstream target lookup would 404, not leak data.
- `false` — Route-local `NOT_FOUND_MESSAGE`/`INVALID_REQUEST_MESSAGE`/`INVALID_ACTIVE_MESSAGE` aren't centralized like Story 1.5's `UNAUTHENTICATED_MESSAGE`/`FORBIDDEN_MESSAGE`. Unlike that prior fix (which resolved verbatim duplication across two files), these three constants are each used in exactly one file — there's no duplication/drift risk to fix yet.
- `false` — `schema.test.ts`'s describe block doesn't signal that it checks Drizzle's static metadata rather than a live DB constraint. Already litigated and accepted in Story 1.5's review: the task wording's own "(schema-level)" qualifier licenses this, and the repo has no DB-integration test infrastructure to do more.
- `low`, rejected — Self-targeting a `PATCH` triggers two separate `findUserById(actorUserId)` reads (once in `authorize()`, once in `setUserActiveStatus`) with no caching. Real but negligible (single extra read on a low-frequency admin endpoint), and the fix requires restructuring cross-layer control flow to share the already-fetched actor between `authorize()` and the domain function — more than a direct correction.
- Not formally routed (fix is to edit this story's frozen spec, out of scope for this review) — the Boundaries text frames the accepted "no last-Owner/Admin guard" risk narrowly as "a single careless self-deactivation," but the actual exposure is broader: since `users:update-status` has no self-access override, any Owner/Admin can deactivate every *other* Owner/Admin down to zero via ordinary role-gated calls, not just their own account. The ALLOW decision itself stands (re-confirmed with the human during this review); flagged here for the record since the written rationale undersold the scope of the accepted risk.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` -- expected: all `authorize.ts`/`auth.ts` cases pass
- `pnpm --filter web test` -- expected: new `PATCH` route tests pass
- `pnpm typecheck` && `pnpm build` && `pnpm lint:boundaries` -- expected: clean

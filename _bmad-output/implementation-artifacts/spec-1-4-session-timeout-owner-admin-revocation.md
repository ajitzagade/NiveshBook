---
title: 'Session Timeout & Owner/Admin Revocation'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
baseline_commit: 'ef75ab858426c76cd562dbeadab544842c050262'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.1 shipped sessions with a fixed 30-minute expiry set once at login — a continuously-active user gets logged out mid-session, which contradicts "30 minutes of *inactivity*" (FR5). There's also no way for a user to see or revoke their own active sessions.

**Approach:** Make session expiry renew (slide forward) on every authenticated request, and add a self-service session list + revoke endpoint — the same primitive an Owner/Admin uses on themselves today, and that Story 1.6 will later extend to act on other users once user management exists.

## Boundaries & Constraints

**Always:** Every authenticated request that successfully resolves a session extends that session's `expiresAt` by another `SESSION_TTL_MS` (sliding window) — this is the only change to `getSession()`'s existing behavior. Revoking a session deletes its row immediately (AD-8) — the very next request using that token is rejected, no eventual consistency. All new routes go through the same `authorize()`-gated pattern as existing routes (must be authenticated; a user only lists/revokes their own sessions).

**Never:** No cross-user session management yet — "list/revoke another user's sessions" is out of scope until Story 1.6 gives Owner/Admin a real user directory to act on. No device/IP/user-agent tracking on sessions — not required by the story and adds fields nothing here uses. No change to login/logout behavior beyond what sliding renewal implies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Active use within TTL | Valid session, request made 10 min after login | Session resolves; `expiresAt` extends another 30 min from now | N/A |
| True inactivity | Valid session, no requests for 30+ min | Next request treated as unauthenticated (existing `getSession` expiry check, now driven by the renewed timestamp) | N/A |
| List own sessions | Authenticated request to list sessions | Returns only the caller's own session rows (id, createdAt, expiresAt) — never another user's | N/A |
| Revoke own session (not current) | Authenticated user revokes a session id belonging to them | 200, session row deleted; a request later made with that session's token is rejected | N/A |
| Revoke own current session | User revokes the session id they're actively using | 200, row deleted — behaves exactly like logout; the response's own cookie is now invalid | N/A |
| Revoke someone else's session id | Authenticated user submits a session id belonging to another user | 404 (not "403 with a hint it exists") — same not-found response whether the id belongs to someone else or doesn't exist at all | N/A |
| Unauthenticated list/revoke | No/expired session cookie on either endpoint | 401, generic error | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/session-port.ts` -- extend `SessionPort` with `touchSession(tokenHash, expiresAt)`, `listSessionsByUser(userId)`, `deleteSessionById(id, userId)` -- keeps core DB-free (AD-9)
- `packages/core/src/auth.ts` -- `getSession()` now calls `touchSession` to renew `expiresAt` on every successful resolution; add `listSessions(userId, deps)` and `revokeSession(sessionId, userId, deps)` (scoped to the owning user — deleting nothing if the id belongs to someone else, so it reads as a clean 404 upstream)
- `packages/db/src/ports.ts` -- implement `touchSession`/`listSessionsByUser`/`deleteSessionById` against the existing `sessions` table (no schema change — `userId`, `id`, `expiresAt`, `createdAt` already exist)
- `apps/web/app/api/auth/sessions/route.ts` -- NEW: `GET` lists the caller's own sessions
- `apps/web/app/api/auth/sessions/[id]/route.ts` -- NEW: `DELETE` revokes a session by id, scoped to the caller
- `apps/web/app/page.tsx` -- add a minimal "Active Sessions" list to the logged-in view (id/createdAt/expiresAt + a revoke button per row), reusing the existing logged-in-placeholder pattern from Story 1.1
- `apps/web/app/SessionList.tsx` -- NEW client component, mirrors `LogoutButton.tsx`'s fetch/error pattern

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/session-port.ts` -- add `touchSession`, `listSessionsByUser`, `deleteSessionById` to `SessionPort`
- [x] `packages/core/src/auth.ts` -- `getSession()` renews `expiresAt` via `touchSession` on every successful (non-expired) resolution; add `listSessions()` and `revokeSession()` domain functions
- [x] `packages/db/src/ports.ts` -- implement the three new port methods; `deleteSessionById` deletes only where `id` AND `userId` match, so a mismatched owner deletes zero rows rather than throwing
- [x] `apps/web/app/api/auth/sessions/route.ts` -- `GET`: resolve caller's session via existing cookie helpers, 401 if none, else return `listSessions()` for that user
- [x] `apps/web/app/api/auth/sessions/[id]/route.ts` -- `DELETE`: resolve caller, call `revokeSession(id, callerUserId, deps)`; if zero rows were deleted, return 404; else 200
- [x] `apps/web/app/SessionList.tsx`, `app/page.tsx` -- render the caller's sessions with a revoke button per row; revoking calls the new DELETE endpoint and refreshes
- [x] Vitest tests for `packages/core/src/auth.ts` covering every I/O Matrix row, plus a test proving `getSession()` actually extends `expiresAt` (not just that it returns non-null)
- [x] Vitest tests for the two new Route Handlers (`apps/web`), mocking `@niveshbook/db`, covering the list/revoke/cross-user-404/unauthenticated cases

**Acceptance Criteria:**
- Given an authenticated session used continuously (a request at least every 29 minutes), when checked after 45 minutes of that pattern, then the session is still valid — sliding renewal, not the original fixed 30-minute window from Story 1.1.
- Given an authenticated session with a genuine 30+ minute gap since its last request, when the next request is made, then it's treated as expired.
- Given a user with two active sessions, when they list sessions, then both appear with no other user's session present.
- Given a user revokes one of their own session ids, when a subsequent request replays that session's token, then it's rejected as unauthenticated.
- Given a user submits a session id that belongs to a different user (or doesn't exist), when they attempt to revoke it, then the response is 404 and no row is deleted anywhere.

## Implementation Notes

- Verified independently (diff read in full, tests/typecheck/build re-run by the orchestrating session, not just the implementer's self-report): `pnpm --filter @niveshbook/core test` → 18/18 pass; `pnpm --filter @niveshbook/web test` → 15/15 pass; `pnpm typecheck` and `pnpm build` clean across all 6 packages, with `/api/auth/sessions` and `/api/auth/sessions/[id]` both appearing in the Next.js route manifest.
- `deleteSessionById` returns a row count (0 or 1) rather than throwing/booleaning, so "belongs to another user" and "doesn't exist" are genuinely indistinguishable all the way up to the 404 response — matches the frozen matrix's explicit requirement.
- Revoking the currently-used session doesn't clear the request's own cookie (spec only required the row be deleted); the stale cookie simply fails to resolve on the next request. Acceptable per spec; noted here in case a future story wants an explicit self-logout-via-revoke UX polish.
- All 11 review-round patches verified independently (diff read in full; tests/typecheck/build re-run, not just the implementer's self-report): `pnpm --filter @niveshbook/core test` → 20/20; `pnpm --filter @niveshbook/web test` → 26/26; `pnpm typecheck`/`pnpm build` clean across all 6 packages.
- Renamed `apps/web/middleware.ts` → `apps/web/proxy.ts` (and its test) myself after verification — Next.js 16 build flagged `middleware.ts` as deprecated in favor of `proxy.ts`. Confirmed via web search this is a straight rename (file + exported function `middleware` → `proxy`), `proxy.ts` runs on Node.js by default so the explicit `runtime: "nodejs"` config could be dropped too. Re-verified after the rename: 26/26 web tests still pass, build is clean with no deprecation warning.

## Review Triage Log

- **[high → patch]** Sliding-window renewal only extends the server-side `sessions.expires_at` row; the session cookie's `Max-Age` is set once at login (fixed 30 min) and never refreshed. The browser stops sending the cookie 30 minutes after login regardless of activity — defeats the story's core premise ("a continuously-active user is never logged out mid-session"). Verified: `setSessionCookie` is called only from `login/route.ts`; nothing re-sets it on renewal.
- **[medium → patch]** `DELETE /api/auth/sessions/[id]` never validates the `id` route param is a well-formed UUID before it reaches the Drizzle query — a malformed id throws a DB-level cast error, surfacing as an unhandled 500 instead of the spec's 404. *(blind-hunter + edge-case-hunter, same claim)*
- **[medium → patch]** `listSessionsByUser` doesn't filter out expired rows — an already-expired-but-undeleted session displays in the "Active Sessions" UI as though still active, mismatching the section's own label. Verified at `packages/db/src/ports.ts`'s `listSessionsByUser`: no `expiresAt` condition in the query.
- **[medium → patch]** TOCTOU race in `getSession()`: if a session is revoked between the initial read (`findSessionByTokenHash`) and the renewal write (`touchSession`), the function still returns the stale, already-read session as valid instead of re-checking whether the write actually matched a row — violates the explicit "revocation is immediate, not eventual" guarantee under concurrency. Verified: `touchSession`'s return value is never checked.
- **[medium → patch]** `SessionList.tsx` has zero test coverage (render, revoke-success, revoke-failure) despite being the only new production UI in this diff — every other new module got a dedicated Vitest suite.
- **[low → patch]** `SessionList.tsx` shows a generic "Network error — please try again." for *any* non-ok DELETE response (401/404/500), not just a genuine network failure — misleading when, e.g., the session was already revoked elsewhere. Fix is trivial (read the response body's message, still refresh the list) — doesn't meet the reject-low bar.
- **[low → patch]** `SessionList.tsx` renders raw ISO-8601 timestamps to the user, conflicting with this diff's own "plain language" convention (`epic-1-context.md`). Trivial formatting fix.
- **[low → patch]** Nothing marks which listed session is the one currently authenticating the request — a user could accidentally revoke themselves without realizing it. Fix is cheap (the current session's id is already resolved server-side in `page.tsx`) and doesn't require the device/IP tracking the frozen Boundaries explicitly exclude.
- **[high, pre-verified → patch]** (verification-gap) `page.tsx`'s wiring of `listSessions()` into `<SessionList>` is untested — `page.test.tsx` only ever mocks zero sessions. A broken render or prop-mapping regression would ship undetected.
- **[medium → patch]** `packages/core/src/auth.test.ts`'s `revokeSession` tests never verify that revoking one of a user's *two* sessions leaves the other untouched — a regression broadening the delete scope (e.g. matching by `userId` alone) would ship undetected. *(edge-case-hunter, claim-check finding)*
- **[low → patch]** `sessions` table has no index on `user_id`, despite this story adding two query patterns (`listSessionsByUser`, `deleteSessionById`) that filter on it directly. Fix is a one-line schema addition + migration — cheap enough to include now rather than wait for scale to force it.
- **[medium, pre-verified → defer]** (verification-gap) The real Drizzle port implementations (`touchSession`, `listSessionsByUser`, `deleteSessionById`, plus the three pre-existing methods) run behind mocks in every test — `packages/db` still has no test suite of its own against a real database. Extends the identical Story 1.1 deferred item; now covers 6 methods instead of 3.
- **[low → reject]** Revoking the session currently authenticating the request does a redundant `touchSession` UPDATE immediately followed by a DELETE in the same request. Purely an internal efficiency question, not user-visible; the "fix" (special-casing the current-session id) adds complexity for negligible benefit.
- **[low → reject]** No explicit success-confirmation message after a revoke. The revoked row disappearing via `router.refresh()` already provides visible confirmation; an explicit toast is UI polish, not a defect worth blocking on.
- **[false]** `sprint-status.yaml` shows `in-progress` while the spec frontmatter says `in-review` — refuted: sync to `review` happens at step-05 per the workflow's documented convention, same as Story 1.1; expected in-flight state, not a defect.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` -- expected: all `auth.ts` cases pass, including the renewal test
- `pnpm --filter @niveshbook/web test` -- expected: new route tests pass
- `pnpm typecheck` && `pnpm build` -- expected: clean across the workspace

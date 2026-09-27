---
title: 'Users Screen: Owner/Admin Password Reset and Activate/Deactivate Actions'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
baseline_commit: '536f1757e47fd372f4f607b2de0484dadf26e24e'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Users screen (just shipped) only lists accounts and creates new ones. An Owner/Admin can't reset a forgotten/compromised password without direct DB access, and the existing activate/deactivate capability (`PATCH /api/users/[id]`, built in Story 1.6, session-invalidating) has no UI anywhere to actually use it.

**Approach:** Add a "Reset Password" and an "Activate"/"Deactivate" action to each row on the Users screen. Deactivate/Activate reuses the existing `PATCH /api/users/[id]` endpoint unchanged — pure UI wiring, no backend change. Password reset is new: a `resetUserPassword()` domain function (mirroring `createUser()`'s exact hashing/validation approach) behind a new `POST /api/users/[id]/reset-password` route, reusing the New User dialog's exact "type or Generate, shown once on success" UX, and reusing the already-built `deleteAllSessionsForUser` session-invalidation this app already applies on deactivation, so a reset password takes effect immediately (the old password/sessions stop working right away, not just on next natural expiry).

## Boundaries & Constraints

**Always:** `POST /api/users/[id]/reset-password` calls `authorizeScope()`/`authorize()` before touching data (AD-1), gated by a new `users:reset-password` action, owner_admin-only, no self-access override (mirrors `users:update-status`'s exact shape). New password hashed via `argon2.hash()` (identical to `createUser()`). Resetting a password deletes every existing session for that user (mirrors `setUserActiveStatus`'s true→false session-invalidation precedent) so the reset takes effect immediately. The new password is shown to the Owner/Admin exactly once, copyable, with the same "save this now" notice `createUser`'s success state already uses — never persisted/retrievable after. All existing tests stay green.

**Never:** No self-deactivation guard added to the API (matches this codebase's own existing, accepted precedent — Story 1.6/1.7 both already accept self-lockout as a known risk at the API layer); a lightweight UI-only safeguard (disabling your own row's Deactivate action) is in scope, a backend change is not. No new password-strength rules beyond the 8-128 length bound `createUser` already established. No email/SMS notification to the affected user — same manual-handoff model as account creation.

**Decisions:**
1. New route: `POST /api/users/[id]/reset-password` (not folded into the existing `PATCH`) — a distinct, separately-auditable-later action from activate/deactivate, mirroring this app's existing convention of dedicated sub-routes for distinct state-changing actions.
2. Deactivate/Activate: no new backend — wire the existing `PATCH /api/users/[id]` (`{ active: boolean }`) to a row action button. Disable that button (UI-only) on the row matching the caller's own `userId`, to avoid an easy accidental self-lockout — cheap insurance beyond, not instead of, the existing accepted-risk precedent.
3. Reset Password dialog mirrors the New User dialog's exact two-phase shape (form: type/Generate password → success: shown once, copyable, "won't be shown again").
4. `UserPort` gains one new method (`updatePassword`); `sessions.deleteAllSessionsForUser` is reused unchanged from Story 1.6.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path reset | valid 8-128 char password, caller is owner_admin, target exists | 200, password updated, all target's sessions deleted, shown once in UI | N/A |
| Reset for unknown user id | non-existent id | 404, no partial state change | N/A |
| Password out of bounds | <8 or >128 chars | rejected client- and server-side | clear inline message |
| Non-owner_admin caller | authenticated as partner/sub_partner | request never reaches data | 403, before any read/write (AD-1) |
| Activate/Deactivate own account | target id === caller's own userId | UI disables the action on that row; API itself still honors an existing precedent if called directly | N/A |
| Deactivate then reset | user already inactive | reset still works (an inactive user isn't deleted, just can't log in) — no special-case needed since `login()` already checks `active` | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/authorize.ts` -- `Action`/`PERMISSIONS` (as extended by spec-user-creation); add `"users:reset-password"`, owner_admin-only, mirrors `"users:update-status"` exactly
- `packages/core/src/user-port.ts` -- `UserPort` interface (extended by spec-user-creation with `createUser`); add `updatePassword(id: string, passwordHash: string): Promise<User | null>`
- `packages/db/src/ports.ts` -- `createUserPort()`; implement `updatePassword` following `setUserActive`'s exact update-by-id pattern
- `packages/core/src/auth.ts` -- `createUser()` (just added) is the pattern to mirror; `setUserActiveStatus()` (:159-179) is the pattern for session-invalidation-on-mutation; add `resetUserPassword(userId, newPassword, deps: Pick<AuthDeps, "users" | "sessions">)`: validates length (reuse the same 8/128 bounds), hashes via `argon2.hash()`, calls `deps.users.updatePassword()`, then `deps.sessions.deleteAllSessionsForUser(userId)`, returns the updated `User`
- `apps/web/app/api/users/[id]/route.ts` -- existing `PATCH` (activate/deactivate, unchanged) shows the single-owner_admin-only `authorize()` call shape; add `POST` for reset-password in a new `[id]/reset-password/route.ts` (or as a second handler if colocating fits this app's existing route-file conventions better -- check `apps/web/app/api/projects/[id]/investment-transactions/[transactionId]/cancel/route.ts` for the established "action sub-route" precedent)
- `apps/web/lib/users.ts` -- `createUserAccount()`/`generatePassword()` (just added) are the client-fetch/generation patterns to mirror for `resetUserPassword()`'s client wrapper; add `setUserActive()` client wrapper for the existing `PATCH` if one doesn't already exist under a different name
- `apps/web/app/(dashboard)/users/page.tsx` -- add an Actions column/slot to the Table row and `RowCard` (mirrors `ProjectActionButtons`' extraction precedent from `projects/page.tsx`): "Reset Password" opens a new Dialog mirroring the New User dialog's two-phase shape; "Deactivate"/"Activate" calls the existing endpoint, disabled on the caller's own row

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/authorize.ts` -- add `"users:reset-password"` (owner_admin-only) + tests
- [ ] `packages/core/src/user-port.ts` + `packages/db/src/ports.ts` -- add `updatePassword` to the interface and its DB implementation + live-Postgres test
- [ ] `packages/core/src/auth.ts` -- add `resetUserPassword()`: length validation, `argon2.hash()`, `updatePassword`, then `deleteAllSessionsForUser` + tests (incl. that a session created before reset is gone after, and login works with the new password but not the old one)
- [ ] `apps/web/app/api/users/[id]/reset-password/route.ts` (new) -- `POST`: `authorize`/`authorizeScope` for `"users:reset-password"` before any read (AD-1), validate body, 404 for unknown id, call `resetUserPassword`, return `sanitizeUser(updated)` + tests (401/403/404/400-short/400-long/200 happy path/AD-1 ordering)
- [ ] `apps/web/lib/users.ts` -- client wrappers: `resetUserPassword()` and (if missing) `setUserActive()`
- [ ] `apps/web/app/(dashboard)/users/page.tsx` + test -- Actions column (Table + RowCard mobile stack, matching this screen's existing dual-render convention): "Reset Password" (two-phase Dialog mirroring New User's), "Deactivate"/"Activate" toggle wired to the existing `PATCH`, disabled on the caller's own row
- [ ] Verification pass -- confirm a reset password actually invalidates the old session and the new password logs in, exercised via the real API against local Postgres (not mocked), mirroring spec-user-creation's own end-to-end discipline

**Acceptance Criteria:**
- Given an owner_admin session, when they reset another user's password, then that user's old sessions are gone and the new password (and only the new password) logs in successfully
- Given a non-owner_admin session, when they call the reset-password route, then they get 403 before any data is touched
- Given the Users screen, when an owner_admin views their own row, then the Deactivate action is disabled/absent
- Given the Users screen, when an owner_admin deactivates another user, then that user's active sessions end immediately (verifies the existing, unchanged `PATCH` behavior is now actually reachable from the UI)

## Implementation Notes

- 2026-09-27 review pass: 14 findings across 3 layers triaged (see Review Triage Log) — 7 patches applied and re-verified, most importantly a real bug where resetting your own password would log the acting admin out mid-flow with no warning (fixed: the success dialog now detects self-reset and redirects to `/login` via `router.push` on "Done", matching this app's existing navigation convention rather than a hard reload). Also fixed: a two-click confirmation before Deactivate, a race condition where toggling one row could clear another row's busy state, missing unmount guards, backdrop/Escape dismissal during an in-flight reset, consolidating the password-length bound onto the shared `packages/core` constants, and reordering the reset-password route's not-found check to match its sibling routes. 3 findings deferred, all matching this codebase's own existing, already-accepted precedent for the identical shape of issue elsewhere. 4 rejected with evidence. Full gate re-run green: lint (0 violations), typecheck, 76-file/1085-test suite, build.

## Spec Change Log

## Review Triage Log

2026-09-27 review pass 1 (blind-hunter BH, verification-gap VG, edge-case-hunter EC):
- BH+EC **resetting your OWN password immediately deletes your own current session with no warning** — the success dialog says "Password reset" while the admin is about to be logged out on their very next request. VG confirms this is spec-compliant (session deletion is intended), but the UI never handles the self-reset case distinctly — **high, two independent confirmations → patch**: detect `resetDialog.user.id === currentUserId` in the success phase, show a clear "you will be logged out" notice, and redirect to `/login` on "Done" in that case (keep Reset Password enabled for self — this is legitimate functionality, unlike accidental self-deactivation).
- BH no confirmation step before Deactivate (single click, immediate, tears down sessions) — **medium → patch**: add a lightweight two-click confirmation, mirroring the owner_admin-creation confirmation pattern already established on this same page.
- EC `togglingId` is a single string, not a set — clicking a second row's toggle while the first is still in flight steals the busy state, re-enabling the first row's button mid-request — **medium → patch**: track busy ids in a `Set`.
- EC `finally` clears `togglingId` before the fire-and-forget `refresh()` resolves, so the button re-enables showing stale `active` data before the list catches up — **low → patch**: fold into the same `handleToggleActive` fix as the Set change.
- EC no unmount guard on `handleToggleActive`/`performReset`'s own state sets (`togglingId`, `resetSubmitting`, `resetDialog`), unlike the existing `cancelledRef` pattern used elsewhere on this page — **low → patch**: apply the same guard.
- EC the Reset Password dialog can be dismissed via Escape/backdrop while `resetSubmitting` is true; the in-flight request later reopens it in "success" phase after the user thought they'd closed it — **low → patch**: ignore the close request while `resetSubmitting` (extends the existing `disabled={resetSubmitting}` intent already applied to the Cancel button).
- BH the 8-128 password-length bound is now hardcoded independently in `apps/web/app/api/users/route.ts` as well as the new `packages/core` constants — **low → patch**: update that route to import `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH` from `@niveshbook/core` instead of keeping its own local copy (the client-side `users/page.tsx` copy stays, for the same documented client-bundle reason `CREATABLE_USER_ROLES` already established).
- BH the new reset-password route checks `UUID_PATTERN.test(id)` after the JSON/password-type checks, unlike `GET`/`PATCH /api/users/[id]`'s convention of checking not-found immediately after `authorize()` — **low → patch**: reorder to match the sibling routes.
- BH no audit trail for either action — **low → defer**: matches this codebase's own established, already-accepted precedent (Story 1.6, 1.7, and the just-deferred user-creation gap) for identical actions.
- BH `PATCH /api/users/[id]` parses its body before calling `authorize()`, unlike the new reset-password route — **low → defer**: pre-existing gap in an endpoint this spec explicitly reuses unchanged (Decision #2 excludes backend changes to it); fixing it here would violate that boundary.
- EC `deleteAllSessionsForUser` throwing after `updatePassword` already succeeded would 500 despite the password having actually changed — **low → defer**: matches an already-accepted, already-tracked precedent for the identical two-sequential-writes-no-transaction shape in `setUserActiveStatus` (this function deliberately mirrors it).
- BH password field is `type="text"`, unmasked, no toggle — **reject**: deliberate, already-reviewed decision from the immediately preceding spec (the admin must read/copy it to share it).
- BH no complexity rule beyond length — **reject**: directly reverses an explicit, already-accepted Boundary from the preceding spec ("no complexity-rule messaging beyond the length minimum").
- EC self-deactivation guard leaves Deactivate enabled when `getCurrentUser()` fails, arguably contradicting the AC's literal wording — **reject**: the underlying self-lockout risk is already accepted at the API layer regardless of this UI safeguard's success; adding a failure-state warning banner is disproportionate to a rare same-origin-GET failure protecting an already-accepted risk (same reasoning as the identical finding in the user-creation review).
- BH+EC `authorize()` never re-checks `actor.active`; doc-comment wording nitpick in the spec's own Intent prose — **reject** (both): the first matches this codebase's already-documented `getSession()`/`active` architecture, not a new gap; the second is a cosmetic frozen-intent wording nitpick with no behavior impact and accurate code-level doc comments already in place.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: clean, all suites green
- `pnpm build` -- expected: clean
- Manual/scripted check -- reset a test account's password via the real API against local (or production, mirroring the prior spec's own end-to-end verification) Postgres, confirm the old password no longer logs in and the new one does

**Manual checks (if no CLI):**
- Founder-side: reset a test account's password on the live Users screen, confirm the copied password works

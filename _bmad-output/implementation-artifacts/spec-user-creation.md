---
title: 'User Creation: Owner/Admin Onboards Partner/Sub-partner Accounts In-App'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
baseline_commit: 'c04b90d978294b945d07f3218e78cfe6a6674ec6'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No in-app path exists to create a login account. `POST /api/users` doesn't exist (only `GET`/activate-deactivate `PATCH`); Partner Share's `linkedUserEmail` only links to an *already-existing* user and rejects an unknown email outright; the one user-creation script always hardcodes `role: "owner_admin"` and is a direct-DB action, not an app workflow. Every real partner/sub-partner account today was seeded by a developer, not created by the Owner/Admin who actually needs to onboard people.

**Approach:** Add `createUser` to `packages/core`'s auth domain (reusing the exact `argon2.hash()` approach `packages/db/src/seed.ts` already uses) and a `UserPort.createUser` method, gated by a new `users:create` action (owner_admin-only, mirroring `users:update-status`'s existing shape). Add `POST /api/users`. Build a new "Users" screen — the app's first — listing existing accounts with a "New User" dialog (email, role, password) so an Owner/Admin can onboard a partner or sub-partner themselves, then link them via the Partner Share dialog's existing `linkedUserEmail` field exactly as today.

## Boundaries & Constraints

**Always:** `POST /api/users` calls `authorizeScope()` before touching data (AD-1), mirroring `GET /api/users`'s existing pattern. Password hashed via `argon2.hash()` — never stored plain, never logged. Email uniqueness relies on the DB's existing `users.email` unique constraint (already present, no migration needed) as the race-safe backstop, with a friendly pre-check via `findUserByEmail` for the common case. The created password is shown to the Owner/Admin exactly once, in a copyable field, with an explicit "save this now" notice — never persisted or retrievable again after creation. All existing tests stay green.

**Never:** No password-reset or change-own-password flow — both remain deliberately deferred (Stories 1.2/1.3); this spec only adds account *creation*, a distinct capability. No email/SMS delivery — the Owner/Admin communicates the password out-of-band, matching how every account in this app has been handled so far. No `project_admin` in the creatable-role list — that role is valid-but-ungated everywhere else in the app (FR6, Story 1.8's job), so an account with it would be created into a dead end. No changes to the existing Partner Share `linkedUserEmail` flow itself — this spec only removes the reason it currently dead-ends.

**Decisions:**
1. Creatable roles: `owner_admin`, `partner`, `sub_partner` — not `project_admin` (see Never).
2. Password: the Owner/Admin either types one (min. 8 characters) or clicks "Generate" to fill a random 12-character password (browser `crypto.getRandomValues`, letters+digits+one symbol) into the same field — plain-text visible, with a "Copy" button. No complexity-rule messaging beyond the length minimum, to stay readable for a non-fluent-English admin.
3. New nav item "Users" (owner_admin-only, mirrors how other owner_admin-only routes are already gated) added to the fixed `NAV_ITEMS` list.
4. The Users page's own list reuses `GET /api/users` (already returns sanitized users, already exists) — no new list endpoint needed, only the new `POST`.
5. Out of scope for this spec: an inline "create user" escape hatch inside the Partner Share dialog itself. The Owner/Admin creates the account on the new Users page first, then links it via the existing Shares dialog `linkedUserEmail` field, same two-step flow as any other cross-screen reference in this app today.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | valid email, role, 8+ char password, caller is owner_admin | 201, new user created, password shown once in the success state | N/A |
| Duplicate email | email already in `users` table | rejected before or via the DB constraint | 400/409 "Email already in use." — never a 500 |
| Non-owner_admin caller | authenticated as partner/sub_partner | request never reaches data | 403, before any read/write (AD-1) |
| Unauthenticated | no session | 401 | generic message |
| Password too short | <8 characters | rejected client- and server-side | clear inline message, no request sent if caught client-side |
| project_admin role requested | role: "project_admin" in payload | rejected — not in the creatable set | 400 validation_error |
| Generated password | "Generate" clicked | field fills with a random 12-char string, visible, copyable | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/auth.ts` -- `login()` (:45) verifies via `argon2.verify(...)`; no existing hash-for-storage helper. New `createUser(email, password, role, deps)` goes here, calling `argon2.hash(password)` (same call shape as `packages/db/src/seed.ts:20`, no explicit cost params — matches the library defaults already baked into `DUMMY_PASSWORD_HASH`)
- `packages/core/src/user-port.ts` -- `UserPort` interface (`findUserByEmail`, `findUserById`, `listAllUsers`, `setUserActive`, `setApprovalAuthority`) -- add `createUser(input): Promise<User>`
- `packages/db/src/ports.ts` -- `createUserPort()` (:419-457) implements `UserPort`; add `createUser` following the `setUserActive`/`setApprovalAuthority` insert/update pattern; catch the `users.email` unique-constraint violation and translate to a typed error (mirror `AdjustmentNettingIdempotencyKeyConflictError`'s existing pattern for a DB unique-constraint race)
- `packages/db/src/schema.ts` -- `users` table (:22-33) -- `email: text("email").notNull().unique()` already present; no migration needed
- `packages/core/src/authorize.ts` -- `Action` union (:12-67), `PERMISSIONS` map (:75-367); add `"users:create"`, gate `new Set(["owner_admin"])` exactly like `"users:update-status"` (:78); never add to `SELF_ACCESS_ACTIONS`
- `apps/web/app/api/users/route.ts` -- `GET` already exists using `authorizeScope(session.userId, "users:list", ...)` (:20) -- add `POST` mirroring this shape (list has no single target resource, same as create)
- `apps/web/app/api/users/[id]/route.ts` -- `PATCH` (:63-127) shows the single-owner_admin-only `authorize()` call shape and `sanitizeUser()` usage to mirror in the new route's response
- `apps/web/lib/users.ts` -- `resolveLinkedUserId()` (:42-65) is the existing "no user found" path this spec removes the dead-end from; `sanitizeUser()` lives here too, reuse for the new route's response
- `apps/web/app/(dashboard)/layout.tsx` -- `NAV_ITEMS` (:64-172) -- fixed list, add a "Users" entry (owner_admin-only)
- New: `apps/web/app/(dashboard)/users/page.tsx` -- the list + "New User" dialog, following the established page pattern (loading/error/empty/loaded via `PageHeader`/`Card`/`EmptyState`/`Table`+`RowCard` mobile stack, `Dialog`/`Field`/`Input`/`Button` for the form) -- reuse `listAllUsers` via a `GET /api/users` client wrapper (check `apps/web/lib/users.ts` or add a thin client fetch helper alongside the existing pattern)

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/authorize.ts` -- add `"users:create"` to `Action` and `PERMISSIONS` (owner_admin-only) + tests
- [ ] `packages/core/src/user-port.ts` -- add `createUser` to `UserPort` interface
- [ ] `packages/core/src/auth.ts` -- add `createUser(email, password, role, deps)`: normalizes/lowercases email (matches login's convention), validates role is in the creatable set, hashes via `argon2.hash()`, calls `deps.users.createUser()`, returns the created `User` + test
- [ ] `packages/db/src/ports.ts` -- implement `createUser` on `createUserPort()`; catch the unique-constraint violation and throw a typed error (new `UserEmailAlreadyExistsError` or similar) + test against a live/fake DB matching this file's existing test conventions
- [ ] `packages/core/src/index.ts` -- export the new function/error type
- [ ] `apps/web/app/api/users/route.ts` -- `POST` handler: `authorizeScope("users:create")` before any read (AD-1), validate body (email format, password length ≥8, role in creatable set), call `createUser`, catch the duplicate-email error → 400, return `sanitizeUser(created)` with 201 + tests (401/403/400 duplicate/400 bad-role/400 short-password/201 happy path)
- [ ] `apps/web/lib/users.ts` (or a new thin client helper) -- `createUserAccount()` wrapper for the new POST route, following this file's existing conventions
- [ ] `apps/web/app/(dashboard)/layout.tsx` -- add the "Users" `NAV_ITEMS` entry, owner_admin-only + test
- [ ] `apps/web/app/(dashboard)/users/page.tsx` (new) + test -- list (Table + RowCard mobile stack, matching the established dual-render pattern) with a "New User" `Dialog`: email/role/password fields, a "Generate" button filling a random password, submit, and a post-create success state showing the password once with a copy affordance and an explicit "save this now" notice
- [ ] Verification pass -- confirm the new page renders correctly at ≥860px and <860px (this app's established responsive convention), and that a freshly created partner/sub-partner account can actually log in (exercised via the real API, not mocked)

**Acceptance Criteria:**
- Given an owner_admin session, when they create a user with a valid email/role/password, then the account exists and can log in with that exact password
- Given a non-owner_admin session, when they call `POST /api/users`, then they get 403 before any data is touched
- Given an email already in use, when creation is attempted, then it fails with a clear message, never a 500 or an unhandled DB error
- Given the Users page after a successful creation, when the Owner/Admin views the result, then the password is visible and copyable exactly once, with a clear notice it won't be shown again
- Given the new `POST /api/users` route, when reviewed against AD-1, then `authorizeScope()` runs before any `UserPort` read or write

## Implementation Notes

- 2026-09-27 review pass: 14 findings across 3 layers triaged (see Review Triage Log) — 9 patches applied and re-verified, including two real bugs: newly created accounts of any role silently inheriting `canApproveExtraWithdrawal: true` from the DB column default (confirmed via a live insert, bypassing FR45's explicit grant workflow — fixed by setting it `false` on every insert), and a post-create `refresh()` failure that could swallow the one-time password reveal entirely (fixed by decoupling the success state from the refresh call). Also added: an owner_admin-creation confirmation step, a max password length, autocomplete hardening, and a cross-package test guarding the creatable-role list against drift. 2 findings deferred (no audit trail for user creation; no CSRF token beyond sameSite cookies) — both match this codebase's own existing, already-accepted precedent for identical gaps elsewhere. 2 rejected with evidence. Full gate re-run green: lint (0 violations), typecheck, 74-file/1046-test suite, build.

## Spec Change Log

## Review Triage Log

2026-09-27 review pass 1 (blind-hunter BH, verification-gap VG, edge-case-hunter EC):
- BH+EC+VG **every newly created account (any role) silently gets `canApproveExtraWithdrawal: true` from the `users` table's DB column default** — the insert never sets this field, bypassing FR45's explicit grant/revoke workflow entirely. VG confirmed empirically via a live insert. The test fake in `auth.test.ts` encodes different (safer) behavior than the real port, masking the gap — **high, triple-confirmed with live verification → patch**: explicitly set `canApproveExtraWithdrawal: false` on every insert regardless of role; fix the fake to match; add a live-Postgres assertion.
- EC **a post-create `refresh()` (listUsers) failure is caught by the same handler as a create failure, so the one-time password reveal never shows even though the account WAS created** — **high, well-demonstrated, direct AC violation → patch**: decouple — show the success/password screen on `createUserAccount()` succeeding regardless of `refresh()`'s outcome.
- EC unmounted-component `setState` from `refresh()` if the page navigates away mid-request — **low → patch**: cancelled-flag guard, matching the mount-effect's own existing pattern.
- EC+VG the route's duplicate-email pre-check doesn't lowercase before calling `findUserByEmail`, unlike `createUser()`'s own normalization right after — VG confirmed the final response is byte-identical either way (caught by the race-safe backstop) so not user-observable, but the doc comment's "friendly pre-check for the common case" claim doesn't hold for a case-varied resubmission — **low → patch**: trivial one-line `.toLowerCase()` fix, removes the ambiguity VG flagged.
- BH+EC no maximum password length before `argon2.hash()` — a self-inflicted hashing-cost vector, Owner/Admin-only-gated but still worth a floor — **low → patch**: add a 128-char max, client+server.
- BH no audit-trail entry for user creation — **low → defer**: matches this codebase's own established, already-accepted precedent of deferring this exact gap for other admin actions (Story 1.6's deactivate-user, Story 1.7's permission grants — both already deferred identically).
- BH no distinct confirmation step before creating an `owner_admin` account (same one-click flow as Partner/Sub-partner) — **medium → patch**: add a lightweight second confirmation when `role === "owner_admin"`, mirroring the Extra Withdrawal authorization-step precedent already established in this app.
- BH no CSRF token/Origin check beyond the `sameSite: "lax"` cookie — **low → defer**: this is the identical trust model every mutation route in this app already uses; fixing it for one endpoint alone would be inconsistent and give false confidence. Recommend an app-wide CSRF hardening pass as its own initiative.
- BH password fields have no `autoComplete` attribute, inviting browser autofill contamination on a field intentionally kept `type="text"` — **low → patch**: add `autoComplete="off"` to the email/password inputs.
- BH no "must change password on first login" flow — **reject**: directly conflicts with this spec's own frozen Boundary that password-reset/change-own-password stay deferred; this spec is creation only.
- BH+VG `CREATABLE_USER_ROLES` duplicated across `packages/core`/`apps/web` with no drift test (the duplication itself is deliberate and documented — client-bundle constraint) — **low → patch**: add one test-only cross-package equality assertion.
- BH doc-comment inaccuracy: `createUser()` says email normalization mirrors `login()`'s own convention, but `login()` itself doesn't normalize — normalization happens one layer up in the login route — **low → patch**: fix the comment wording.
- BH modulo bias in `generatePassword()`'s `randomUint32 % poolSize` character selection — **low → reject**: cryptographically negligible for a copy-once suggested password, not a hard requirement anywhere else in this codebase; fix is disproportionate to the risk.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: clean, all suites green
- `pnpm build` -- expected: clean
- Manual/scripted check -- create a user via the real API against local Postgres, then log in as that exact account through `POST /api/auth/login` -- expected: 200, confirming the created password actually works end-to-end

**Manual checks (if no CLI):**
- Founder-side: create a test partner account via the new Users page, log out, log back in as that account

---
title: 'User Login and Logout (+ Foundation: retire demo scaffold, stand up packages/db)'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
baseline_commit: '40d3d99c9b91340b7b0e13ef554935d08ec3fd2c'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The monorepo currently runs demo personal-investment-portfolio scaffold code (wrong domain, float-based `Money`, a Fastify `apps/api` being retired) two Next.js majors behind current, with no real login system — nothing exists yet for a user to authenticate.

**Approach:** Retire the demo scaffold and `apps/api`, upgrade to Next.js 16 / React 19, stand up the `packages/core`/`db`/`types`/`ui` hexagonal skeleton per the architecture spine, and implement server-side login/logout (FR1) with Postgres-backed sessions (AD-8) as the first real, working feature proving the paradigm.

## Boundaries & Constraints

**Always:** Domain/session logic lives only in `packages/core` (zero DB/HTTP imports, AD-9); `packages/db` implements `packages/core`'s ports against Postgres via Drizzle; `apps/web` Route Handlers are the only HTTP boundary. Sessions are server-side, Postgres-backed, hashed opaque tokens, immediately revocable (AD-8). Login failure message is identical for wrong-email vs. wrong-password. Logout deletes the session row server-side, not just a client-side clear.

**Never:** No JWT/stateless tokens. No `apps/api`/Fastify — retired, not migrated. No demo Portfolio/Investment domain code left anywhere after this story. No role-based authorization yet (FR6–8, Story 1.5) — only a `role` column exists on `users`, unused here. No forgot/change-password (1.2/1.3) or session-timeout/revocation UI (1.4) yet.

**Database provisioning (decided):** dev/test runs against local Postgres via Docker Compose (a `docker-compose.yml` at the repo root, one `postgres:17` service) — chosen over wiring real Neon now because it keeps dev/test isolated from production data, doesn't burn Neon's free-tier compute-hours on local runs, and gives CI an ephemeral, disposable database. `DATABASE_URL` is the only thing that changes between local and Neon — same Postgres wire protocol, same Drizzle schema, no code branches (consistent with AD-7's config-not-code principle). Neon gets wired at actual deploy time.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid login | Correct email+password, active user | 200, session cookie set (httpOnly, secure, sameSite=lax), `sessions` row created | N/A |
| Wrong password | Correct email, wrong password | 401, "Incorrect email or password" | Identical to unknown-email case |
| Unknown email | Unregistered email | 401, "Incorrect email or password" | Identical to wrong-password case |
| Inactive user login | Correct creds, `users.active = false` | 401, distinct "This account is inactive" message | Never confused with the bad-credentials message |
| Logout | Valid session cookie | 200, session row deleted, cookie cleared | Replaying the old cookie no longer authenticates |
| No/garbage session cookie | Missing or malformed cookie on a session check | Treated as unauthenticated | N/A |

</frozen-after-approval>

## Code Map

- `docker-compose.yml` -- NEW, repo root: one `postgres:17` service for local dev/test, matching Neon's Postgres 17
- `apps/api/` -- DELETE entirely (Fastify demo; retired per architecture, not migrated)
- `apps/web/package.json` -- bump `next` 14.2.15→16.2.10, `react`/`react-dom` 18.3.1→19, `eslint-config-next`→16; add `drizzle-orm ^0.45.3`, a Postgres driver, `argon2` (password hashing), `@niveshbook/db` workspace dep
- `apps/web/app/page.tsx`, `app/layout.tsx` -- strip demo Portfolio rendering and copy; minimal login form + logged-in placeholder
- `apps/web/app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts` -- NEW Route Handlers, call `packages/core`
- `packages/core/src/portfolio.ts`, `src/index.ts` -- DELETE demo content; NEW `login()`/`logout()` domain functions + session/user ports (interfaces only, no DB import)
- `packages/types/src/index.ts` -- DELETE demo `Money`/`Investment`/`Portfolio`; NEW `User`, `Session` types
- `packages/db/` -- NEW package (mirror `core`'s `package.json` shape): Drizzle schema (`users`, `sessions`), Postgres client, port implementations, migration setup
- `packages/ui/src/PortfolioSummaryCard.tsx`, `src/index.tsx` -- DELETE demo component
- `packages/config/*` -- unchanged, reused as-is
- `pnpm-workspace.yaml`, `turbo.json` -- no change needed (`packages/*` glob already covers new `packages/db`); add a `db:migrate` root script

## Tasks & Acceptance

**Execution:**
- [x] `docker-compose.yml` -- add one `postgres:17` service with a fixed dev password and exposed port -- gives local dev/test a `DATABASE_URL` without touching Neon
- [x] `apps/api/` -- delete -- retired per AD-9/Structural Seed
- [x] `packages/types/src/index.ts` -- replace demo types with `User { id, email, passwordHash, role, active, createdAt }`, `Session { id, userId, tokenHash, expiresAt, createdAt }` -- shared contracts for auth
- [x] `packages/db/` -- create package (package.json, tsconfig extending `@niveshbook/config/tsconfig.node.json`, Drizzle schema for `users`/`sessions`, a Postgres client factory reading `DATABASE_URL`) -- the only package with a DB driver (AD-9)
- [x] `packages/core/src/session-port.ts`, `user-port.ts` -- define port interfaces (`findUserByEmail`, `createSession`, `deleteSession`, `findSessionByTokenHash`) -- keeps core DB-free
- [x] `packages/core/src/auth.ts` -- `login(email, password, deps)` (verifies password via argon2, checks `active`, creates session, returns opaque token) and `logout(tokenHash, deps)` (deletes session row) -- pure domain logic, deps-injected ports
- [x] `packages/core/src/portfolio.ts`, `index.ts` -- delete demo content; `index.ts` exports auth module instead
- [x] `apps/web/app/api/auth/login/route.ts` -- Route Handler: parse body, call `packages/core`'s `login()` wired to `packages/db`'s port implementation, set httpOnly session cookie on success
- [x] `apps/web/app/api/auth/logout/route.ts` -- Route Handler: read session cookie, call `logout()`, clear cookie
- [x] `apps/web/app/page.tsx`, `layout.tsx` -- replace demo portfolio UI with a minimal login form and a logged-in placeholder state; update metadata copy
- [x] `packages/ui/src/PortfolioSummaryCard.tsx`, `index.tsx` -- delete demo component
- [x] `apps/web/package.json`, root workspace -- dependency/version bumps per Code Map
- [x] Vitest config (root or per-package) + unit tests for `packages/core/src/auth.ts` covering every I/O Matrix row -- decimal-safety N/A here but the identical-error-message and inactive-user-distinct-message rules are exactly the kind of thing a test locks in

**Acceptance Criteria:**
- Given a registered active user with correct credentials, when they POST to the login endpoint, then a session row is created and a session cookie is set in the response.
- Given a wrong password or an unknown email, when login is attempted, then both return the identical 401 message — no way to distinguish which was wrong.
- Given an inactive user's correct credentials, when login is attempted, then a distinct 401 message states the account is inactive.
- Given an authenticated session, when logout is called, then the session row no longer exists and replaying the old cookie fails authentication.
- Given the repo after this story, when searched, then no file contains `Portfolio`/`Investment`/demo domain content, and `apps/api` no longer exists.
- Given `packages/core`, when its imports are inspected, then none reference a database driver, `apps/web`, or `packages/db` (AD-9).

## Implementation Notes

- Used the `postgres` npm driver (not `@neondatabase/serverless`) in `packages/db` — the frozen "Database provisioning" decision requires the same wire protocol against local Docker and Neon with zero code branches; the serverless/HTTP driver doesn't work against plain local Postgres. Revisit at deploy time if Neon's edge/serverless runtime characteristics end up mattering.
- `LoginForm.tsx`/`LogoutButton.tsx` (client components) weren't named in the Code Map but were required by Next's server/client component split for `app/page.tsx`.
- Docker Compose maps Postgres to host port 5433 (not 5432) — a native Postgres was already running on 5432 on the dev machine.
- Verified independently (diff read in full, tests and typecheck re-run by the orchestrating session, not just the implementing subagent's self-report): `pnpm --filter @niveshbook/core test` → 10/10 pass; `pnpm typecheck` → 5/5 packages clean; repo-wide grep for `Portfolio`/`Investment` → zero matches outside node_modules; `packages/core` import graph confirmed clean of DB/HTTP/app imports (AD-9).
- Known pre-existing gap, not introduced here: `packages/core`/`types`/`ui`/`db`'s `lint` scripts reference `@niveshbook/config/eslint.base.mjs`, which imports `@eslint/js`/`typescript-eslint` without either being declared as a dependency anywhere in the workspace — was already broken before this story.

## Review Triage Log

- **[medium → patch]** Timing side-channel undermines the identical-error-message guarantee: unknown email returns immediately (no argon2 call), known email always pays the ~50-100ms argon2.verify cost before the same 401 body — an attacker can enumerate valid emails via response latency despite identical text. *(blind-hunter + edge-case-hunter, same claim)* Verified at `packages/core/src/auth.ts` `login()`: the `if (!user) return {...}` branch returns before any `argon2.verify` call.
- **[medium → patch]** Email lookup/storage is case-sensitive with no normalization (`packages/db/src/ports.ts`, `packages/db/src/seed.ts`, login route) — "User@X.com" seeded vs. "user@x.com" typed fails to match despite being the same address. *(blind-hunter + edge-case-hunter, same claim)* Verified: no `.toLowerCase()`/`.trim()` anywhere on the email value before storage or lookup.
- **[medium → patch]** `apps/web/app/api/auth/login/route.ts` crashes uncaught if the parsed JSON body is non-object (e.g. literal `null`) — `body.email` throws before the `typeof body.email === "string"` guard runs. Verified: no `typeof body !== "object"` check precedes the property access.
- **[medium → patch]** Route handlers don't catch `login()`/`logout()` throwing (DB unreachable, connection failure) — an unhandled exception bypasses the project's own documented `{code,message}` error contract (Architecture Spine, Consistency Conventions). Verified: no try/catch wraps either call in `login/route.ts` or `logout/route.ts`.
- **[low → patch]** Session cookie hardcodes `secure: true` in `apps/web/lib/session.ts` with no environment branch — breaks silently over plain HTTP on a non-localhost dev/preview host (modern browsers exempt `localhost` itself, so this mostly affects LAN-IP/non-localhost testing). *(blind-hunter + edge-case-hunter, same claim)* Fix (`secure: process.env.NODE_ENV === "production"`) keeps production behavior identical while fixing dev friction — not a change to frozen intent, since the frozen matrix specifies the *production-relevant* property, not a literal always-true implementation.
- **[low → patch]** `LoginForm`/`LogoutButton`'s `fetch()` calls have no try/catch around the network call itself (only `!response.ok` is handled) — an offline/network failure resets the submitting state with no user-visible error. Verified at both files' `handleSubmit`/`handleLogout`.
- **[high, pre-verified → patch]** (verification-gap) Login route's Set-Cookie behavior — the story's own literal AC — has no test; `auth.test.ts` never touches the route or a response object. A dropped/wrong `setSessionCookie` call would ship undetected.
- **[high, pre-verified → patch]** (verification-gap) Logout route's cookie-reading path (`readSessionToken`) has no test; a broken cookie-name match would silently no-op logout with no test failing.
- **[medium, pre-verified → patch]** (verification-gap) Empty/missing-credential handling lives only in the route (bypasses `packages/core`), untested — a regression here would break the anti-enumeration guarantee silently.
- **[low → patch]** `page.tsx`'s session-conditional (`LoginForm` vs. logged-in view) has no test. Bundled into the same test-coverage patch as the three findings above (same root cause: `apps/web` layer has zero tests).
- **[low → patch]** README's `docker compose up -d` isn't followed by a wait for the healthcheck before `pnpm db:migrate` — first clone can hit an intermittent migration race. Trivial fix: `docker compose up -d --wait`.
- **[medium → defer]** Session TTL is an absolute 30-minute expiry set once at login, not renewed on activity — doesn't match "30 minutes of *inactivity*" literally. Root cause is explicitly out of scope here: this story's own frozen Boundaries exclude "session-timeout/revocation UI (1.4)," and sliding-window renewal is that story's job, not this one's.
- **[medium → defer]** A user deactivated after logging in keeps their authenticated session until natural expiry — `getSession` doesn't re-check `active`. Out of scope: Story 1.1 never builds a deactivate action (that's Story 1.6); flagging for 1.6/1.4 to ensure deactivation invalidates live sessions.
- **[medium → defer]** `packages/db/src/ports.ts` (the Drizzle adapter) has zero test coverage — real gap, but a proper fix (DB-integration test harness, e.g. testcontainers) is an infra decision exceeding "smallest fix," not settled by this spec.
- **[low → defer]** Expired session rows are never purged — unbounded growth at low urgency given current scale (PRD's own performance NFR: small-to-medium data volume). Needs a cleanup-job decision later.
- **[low → defer]** `users.role` has no DB-level enum/check constraint — trusted from the app-level `UserRole` union only. Worth tightening when Story 1.5 builds out full role enforcement.
- **[low → defer]** `_bmad-output/implementation-artifacts/epic-1-context.md` states AD-9's boundary is "lint-enforced via dependency-cruiser," but no such tooling exists in the repo yet — true by inspection only today. Recommend wiring dependency-cruiser during Story 1.5 (the authorization-gate story). Doc wording corrected directly (not a code patch).
- **[false]** `packages/db/tsconfig.json` "reused from Fastify's `apps/api`" — refuted: content is the pre-existing shared Node-package tsconfig pattern (`extends tsconfig.node.json`, CommonJS/Node resolution) already used identically by `packages/core` and `packages/types` before this story; nothing Fastify-specific in it.
- **[false]** `.env.example` duplicated at root and `apps/web/` — refuted: two different consumers (Next.js's app-level env loading vs. root-level Node scripts for `packages/db`) each need their own file per their own tooling's conventions; this is standard monorepo practice, not an oversight.
- **[false]** `sprint-status.yaml` says `in-progress` while the spec frontmatter says `in-review` — refuted: sprint-status syncs to `review` at step-05 per the workflow's own documented convention; this is an expected in-flight state, not a defect.
- **[false]** Frozen I/O Matrix "undercounts" edge cases (malformed JSON, empty fields) the route already handles — refuted: the matrix defines a floor of required behavior, not a ceiling; handling additional cases beyond it is not a defect.
- **[out of scope, no action]** No CI workflow exists to run these checks automatically — already explicitly deferred at the Architecture Spine level ("CI/CD pipeline... deferred to build setup"), not a new gap introduced by this story.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` -- expected: all `auth.ts` Vitest cases pass
- `pnpm typecheck` -- expected: no errors across the workspace after the Next.js/React upgrade
- `pnpm --filter @niveshbook/web dev` then manual POST to `/api/auth/login` and `/api/auth/logout` -- expected: matches the I/O Matrix

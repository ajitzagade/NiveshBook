# Epic 1 Context: Accounts, Access & Client Setup

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every person gets their own secure login, and the server-side authorization gate that everything else in the product relies on gets built and proven here — against a real, protected action (user activation/deactivation), not a stub. The Owner/Admin can manage who's allowed to approve sensitive actions at a role level, and a new client deployment can be configured (branding, currency, enabled roles) without any code change. This epic also retires the brownfield demo scaffold and upgrades the framework baseline before any product logic is written. Standalone outcome: a working, securely-gated shell with no financial data yet, but a real, independently-testable login/permissions system that Epic 2 onward extends rather than rebuilds.

## Stories

- Story 1.1: User Login and Logout
- Story 1.2: Forgot & Reset Password *(skipped for now — see Cross-Story Dependencies)*
- Story 1.3: Change Own Password
- Story 1.4: Session Timeout & Owner/Admin Revocation
- Story 1.5: Roles & the Server-Side Authorization Gate
- Story 1.6: Owner/Admin Activates or Deactivates a User
- Story 1.7: Owner/Admin Manages Role-Level Permissions
- Story 1.8: Per-Client Configuration

## Requirements & Constraints

- Users log in with credentials and log out; logout invalidates the session server-side (a replayed token must not still authenticate). Invalid-credential errors never reveal which field (email or password) was wrong.
- Deactivated users are rejected at login with a clear, specific message — their account record and transaction history are preserved, never deleted.
- Logged-in users can change their own password after confirming the current one; a wrong current password blocks the change with a clear error.
- Sessions expire after inactivity (30 min, assumed — flagged for confirmation) and an Owner/Admin can revoke a session directly; revocation takes effect on the very next request, not eventually.
- Four roles exist: Owner/Admin, Partner, Sub-partner, and an optional Project Admin (ships disabled by default, toggled per client via config — affects Stories 1.5, 1.6, 1.8). Exactly one role is assigned per user, stored server-side.
- Every protected action is checked server-side against the acting user's live role — never trusting the frontend or a session-cached permission snapshot. A user calling a disallowed endpoint directly (bypassing the UI) gets HTTP 403 with no data body beyond a generic error message.
- Owner/Admin has a dedicated Permissions area showing which roles are enabled for the deployment and who holds Owner/Admin-level approval authority (e.g. for Extra Withdrawal, enforced later in Epic 4); permission changes take effect on the next request, with no stale cached state.
- A fresh deployment's branding, currency/locale, and enabled modules come entirely from configuration resolved at boot — no file branches on a client identifier. Default currency/locale is INR with Indian digit grouping (₹10,00,000-style) unless overridden.
- All user-facing copy (including errors) uses plain language, no accounting/technical jargon; every screen that loads data or submits an action needs defined loading, error, and empty states; the interface should read as deliberately designed (light canvas, white cards, blue accent), not generic/templated.
- Fixed main navigation applies from this epic onward (Home, Projects, Partner Shares, Add Money, Withdraw Money, Available Balance, Adjust Next Time, Money History, Reports, plus Owner/Admin-only Users/Permissions/Audit History); a nav item must never render for an unauthorized role.
- Application must be responsive across desktop, tablet, and mobile from the start.

## Technical Decisions

- **Starting state, not a starter template:** this epic first retires the brownfield scaffold — removes `apps/api` (Fastify demo) entirely, strips demo Portfolio/Investment content from `packages/types`/`packages/core`/`packages/ui`, and upgrades Next.js 14.2.15→16.2.10 and React 18→19 — before any login logic is written.
- **Paradigm:** Hexagonal/Ports & Adapters. `packages/core` holds domain logic, the `authorize()`/`authorizeScope()` gate, and ports — zero DB/HTTP imports. `apps/web` (Next.js Route Handlers) is the driving adapter. `packages/db` (Drizzle) is the driven adapter implementing core's ports. Import direction is one-way (apps/web → core/db/ui/types; db → core/types; core → types only), enforced by a dependency-cruiser lint rule.
- **AD-1 (authorization gate):** single `authorize(actor, action, resourceRef)` for single-resource checks and `authorizeScope(actor, action, resourceType)` for list/report/export checks (returns a filter, not just a boolean), both defined once in `packages/core` and called by every `app/api/**` Route Handler before touching data. Always reads live permission/role data via the session port — never a snapshot cached on the `sessions` row. A failed check returns 403 with no body beyond a generic error.
- **AD-7 (client config):** one `client.config` object resolved from env vars at boot supplies branding, currency/locale, and enabled-modules; `packages/core` never imports or branches on a client identifier.
- **AD-8 (sessions):** Postgres-backed `sessions` table holding a hashed opaque token with an expiry; every request validates against this table through the session port; deleting the row ends the session immediately.
- **Data/format conventions:** DB tables/columns `snake_case`, TypeScript `camelCase`; domain identifiers mirror product vocabulary verbatim. IDs are UUID v7 on every table. Dates are ISO 8601 strings at every boundary. API errors are `{ code: string, message: string }` — never a raw stack trace to the client.
- **Tables created in this epic:** `users`, `sessions`.
- **Stack (pinned):** Next.js 16.2.10, React ^19, TypeScript ^5.6.3, Drizzle ORM ^0.45.3, @neondatabase/serverless ^1.1.0, PostgreSQL 17 (Neon), deployed on Vercel Hobby — single dedicated deployment per client, not shared multi-tenant.
- **Test framework:** Vitest, across `packages/core`, `packages/db`, and `apps/web`. Story 1.5 (the authorization gate) is called out as a story where Vitest coverage of the gate logic is particularly expected.

## UX & Interaction Patterns

- No formal DESIGN.md/EXPERIENCE.md exists yet; UX grounding is a founder-approved reference mockup — light grey-blue canvas, white cards, blue primary accent, colored status chips, a fixed sidebar nav with colored icon badges matching the NFR18 nav list.
- Login and permission-related errors must be specific and plain-language (e.g. "This account is inactive" rather than a generic failure), never silently ambiguous — except the login username/password case, which is deliberately identical either way to avoid revealing which field was wrong.
- Confirmation messages after any account/permission action (e.g. deactivating a user, revoking a session) must be explicit and in plain language.

## Cross-Story Dependencies

- No story in this epic depends on a later story or a later epic.
- Story 1.6 (activate/deactivate a user) is the concrete protected action that Story 1.5's authorization gate is proven against — 1.5 supplies the mechanism, 1.6 is its first real consumer.
- Story 1.7's Permissions area is extended later by Epic 2 Story 2.7 to add partner-specific sub-partner-visibility-grant data; this epic only needs to build the role-level view.
- Story 1.2 (Forgot & Reset Password) is skipped for this build pass by explicit user directive — no other story in this epic or Epic 2 depends on it, so its absence does not block anything else.
- Epic 2 extends this epic's `authorize()` gate to Project/Partner/Sub-partner-scoped resources rather than building a second authorization mechanism.

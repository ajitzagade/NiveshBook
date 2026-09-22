# Epic 1 Context: Accounts, Access & Client Setup

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every person gets their own secure login, and the server-side authorization gate that everything else in the product relies on gets built and proven here — against a real, protected action (user activation/deactivation), not a stub. The Owner/Admin can manage who's allowed to approve sensitive actions at a role level, and a new client deployment can be configured (branding, currency, enabled roles) without any code change. This epic also retires the brownfield demo scaffold and upgrades the framework stack, since no login logic can be written on top of it. Standalone outcome: a working, securely-gated shell with no financial data yet, but a real, independently-testable login/permissions system.

## Stories

- Story 1.1: User Login and Logout
- Story 1.2: Forgot & Reset Password
- Story 1.3: Change Own Password
- Story 1.4: Session Timeout & Owner/Admin Revocation
- Story 1.5: Roles & the Server-Side Authorization Gate
- Story 1.6: Owner/Admin Activates or Deactivates a User
- Story 1.7: Owner/Admin Manages Role-Level Permissions
- Story 1.8: Per-Client Configuration

## Requirements & Constraints

- Login/logout must invalidate sessions server-side; a failed login never reveals whether the email or the password was wrong.
- Password reset uses a time-limited (30 min, assumed), single-use link; the "does this email exist" response must be identical whether or not it matches, to prevent account enumeration. Setting a new password invalidates the link and ends all existing sessions for that user.
- Authenticated users can change their own password after confirming the current one.
- Deactivating a user blocks login but must never alter, hide, or unattribute their historical transactions.
- Sessions expire after 30 minutes of inactivity (assumed) and are immediately revocable by an Owner/Admin — revocation takes effect on the very next request, not eventually.
- Four roles exist: Owner/Admin, Partner, Sub-partner, and an optional Project Admin (ships disabled by default, toggled per client via configuration — not a hardcoded feature flag).
- Every protected action must be authorized server-side, including list/report/export endpoints — never inferred from what the frontend renders or from client-supplied data. Unauthorized access (role mismatch, tampered ID, direct API call) always returns HTTP 403 with no data body beyond a generic error — this must hold uniformly across single-resource, list, detail, export, and report code paths.
- A dedicated Permissions area lets Owner/Admin see and manage which roles are enabled for the deployment and which users hold Owner/Admin-level approval authority (e.g. for Extra Withdrawal, enforced later in Epic 4). Permission changes take effect on the next request — no cached/stale state.
- Per-client configuration (branding, currency, locale, enabled modules/roles) must be resolvable entirely from environment variables at boot, with zero client-specific branching in application code. Default currency/locale is INR with Indian digit grouping (₹10,00,000-style) unless overridden.
- All user-facing copy must use the product's plain-language Glossary terms verbatim — no accounting jargon, including in errors and tooltips.
- Every screen that loads data, submits an action, or shows a list needs defined loading, error, and empty states.
- No permission decision may ever be inferred from client-supplied data; every role/grant check is a server-side lookup against live data, never a cached snapshot.

## Technical Decisions

- **Paradigm:** Hexagonal/Ports & Adapters. `packages/core` holds the domain, the `authorize()` gate, and ports — zero DB/HTTP imports. `apps/web` (Next.js Route Handlers) is the driving adapter. `packages/db` (Drizzle) is the driven adapter implementing core's ports. Enforced one-way dependency direction: `apps/web` → {core, db, ui, types}; `db` → {core, types}; `core` → {types} only (true by inspection today; not yet lint-enforced — wiring dependency-cruiser or equivalent is recommended during Story 1.5, the authorization-gate story).
- **Authorization gate (AD-1):** one canonical `authorize(actor, action, resourceRef)` for single-resource checks and `authorizeScope(actor, action, resourceType)` for list/report/export checks (returns a filter the caller applies, not just a boolean). Both always re-read live permission/role data via the session port on every call — never a role/grant cached on the `sessions` row. Every `app/api/**` Route Handler calls one of these before touching data.
- **Sessions (AD-8):** Postgres-backed `sessions` table holding a hashed opaque token with an expiry; every request validates against this table; deleting the row ends the session immediately on the next request. No Redis/stateless JWT.
- **Client config (AD-7):** one `client.config` object resolved from environment variables at boot, supplying branding, currency/locale, and enabled-modules. `packages/core` never imports or branches on a client identifier.
- **Foundational rework required before login logic:** this epic must first retire `apps/api` (Fastify demo, not migrated — no real logic worth keeping), strip the demo Portfolio/Investment domain content from `packages/types`/`packages/core`/`packages/ui`, and upgrade Next.js 14.2.15 → 16.2.10 and React 18 → 19, then stand up the `apps/web` + `packages/core`/`db`/`types`/`ui` skeleton per the structural seed.
- Creates the `users` and `sessions` tables (further entities belong to later epics).
- **Stack:** Next.js 16.2.10, React ^19, TypeScript ^5.6.3, Drizzle ORM ^0.45.3, @neondatabase/serverless ^1.1.0, PostgreSQL 17 (Neon, free tier), deployed on Vercel Hobby (free tier) — one dedicated deployment per client, not shared multi-tenant.
- **Conventions:** DB tables/columns `snake_case`, TypeScript `camelCase`; domain identifiers mirror PRD Glossary terms verbatim. IDs are UUID v7. Dates are ISO 8601 strings at every boundary. API errors follow `{ code: string, message: string }` — never a raw stack trace to the client.
- Test framework: Vitest across `packages/core`, `packages/db`, and `apps/web`. Story 1.5 (the authorization gate) is explicitly called out as needing Vitest coverage.
- This epic builds the authorization *mechanism* only; Epic 2 extends `authorize()`/`authorizeScope()` with Project/Partner/Sub-partner-scoped rules rather than building a second mechanism.

## UX & Interaction Patterns

- Fixed main navigation includes Home, Projects, Partner Shares, Add Money, Withdraw Money, Available Balance, Adjust Next Time, Money History, Reports, plus Owner/Admin-only Users, Permissions, and Audit History items — a nav item must never appear for a role that isn't authorized to use it (this is IA guidance only, never a substitute for the server-side check).
- Visual direction: clean SaaS-dashboard style — light grey-blue canvas, white cards, blue primary accent, colored status chips/icon badges — deliberately and distinctively designed, never a generic/default-component/AI-templated look.
- Error and confirmation messages must be explicit, plain-language, and specific (e.g. "This link has expired — request a new one" rather than a silent failure or generic error).

## Cross-Story Dependencies

- Story 1.1 depends on the foundational scaffold rework (retiring `apps/api`, stripping demo content, framework upgrade) landing first — no other story in this epic can start before it.
- Story 1.5's `authorize()` gate is a prerequisite for Story 1.6 (it's proven against Story 1.6's real activate/deactivate action) and for Story 1.7 (Permissions area access control).
- Story 1.2 (reset) and Story 1.4 (session revocation) both depend on Story 1.1's session mechanism existing.
- No story in this epic depends on a later epic. Epic 2 depends on this epic's `authorize()` gate and extends it — it does not rebuild it.

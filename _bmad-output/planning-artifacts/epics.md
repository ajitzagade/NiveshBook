---
stepsCompleted: [step-01, step-02, step-03, step-04]
inputDocuments: ['_bmad-output/planning-artifacts/prds/prd-NiveshBook-2026-09-22/prd.md', '_bmad-output/planning-artifacts/prds/prd-NiveshBook-2026-09-22/addendum.md', '_bmad-output/planning-artifacts/architecture/architecture-NiveshBook-2026-09-22/ARCHITECTURE-SPINE.md', '_bmad-output/planning-artifacts/briefs/brief-NiveshBook-2026-09-22/brief.md']
---

# NiveshBook - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for NiveshBook, decomposing the requirements from the PRD and Architecture Spine into implementable stories. No formal UX design contract (DESIGN.md/EXPERIENCE.md) exists yet — the PRD's Key User Journeys (§3.3, UJ-1 through UJ-4) and a founder-approved reference mockup (clean SaaS-dashboard direction: light canvas, white cards, blue primary accent, colored status chips) stand in as UX grounding.

### Decisions Locked at Sprint Planning

Four items were open going into Sprint Planning (PRD Open Question 2, Story 2.6's grant scope, Architecture's deferred test-framework choice, and — resolved later, on 2026-09-23, after FR-9/Story 2.4 turned out to be silent on it — Story 2.4's co-partner top-line visibility). Resolved so no dev agent has to invent them mid-story:

1. **Project Admin (PRD Open Question 2):** ships in v1 as a supported role, **disabled by default** — toggled on per client via `client.config` (AD-7), same mechanism as any other enabled-module flag. Affects Stories 1.5, 1.6, 1.8.
2. **Sub-partner visibility grant scope (Story 2.6):** limited to the Partner's **total Share %** only — no adjustment, payment, or balance detail is included in the grant. Affects Story 2.6's acceptance criteria.
3. **Test framework:** **Vitest**, across `packages/core`, `packages/db`, and `apps/web` — first-class Next.js 16/TS support, no separate config layer needed. Every story's implementation is expected to include Vitest tests for its acceptance criteria, particularly the money-math and authorization-gate stories (1.5, 2.4, 2.5, 3.2, 3.4, 4.1, 4.3).
4. **Co-partner top-line visibility (Story 2.4) — genuinely undecided until now, resolved 2026-09-23:** FR-9 and Story 2.4 as originally written block a co-partner's *sub-partner structure, split %, transaction detail, balance, and adjustments*, but never stated whether a co-partner's plain project-level total (e.g. "Partner B has paid ₹3,00,000 into Project A") is visible to other main partners on the same Project. Decision: **yes, visible** — same-level main partners on a Project can see each other's project-level investment/withdrawal totals; the privacy boundary applies only to each partner's internal sub-partner structure and transaction/adjustment detail, never to their top-line participation in the Project they're jointly on. Affects Story 2.4's acceptance criteria (new AC added). Separately, no story previously stated that a person's role and visibility are evaluated independently per Project (a Partner Share in Project A and a Sub-partner Share in Project B are unrelated records) — also resolved 2026-09-23, new AC added to Stories 2.2 and 2.4.

## Requirements Inventory

### Functional Requirements

FR1: User can log in with credentials and log out, ending their session server-side.
FR2: User can request a password reset and set a new password via a time-limited (30 min, assumed), single-use link.
FR3: Logged-in user can change their own password after confirming the current one.
FR4: Owner/Admin can mark a user active or inactive; inactive users cannot log in but their historical transactions remain intact and attributed.
FR5: Sessions expire after inactivity (30 min, assumed) and can be revoked by an Owner/Admin, taking effect immediately.
FR6: System supports Owner/Admin, Partner, Sub-partner, and optional Project Admin roles, each with a distinct default permission set.
FR7: Every API/database query independently verifies the logged-in user's role and their association to the specific Project/Partner/Sub-partner records requested, regardless of what the frontend renders.
FR8: Any unauthorized access attempt returns HTTP 403 with no data body beyond a generic error — including list, detail, export, and report endpoints.
FR9: A Partner can never retrieve another Partner's internal sub-partner structure, split percentages, private transaction detail, available balance, or pending/extra-paid adjustments.
FR10: A Sub-partner sees only their own Should Pay, Paid Now, adjustments, and withdrawal data.
FR11: A Partner can optionally permit their own Sub-partners to see partner-level context, without exposing anything to other Partners.
FR12: Owner/Admin can create a Project with just a Name and Description, and edit either later.
FR13: Owner/Admin can add multiple Partners to a Project, each with a Share %, with a continuously-shown running total against 100% and clear over/under messaging.
FR14: Within a Partner's own share, Owner/Admin (or the Partner, if permitted) can add Sub-partners, each entered/displayed as a percentage of the full Project.
FR15: Owner/Admin can create a funding requirement for a Project: amount and date/cycle.
FR16: System calculates Should Pay per Partner and per Sub-partner from Share % × requirement amount, automatically.
FR17: User can record a Paid Now amount against a Should Pay line, with Project, Person, Amount, Date, Payment Mode, Reference Number, Notes.
FR18: System computes Investment Adjustment (Pending or Extra Paid) per funding cycle: Recommended Amount − Actual Amount.
FR19: System carries forward the Recommended Amount for the next funding cycle (Base Amount + Previous Pending − Previous Extra Paid), shown alongside Normal Share, editable.
FR20: The same Should Pay → Paid Now → Adjustment → Carry Forward logic applies privately one level down for a Partner's own Sub-partners.
FR21: System calculates each Partner's/Sub-partner's normal Can Take from Share % × Project's available-to-withdraw amount.
FR22: User can record a Take Now amount: Project, Person, Amount, Date, Payment Mode, Reference Number, Notes.
FR23: System computes Withdrawal Adjustment (Keep for Later or Extra Taken) per cycle.
FR24: System carries forward the Recommended Available Withdrawal for the next withdrawal cycle.
FR25: A user may withdraw beyond Can Take only with explicit Owner/Admin approval (Extra Withdrawal), recorded as Extra Taken and deducted from future availability.
FR26: Sub-partners withdraw independently of each other and of the parent Partner.
FR27: After an actual withdrawal, user allocates the amount across one or more destinations (another Project, a Person, Available Balance, Other), validated to sum exactly to the withdrawn amount.
FR28: When a destination is "another Project," the system automatically creates and links the withdrawal, a money-movement record, and the destination-project investment record as one action.
FR29: System maintains a running Available Balance, incremented on withdrawal-to-balance, decremented when spent, never negative.
FR30: Every transaction (investment, withdrawal, movement, balance use) remains linked back to its origin, reconstructable as a single chain.
FR31: Filterable Money History list showing Date, What Happened, Project, Person, Amount, Payment Mode, From, To, Notes.
FR32: Each Money History entry that's part of a linked chain surfaces a way to jump to related entries.
FR33: Adjust Next Time page shows, per person, an Investment section and a Withdrawal section in plain language, no formulas.
FR34: Investment Adjustment and Withdrawal Adjustment are never automatically netted; only an explicit, audited Owner/Admin action can offset one against the other.
FR35: Owner/Admin Dashboard shows Total Project Money, Total Added, Total Withdrawn, Available Balance, partner-wise overview.
FR36: Partner Dashboard shows own Projects, Share %, money added/withdrawn, Available Balance, Pending, Extra Paid, Keep for Later, own Sub-partners (if permitted), Money History.
FR37: Sub-partner Dashboard shows the same category of cards, scoped strictly to that Sub-partner's own data.
FR38: System provides a permission-scoped set of reports (Project Money, Partner, Sub-partner, Money Added, Withdrawal, Available Balance, Money Movement, Payment Mode, Adjustment, Money History).
FR39: Reports support filtering by Date, Project, and Person.
FR40: Reports can be exported to Excel and to PDF/print.
FR41: Every edit to a financial transaction preserves who created/changed it, timestamp, old/new value, reason.
FR42: Financial transactions are never hard-deleted; correcting one requires a Cancel/Reverse action preserving the original and creating a linked reversal.
FR43: A new client's deployment is configured (branding, currency, locale, enabled modules/roles) without any client-specific code change.
FR44: Default currency/locale is INR with Indian digit grouping, overridable per client.
FR45: Owner/Admin can view and manage permission grants (who can authorize Extra Withdrawal, which Partners enabled Sub-partner visibility, which roles are active) from a dedicated Permissions area.

### NonFunctional Requirements

NFR1 (Security): Every access-control rule applies uniformly across every endpoint, report, export, and background job — no code path trusts the frontend as the sole gate.
NFR2 (Security): No permission decision is ever inferred from client-supplied data; every role/grant check is a server-side lookup.
NFR3 (Data Integrity): All monetary values use decimal-safe storage/arithmetic — never native floating point.
NFR4 (Data Integrity): Share %, Should Pay, Can Take, and adjustment calculations support at least 2 decimal places (e.g. 33.33%).
NFR5 (Data Integrity): Multi-record financial updates are atomic — no partial failure leaves an inconsistent state.
NFR6 (Data Integrity): No duplicate transactions from a resubmitted/double-clicked action.
NFR7 (Data Integrity): No negative or invalid balances — an operation that would drive a balance negative is rejected, not flagged after the fact.
NFR8 (Reliability): Every screen that loads data, submits a transaction, or shows a list has defined loading, error, and empty states.
NFR9 (Privacy): The co-partner privacy boundary is treated as a security requirement with the same rigor as authentication.
NFR10 (Performance): Dashboards, Money History, and report views return in under 2 seconds at expected data volume (dozens of Projects, hundreds–low-thousands of transactions per Project).
NFR11 (Concurrency): Concurrent writes to a shared balance never lose an update (row-level locking + non-negative DB constraint).
NFR12 (Usability/Tone): All user-facing copy uses the product's plain-language Glossary terms verbatim — no accounting jargon anywhere in the UI, including errors and tooltips.
NFR13 (Usability/Tone): Every calculation-driven action (Should Pay, Can Take, adjustments, share validation) includes a short worked example or helper text at the point of use.
NFR14 (Usability/Tone): Confirmation messages after any financial action are explicit and in plain language.
NFR15 (Visual/IA): Visual restraint — no complicated charts, excessive modals, dense multi-field screens, or complex nested tables; clean light interface, large readable amounts, simple status tags, searchable dropdowns with clear-selection affordance.
NFR16 (Visual/IA): Interface reads as deliberately and distinctively designed, matching the founder-approved reference direction — never a generic/default-component/AI-templated look.
NFR17 (Localization): All amounts display with ₹ and Indian digit grouping by default, overridable per client.
NFR18 (IA): Main navigation is fixed (Home, Projects, Partner Shares, Add Money, Withdraw Money, Available Balance, Adjust Next Time, Money History, Reports, plus Owner/Admin-only Users/Permissions/Audit History); a nav item never appears for an unauthorized role.
NFR19 (Responsive): Application is responsive and usable on desktop, tablet, and mobile.

### Additional Requirements

- **No named external starter template.** Architecture repurposes the existing brownfield Turborepo/pnpm monorepo scaffold (apps/web, apps/api, packages/core|types|ui|config) rather than adopting a new starter. Epic 1 Story 1 must explicitly: retire `apps/api` (Fastify demo, not migrated), strip the demo Portfolio/Investment domain content out of `packages/types`/`packages/core`/`packages/ui`, and upgrade Next.js 14.2.15 → 16.2.10 / React 18 → 19 while only demo code exists.
- **Paradigm (AD, Design Paradigm):** Hexagonal/Ports & Adapters. `packages/core` = domain + authorize() gate + ports, zero DB/HTTP imports. `apps/web` (Next.js Route Handlers) = driving adapter. `packages/db` (Drizzle) = driven adapter implementing core's ports. Dependency direction enforced by a lint rule (dependency-cruiser): apps/web → {core, db, ui, types}; db → {core, types}; core → {types} only.
- **AD-1 — Authorization gate:** single `authorize()`/`authorizeScope()` in packages/core, called by every Route Handler including list/report/export endpoints; always reads live permission data, never a session-cached snapshot.
- **AD-2 — Money handling:** Postgres `NUMERIC` + nominally-branded `Money` type in packages/types; all arithmetic through one `packages/core/src/decimal-math.ts` module; eslint ban on `parseFloat`/`parseInt`/`Number()` on monetary values outside that module; largest-remainder rounding for percentage splits, applied identically everywhere.
- **AD-3 — Share % model:** `sharePercent` is a column-scoped, versioned value (new row per change, effective-dated); every Investment/Withdrawal transaction snapshots the share percent used at computation time.
- **AD-4 — Adjustment ledgers:** two tables (`investment_adjustments`, `withdrawal_adjustments`), keyed by `(shareId, projectId)` — never by `USER.id`, since a Sub-partner may hold a share with no login yet.
- **AD-5 — Transactional writes:** every financial write = one DB transaction + one `audit_log` row + a required client-generated idempotency key (unique constraint); reversal cascades across any multi-record bundle.
- **AD-6 — Cross-project movement:** `moveWithdrawalToProject()` in packages/core, composable (accepts a caller-supplied transaction, never opens its own) so FR-27's multi-destination split commits/rolls back as one unit.
- **AD-7 — Client config:** one `client.config` object from env vars at boot; packages/core never branches on a client identifier.
- **AD-8 — Sessions:** Postgres-backed `sessions` table, hashed opaque token, immediately revocable by row deletion (no Redis).
- **AD-10 — Balance concurrency:** `SELECT ... FOR UPDATE` row lock on every balance-decrementing mutation + a Postgres `CHECK (balance >= 0)` backstop.
- **Stack (pinned, verified current 2026-09-22):** Next.js 16.2.10, React ^19, TypeScript ^5.6.3, Drizzle ORM ^0.45.3, @neondatabase/serverless ^1.1.0, PostgreSQL 17.
- **Infra/deployment:** single Vercel Hobby (free tier) deployment for all of `apps/web` (UI + `/api` Route Handlers) + Neon Postgres (free tier). One dedicated deployment per client (not shared multi-tenant) — the productization model.
- **Core-entity model (ERD):** PROJECT, PARTNER_SHARE, SUBPARTNER_SHARE, INVESTMENT_REQUIREMENT, INVESTMENT_TRANSACTION, INVESTMENT_ADJUSTMENT, WITHDRAWAL_TRANSACTION, WITHDRAWAL_ADJUSTMENT, MONEY_MOVEMENT, AVAILABLE_BALANCE, USER, SESSION, AUDIT_LOG — relationships per the spine's ERD.

### UX Design Requirements

No bmad-ux DESIGN.md/EXPERIENCE.md exists. UX grounding instead comes from:
- PRD §3.3 Key User Journeys (UJ-1 through UJ-4) — used directly to shape acceptance criteria for Add Money, Withdraw Money, and privacy-boundary stories.
- A founder-approved reference mockup: clean SaaS-dashboard visual direction — light grey-blue canvas, white cards, blue primary accent, green/red/teal/violet status chips, colored icon badges in a fixed sidebar nav matching NFR18's navigation list, a linked-chain "trail" visualization for Money History.
- PRD §6 Aesthetic, Tone & Information Architecture (folded into NFR12–NFR18 above) stands in for formal UX-DRs.

### FR Coverage Map

FR1: Epic 1 - Login/logout with server-side session invalidation
FR2: Epic 1 - Forgot/reset password
FR3: Epic 1 - Change password (authenticated)
FR4: Epic 1 - Active/inactive users
FR5: Epic 1 - Session inactivity timeout + Owner/Admin revocation
FR6: Epic 1 - Role-based access control (Owner/Admin, Partner, Sub-partner, Project Admin)
FR7: Epic 1 - Server-enforced Project/Partner/Sub-partner scoped access on every query
FR8: Epic 1 - 403 with no data leakage on any unauthorized access attempt
FR9: Epic 2 - Co-partner privacy boundary (moved from Epic 1 - requires Partner records)
FR10: Epic 2 - Sub-partner own-data-only visibility (moved from Epic 1 - requires Sub-partner records)
FR11: Epic 2 - Optional Partner→Sub-partner visibility grant (moved from Epic 1 - requires Partner/Sub-partner records)
FR12: Epic 2 - Create/edit Project (name + description)
FR13: Epic 2 - Partner Shares with 100% validation
FR14: Epic 2 - Sub-partner allocation as % of full project
FR15: Epic 3 - Create investment requirement
FR16: Epic 3 - Auto-calculate Should Pay
FR17: Epic 3 - Record Add Money transaction
FR18: Epic 3 - Compute Investment Adjustment (Pending/Extra Paid)
FR19: Epic 3 - Carry forward Recommended Amount
FR20: Epic 3 - Sub-partner investment adjustment (private)
FR21: Epic 4 - Auto-calculate Can Take
FR22: Epic 4 - Record Withdrawal transaction
FR23: Epic 4 - Compute Withdrawal Adjustment (Keep for Later/Extra Taken)
FR24: Epic 4 - Carry forward Recommended Available Withdrawal
FR25: Epic 4 - Extra Withdrawal, permission-gated
FR26: Epic 4 - Sub-partner withdrawal (private, independent)
FR27: Epic 4 - Post-withdrawal destination allocation
FR28: Epic 4 - Auto-linked cross-project movement
FR29: Epic 4 - Available Balance ledger
FR30: Epic 4 - End-to-end money trail (write path)
FR31: Epic 5 - Money History list
FR32: Epic 5 - Linked-transaction navigation (read path for FR30's trail)
FR33: Epic 5 - Adjust Next Time page
FR34: Epic 5 - Independent adjustment balances (display + explicit netting action)
FR35: Epic 5 - Owner/Admin Dashboard
FR36: Epic 5 - Partner Dashboard
FR37: Epic 5 - Sub-partner Dashboard
FR38: Epic 5 - Permission-scoped report set
FR39: Epic 5 - Report filtering
FR40: Epic 5 - Excel/PDF export
FR41: Epic 3 (mechanism) / Epic 5 (Owner/Admin viewing surface) - Immutable audit trail
FR42: Epic 3 (mechanism) / Epic 5 (viewing surface) - Cancel/reverse, never hard delete
FR43: Epic 1 - Per-client configuration layer
FR44: Epic 1 - Default currency/locale
FR45: Epic 1 (role-level scope) / Epic 2 (partner-specific visibility-grant view) - Owner/Admin permissions management

## Epic List

### Epic 1: Accounts, Access & Client Setup
Every person gets their own secure login, and the server-side authorization gate that everything else in the product relies on gets built and proven here — against real, protected actions (user management), not a stub. The Owner/Admin can manage who's allowed to approve sensitive actions at a role level, and a new client deployment can be configured (branding, currency, enabled roles) without any code change. Standalone: a working, securely-gated shell with no financial data yet, but a real, independently-testable login/permissions system.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR43, FR44, FR45 (partial — role-level permissions only; partner-specific grants move to Epic 2, see note below)

### Epic 2: Projects, Partner Shares & Privacy
Owner/Admin can create a project (name + description) and, in a separate step, set up its main partners with validated Share % (running total against 100%, clear over/under messaging), then split any partner's share privately among their own sub-partners as a percentage of the full project — with the co-partner and sub-partner privacy boundary enforced from the moment this data exists. Standalone: extends Epic 1's authorization gate to Project/Partner/Sub-partner resources; delivers a complete, correctly-validated, correctly-private ownership structure ready to fund.
**FRs covered:** FR9, FR10, FR11, FR12, FR13, FR14, FR45 (remainder — partner-specific sub-partner-visibility-grant view)

**Note on the FR9–FR11 / FR45 move:** in Step 2 these were mapped to Epic 1. Designing Epic 1's stories in detail surfaced a real forward-dependency: co-partner and sub-partner privacy rules (FR9–FR11) govern *Partner*/*Sub-partner* records, which don't exist until Epic 2 creates them (FR12–FR14) — and the same is true for the part of FR45 that shows "which Partners enabled sub-partner visibility." Moving them here keeps every epic genuinely standalone. Epic 1 still builds the general authorization *mechanism* (FR6–FR8) and proves it end-to-end against a real protected action (user activation/deactivation) — Epic 2 extends that same mechanism to the new resource types rather than inventing a second one.

### Epic 3: Add Money — Flexible Investment
Owner/Admin can request funding for a project; every partner and sub-partner automatically sees their Should Pay, can pay any amount (more, less, nothing), and the system tracks who's ahead (Extra Paid) or behind (Pending) — carrying that forward as a recommended, never-forced amount next round — without ever touching anyone's ownership %. This epic also introduces the audit/reversal mechanism (FR41, FR42) as a first-class part of every financial write, since Add Money is the first place real money gets recorded. Standalone: a complete, working investment-tracking loop.
**FRs covered:** FR15, FR16, FR17, FR18, FR19, FR20, FR41, FR42

### Epic 4: Withdraw Money & Money Movement
Owner/Admin can process withdrawals flexibly per partner (Can Take / Take Now / Keep for Later, with permission-gated Extra Withdrawal), then split a withdrawal across another project, a person, and Available Balance in one action — with cross-project movement auto-linked so nothing is entered twice. Available Balance can later be spent into another project. Reuses the audit/reversal mechanism from Epic 3. Standalone: a complete, traceable withdrawal-and-movement loop.
**FRs covered:** FR21, FR22, FR23, FR24, FR25, FR26, FR27, FR28, FR29, FR30

### Epic 5: The Full Picture — History, Adjustments, Dashboards & Reports
Everyone — Owner, Partner, Sub-partner — can see their complete, trustworthy financial picture: role-scoped dashboards, a plain-language Money History with fully-linked, navigable trails, the Adjust Next Time summary (investment and withdrawal adjustments side by side, independent, never auto-netted), permission-scoped reports with filtering and export, a per-Project/per-Partner structure diagram switchable between ownership %, actual amount, and money flow (Story 5.10, 2026-09-25 addition), and — for Owner/Admin — the audit-history view behind any edited transaction. Standalone: read surfaces over data created in Epics 2–4; delivers the "can I trust this system" payoff the whole product promises.
**FRs covered:** FR31, FR32, FR33, FR34, FR35, FR36, FR37, FR38, FR39, FR40 (viewing surface for FR41, FR42's audit mechanism, built in Epic 3); Story 5.10 has no FR number (added after the original PRD)

**Implementation notes / file-overlap review:** Epics 3 and 4 both write through the same `packages/core` financial-mutation path (AD-2, AD-5, AD-6) — kept as two epics rather than merged because they deliver genuinely separate user capabilities (funding vs. withdrawing) and Epic 4 has a materially different shape (multi-destination split, cross-project auto-linking) that benefits from Epic 3's transactional/audit pattern already being proven first. Epic 5's five FR clusters (History, Adjustments, Dashboards, Reports) are bundled into one epic because they're all thin read-surfaces over the same underlying data with heavy UI/file overlap (`apps/web` dashboard and list components) and no epic among them meaningfully stands alone without the others existing conceptually — splitting them would just be technical-layer slicing of the same "see your data" capability.

---

## Epic 1: Accounts, Access & Client Setup

Every person gets their own secure login, and the server-side authorization gate that everything else in the product relies on gets built and proven here — against real, protected actions (user management), not a stub. The Owner/Admin can manage who's allowed to approve sensitive actions at a role level, and a new client deployment can be configured without any code change.

### Story 1.1: User Login and Logout

As a **registered user**,
I want **to log in with my credentials and log out**,
So that **I can securely access my own data and end my session when I'm done**.

**Acceptance Criteria:**

**Given** a registered, active user with a known email and password
**When** they submit correct credentials on the login screen
**Then** they are authenticated and redirected into the app with an active session

**Given** a login attempt with a wrong password or unknown email
**When** the request is submitted
**Then** the error message is identical either way ("Incorrect email or password") — it never reveals which field was wrong

**Given** an authenticated user with an active session
**When** they choose Logout
**Then** the session is invalidated server-side (a replayed session token no longer authenticates), not just cleared client-side

**Given** an inactive (deactivated) user's credentials
**When** they attempt to log in
**Then** login is rejected with a clear message, not a generic failure

*(Technical foundation for this story: no external starter template is specified in Architecture — instead, this story retires the brownfield demo scaffold (`apps/api`/Fastify and the demo Portfolio/Investment content in `packages/types`/`packages/core`/`packages/ui`), upgrades Next.js 14.2.15→16.2.10 and React 18→19, and stands up the `apps/web` + `packages/core`/`db`/`types`/`ui` skeleton per the Structural Seed, before any login logic is written. Creates: `users`, `sessions` tables — per AD-8, sessions are Postgres-backed, opaque, hashed.)*

### Story 1.2: Forgot & Reset Password

*(Skipped for now by explicit user directive, 2026-09-23 — no reset/forgot-password flow will be built at this time. FR2 stays recorded here for whenever it's picked back up; sprint-status.yaml note added accordingly. Story 1.3 has no dependency on this one and is unaffected.)*

As a **user who forgot their password**,
I want **to request a reset link and set a new password**,
So that **I can regain access without anyone else being able to do it for me**.

**Acceptance Criteria:**

**Given** a user submits their email on "Forgot Password"
**When** the email matches a registered account
**Then** a time-limited (30 minutes), single-use reset link is issued — and the response is identical whether or not the email matches, so the flow can't be used to enumerate accounts

**Given** a valid, unexpired reset link
**When** the user sets a new password
**Then** the password is updated, the link is invalidated, and all existing sessions for that user are ended

**Given** an expired or already-used reset link
**When** the user opens it
**Then** they see a clear, specific message ("This link has expired — request a new one") — never a silent failure or generic error

### Story 1.3: Change Own Password

As a **logged-in user**,
I want **to change my own password after confirming my current one**,
So that **I can update my credentials without going through the reset flow**.

**Acceptance Criteria:**

**Given** a logged-in user on the Change Password screen
**When** they enter their correct current password and a new password
**Then** the password is updated and a confirmation is shown

**Given** a logged-in user enters an incorrect current password
**When** they submit the form
**Then** the change is rejected with a clear error, and the password is not updated

### Story 1.4: Session Timeout & Owner/Admin Revocation

As an **Owner/Admin**,
I want **sessions to expire after inactivity and to be able to revoke a session directly**,
So that **an abandoned or compromised login can't be used indefinitely**.

**Acceptance Criteria:**

**Given** an authenticated session with no activity for 30 minutes `[ASSUMPTION: confirm]`
**When** the next request is made
**Then** the session is treated as expired and the user must log in again

**Given** an Owner/Admin viewing a list of active sessions (their own, at minimum, in this story)
**When** they revoke a session
**Then** the very next request using that session's token is rejected — revocation is immediate, not eventual

### Story 1.5: Roles & the Server-Side Authorization Gate

As an **Owner/Admin**,
I want **every protected action to be checked server-side against the acting user's role — never trusting the frontend**,
So that **no one can act beyond their role by manipulating the UI or calling the API directly**.

**Acceptance Criteria:**

**Given** the system defines four roles — Owner/Admin, Partner, Sub-partner, and optional Project Admin
**When** a user is created or edited
**Then** exactly one role is assigned and stored server-side

**Given** `packages/core`'s `authorize(actor, action, resourceRef)` gate (AD-1)
**When** any `app/api/**` Route Handler receives a request for a protected action
**Then** it calls `authorize()` before touching any data — there is no code path that decides access in the frontend alone

**Given** a user whose role does not permit a given action
**When** they call the corresponding API endpoint directly (bypassing the UI entirely)
**Then** the response is HTTP 403 with no data body beyond a generic error message

**Given** a non-Owner/Admin user
**When** they attempt to call an Owner/Admin-only endpoint (proven concretely via Story 1.6's activate/deactivate endpoint)
**Then** the request is rejected with 403, and Story 1.6's action does not occur

*(This story delivers FR6, FR7, FR8's mechanism. Epic 2 extends `authorize()` with Project/Partner/Sub-partner-scoped rules — it does not rebuild it.)*

### Story 1.6: Owner/Admin Activates or Deactivates a User

As an **Owner/Admin**,
I want **to mark a user active or inactive**,
So that **I can revoke someone's access without losing their account history**.

**Acceptance Criteria:**

**Given** an Owner/Admin viewing the user list
**When** they deactivate a user
**Then** that user can no longer log in (per Story 1.1), but their user record is preserved, not deleted

**Given** a deactivated user
**When** an Owner/Admin reactivates them
**Then** they can log in again immediately

**Given** a non-Owner/Admin user
**When** they attempt to deactivate any user, including themselves, via direct API call
**Then** the request is rejected with 403 (proves Story 1.5's gate against a real action)

### Story 1.7: Owner/Admin Manages Role-Level Permissions

As an **Owner/Admin**,
I want **a dedicated place to see and manage who can approve sensitive actions and which roles are enabled for this deployment**,
So that **permission changes are deliberate and visible, not buried in individual user edits**.

**Acceptance Criteria:**

**Given** the Permissions area
**When** an Owner/Admin views it
**Then** they see which roles are enabled for this deployment (e.g. whether Project Admin is in use) and which users hold Owner/Admin-level approval authority (e.g. for Extra Withdrawal, per FR25 — enforced when Epic 4 builds that flow)

**Given** an Owner/Admin revokes a role-level permission grant
**When** the change is saved
**Then** it takes effect on the very next request for that action — no cached or stale permission state persists past the change

**Given** a non-Owner/Admin user
**When** they attempt to reach the Permissions area or its API endpoints
**Then** the request is rejected with 403

*(Partner-specific grants — "which Partners enabled Sub-partner visibility" — are added to this same Permissions area by Epic 2, once Partner records exist.)*

### Story 1.8: Per-Client Configuration

As the **person deploying NiveshBook for a new client**,
I want **branding, currency, locale, and enabled modules to be set by configuration alone**,
So that **a second client can be launched without touching application code**.

**Acceptance Criteria:**

**Given** a fresh deployment with a `client.config` resolved from environment variables at boot (AD-7)
**When** the app starts
**Then** branding, currency/locale, and enabled-modules (e.g. whether Project Admin is offered) come from that config — no file in `packages/core` or `apps/web` branches on a client identifier

**Given** no client-specific currency is configured
**When** the app renders any amount
**Then** it defaults to INR with Indian digit grouping (₹10,00,000-style)

**Given** two client deployments with different `client.config` values
**When** their deployed application code is diffed
**Then** the only differences are in configuration/environment, never in application source

## Epic 1 Summary

8 stories, covering FR1–FR8, FR43–FR45 (role-level scope). All FRs assigned to Epic 1 in the coverage map are addressed. No story depends on a later story or a later epic; Epic 2 extends (not rebuilds) the authorization gate from Story 1.5.

---

## Epic 2: Projects, Partner Shares & Privacy

Owner/Admin can create a project and set up validated main-partner and sub-partner shares — with co-partner and sub-partner privacy enforced from the moment this data exists, extending Epic 1's authorization gate rather than building a second one.

### Story 2.1: Create and Edit a Project

As an **Owner/Admin**,
I want **to create a project with just a name and description**,
So that **I can start tracking money for it without being blocked on partner details**.

**Acceptance Criteria:**

**Given** no partner details exist yet
**When** Owner/Admin creates a project with Name "Project A" and Description "Residential development at Pune"
**Then** it's saved and appears in the project list — no partner information is required to save

**Given** an empty name field
**When** save is attempted
**Then** it's blocked with a clear validation message

**Given** a non-Owner/Admin user
**When** they attempt to create a project via direct API call
**Then** 403 (extends Story 1.5's gate to a Project-scoped `resourceRef`)

**Given** an existing project
**When** Owner/Admin edits its name or description
**Then** the change is saved and reflected immediately

*(Creates: `projects` table.)*

### Story 2.2: Add & Edit Partner Shares with 100% Validation

As an **Owner/Admin**,
I want **to add partners to a project with a Share % and see the running total against 100%**,
So that **ownership is never left mis-allocated**.

**Acceptance Criteria:**

**Given** Project A with no partners yet
**When** Partner A = 50%, Partner B = 30%, Partner C = 20% are added
**Then** the screen shows "Total Share: 100% ✓"

**Given** a running total of 90%
**When** the screen is viewed
**Then** it shows "Total is 90%. 10% is still remaining."

**Given** a running total of 110%
**When** the screen is viewed
**Then** it shows "Total is 110%. Please reduce by 10%."

**Given** a Share % field
**When** a value like 33.33 is entered
**Then** it's accepted (at least 2 decimal places supported)

**Given** an existing Partner Share with transactions already recorded against it
**When** Owner/Admin edits the percentage
**Then** a new versioned row is created with an effective-from date rather than overwriting the old value (AD-3) — past transactions keep referencing the share percent in effect when they happened

**Given** a person who already holds a Sub-partner Share in Project B
**When** they are added as a Main Partner in Project A instead (or vice versa, in a different combination)
**Then** both records are created and stored independently — nothing in Partner Shares requires or infers a single global role for a person across every Project (Decisions Locked #4)

*(Creates: `partner_shares` table.)*

### Story 2.3: Sub-partner Allocation as % of Full Project

As a **Partner (or Owner/Admin on their behalf)**,
I want **to split my share privately among my own sub-partners, as a percentage of the full project**,
So that **I never have to calculate "percentage of my percentage"**.

**Acceptance Criteria:**

**Given** Partner A holds 50% of Project A
**When** Sub1 = 12.5% and Sub2 = 12.5% are added, with Partner A's own retained portion at 25%
**Then** the screen shows "Partner A Total Share: 50%" and "Allocated: 50% ✓"

**Given** the same setup
**When** any field is viewed
**Then** Sub1 and Sub2's shares are always shown as a percentage of the full project (e.g. "12.5% of Project"), never as a percentage of Partner A's 50%

**Given** an allocated total under 50%
**When** the screen is viewed
**Then** the remaining unallocated amount is shown clearly, mirroring Story 2.2's pattern

**Given** a Sub-partner Share edited after transactions exist against it
**When** saved
**Then** it's versioned the same way as Story 2.2 (AD-3)

*(Creates: `subpartner_shares` table.)*

### Story 2.4: Co-Partner Privacy Boundary

As a **Partner**,
I want **my internal sub-partner structure and private data invisible to my co-partners**,
So that **I can trust the system with sensitive information**.

**Acceptance Criteria:**

**Given** Partner A and Partner B on the same Project A
**When** Partner B requests any endpoint that would reveal Partner A's sub-partner structure, split percentages, or private transaction detail
**Then** the response is 403 with no data — `authorize()` (Story 1.5) is extended with Partner-scoped `resourceRef`s (AD-1)

**Given** the same setup
**When** Partner B attempts this via direct URL/ID manipulation instead of the UI
**Then** the result is identical — 403, no field of Partner A's data present

**Given** Owner/Admin
**When** they view any partner's data
**Then** full visibility is retained — Owner/Admin is exempt from the co-partner boundary by design

**Given** Partner A and Partner B on the same Project A
**When** Partner B views Project A's partner-wise summary
**Then** Partner B sees Partner A's plain project-level totals (e.g. total invested, total withdrawn) — this is explicitly *not* part of the privacy boundary (Decisions Locked #4); only Partner A's sub-partner structure, split percentages, and transaction/adjustment detail stay hidden from Partner B

**Given** a person holds a Partner Share in Project A and, separately, a Sub-partner Share in Project B
**When** their access is evaluated in each Project
**Then** the evaluation is entirely independent per Project — their Project A role/visibility never carries over to, or is inferred from, their Project B role, and vice versa (Decisions Locked #4)

### Story 2.5: Sub-partner Own-Data Visibility

As a **Sub-partner**,
I want **to see only my own data**,
So that **I'm never shown information that doesn't belong to me**.

**Acceptance Criteria:**

**Given** Sub1 (12.5% of Project A, under Partner A)
**When** Sub1 logs in and views their data
**Then** they see only their own figures, scoped to their 12.5% — never Sub2's or Partner A's full internal split

**Given** Sub1
**When** they attempt to reach Sub2's or Partner B's data via URL/ID manipulation
**Then** 403 with no data (same gate extension as Story 2.4, applied to Sub-partner-scoped `resourceRef`s)

### Story 2.6: Optional Partner→Sub-partner Visibility Grant

As a **Partner**,
I want **to optionally let my own sub-partners see my partner-level context**,
So that **I can be transparent with them if I choose to, without affecting anyone else's privacy**.

**Acceptance Criteria:**

**Given** Partner A has not enabled the grant
**When** Sub1 views their dashboard
**Then** no Partner-A-level context is shown beyond Sub1's own data

**Given** Partner A enables the grant
**When** Sub1 views their dashboard
**Then** the specific partner-level context covered by the grant becomes visible to Sub1 and Sub2 — and still not to Partner B or anyone outside Partner A's own sub-partners

**Given** the grant is toggled off again
**When** Sub1 next loads their dashboard
**Then** the previously-visible context is hidden again immediately

### Story 2.7: Partner-Specific Permissions View

As an **Owner/Admin**,
I want **to see which Partners have enabled sub-partner visibility grants, alongside the role-level permissions from Story 1.7**,
So that **I have one place to review every permission-affecting setting**.

**Acceptance Criteria:**

**Given** the Permissions area (Story 1.7)
**When** an Owner/Admin views it after partners exist
**Then** it lists each Partner and whether their Sub-partner Visibility Grant (Story 2.6) is on or off

**Given** a non-Owner/Admin user
**When** they attempt to reach this view
**Then** 403

## Epic 2 Summary

7 stories, covering FR9–FR14 and the remainder of FR45. All FRs assigned to Epic 2 are addressed. Extends Epic 1's `authorize()` gate to Project/Partner/Sub-partner resources; no new gate mechanism introduced.

---

## Epic 3: Add Money — Flexible Investment

Owner/Admin can request funding for a project; every partner and sub-partner sees their Should Pay automatically, pays any amount, and the system tracks who's ahead or behind — carrying it forward as a recommendation, never forced, without ever touching ownership %. Introduces the audit/reversal mechanism as a first-class part of every financial write.

### Story 3.1: Create Investment Requirement

As an **Owner/Admin**,
I want **to create a funding requirement for a project**,
So that **everyone knows how much money is needed and when**.

**Acceptance Criteria:**

**Given** Project A with Partner Shares already set (Epic 2)
**When** Owner/Admin creates a funding requirement of ₹10,00,000
**Then** it's saved and visible on the project

**Given** a non-Owner/Admin user
**When** they attempt to create a requirement via direct API call
**Then** 403

**Given** a requirement amount of ₹0 or negative
**When** submitted
**Then** it's rejected with a clear validation message

*(Creates: `investment_requirements` table.)*

### Story 3.2: Auto-Calculate Should Pay

As a **Partner or Sub-partner**,
I want **my Should Pay calculated automatically**,
So that **I never have to do the percentage math myself**.

**Acceptance Criteria:**

**Given** the ₹10,00,000 requirement and Share % 50/30/20 for A/B/C
**When** any authorized viewer opens the funding round
**Then** Should Pay shows A=₹5,00,000, B=₹3,00,000, C=₹2,00,000, computed via the single decimal-math module (AD-2)

**Given** Partner A's internal split (Own 25%, Sub1 12.5%, Sub2 12.5%)
**When** the same requirement is viewed
**Then** Should Pay shows Own=₹2,50,000, Sub1=₹1,25,000, Sub2=₹1,25,000

**Given** a percentage split that doesn't divide evenly
**When** Should Pay is calculated
**Then** the remainder is allocated via the largest-remainder method (AD-2), and the sum of all Should Pay values equals the requirement amount exactly

### Story 3.3: Record Add Money Transaction (Audited)

As a **user (or Owner/Admin on their behalf)**,
I want **to record a Paid Now amount against a Should Pay line**,
So that **actual payments are tracked precisely, whatever the amount**.

**Acceptance Criteria:**

**Given** Partner A's Should Pay is ₹5,00,000
**When** ₹7,00,000 is recorded as Paid Now (Project, Person, Amount, Date, Payment Mode, Reference Number, Notes)
**Then** the transaction is saved and Partner A's Share % is unchanged

**Given** Partner C's Should Pay is ₹2,00,000
**When** ₹0 is recorded
**Then** it's accepted — no minimum payment enforced

**Given** a Paid Now submission is saved
**When** the transaction commits
**Then** an `audit_log` row is written in the same DB transaction (actor, timestamp, values) (AD-5)

**Given** a form double-submitted with the same idempotency key
**When** both requests reach the server
**Then** only one transaction record is created (AD-5)

*(Creates: `investment_transactions`, `audit_log` tables, and the idempotency-key uniqueness constraint (AD-5) — both reused unchanged by every later financial-write story in Epics 3–4.)*

### Story 3.4: Compute Investment Adjustment

As a **Partner or Sub-partner**,
I want **the system to automatically track whether I'm ahead or behind**,
So that **I always know where I stand**.

**Acceptance Criteria:**

**Given** Partner A: Should Pay ₹5,00,000, Paid ₹7,00,000
**When** the adjustment is computed
**Then** it shows Extra Paid ₹2,00,000 immediately

**Given** Partner C: Should Pay ₹2,00,000, Paid ₹0
**When** computed
**Then** it shows Pending ₹2,00,000

**Given** Partner B: Should Pay ₹3,00,000, Paid ₹3,00,000
**When** computed
**Then** it shows No Adjustment

**Given** the `investment_adjustments` ledger
**When** any entry is written
**Then** it's keyed by `(shareId, projectId)` — never `USER.id` (AD-4) — so Sub1's history exists even with no login yet

*(Creates: `investment_adjustments` table.)*

### Story 3.5: Carry Forward Recommended Amount

As an **Owner/Admin**,
I want **the next funding round to already account for who's ahead or behind**,
So that **I don't have to remember or recalculate it myself**.

**Acceptance Criteria:**

**Given** Partner A has Extra Paid ₹2,00,000 and Partner C has Pending ₹2,00,000 from the previous round
**When** a new ₹10,00,000 requirement is created
**Then** Recommended Amount shows A=₹3,00,000, B=₹3,00,000, C=₹4,00,000, alongside each person's plain Normal Share

**Given** the Recommended Amount is shown
**When** Owner/Admin records the actual Paid Now
**Then** any amount can be entered — it's never enforced

**Given** a remaining gap after this round's payment
**When** the next round is created
**Then** it carries forward again automatically

### Story 3.6: Sub-partner Investment Adjustment (Private)

As a **Partner**,
I want **the same Should-Pay-to-Adjustment logic to apply privately to my own sub-partners**,
So that **I can manage internal contributions without exposing this to co-partners**.

**Acceptance Criteria:**

**Given** Partner A pays ₹3,75,000, Sub1 pays ₹0, Sub2 pays ₹1,25,000 (against Own ₹2,50,000 / Sub1 ₹1,25,000 / Sub2 ₹1,25,000 recommended)
**When** adjustments are computed
**Then** Partner A shows Extra Paid ₹1,25,000, Sub1 shows Pending ₹1,25,000, Sub2 shows No Adjustment — computed and carried forward exactly as Stories 3.4–3.5

**Given** this data
**When** Partner B attempts to view any of it
**Then** 403 (enforced by Story 2.4) — visible only to Partner A, their own sub-partners, and Owner/Admin

### Story 3.7: Edit an Investment Transaction (Audited)

As an **Owner/Admin**,
I want **to correct a mistake in a recorded transaction's details**,
So that **the record stays accurate without losing the history of what changed**.

**Acceptance Criteria:**

**Given** a previously recorded Add Money transaction
**When** Owner/Admin edits its amount or details
**Then** the new values are saved and the previous values, who changed it, and when, are preserved in the audit trail (FR41)

**Given** an edit that changes the amount
**When** saved
**Then** the transaction's Investment Adjustment (Story 3.4) is recomputed to reflect the correction

**Given** the audit trail for an edited transaction
**When** Owner/Admin (or the transaction's own Partner/Sub-partner) views it
**Then** the before/after values are visible

### Story 3.8: Cancel/Reverse an Investment Transaction

As an **Owner/Admin**,
I want **to cancel a transaction that shouldn't have been recorded**,
So that **the record is corrected without ever silently deleting financial history**.

**Acceptance Criteria:**

**Given** a recorded Add Money transaction
**When** Owner/Admin cancels/reverses it
**Then** the original record is preserved with status "cancelled" and a linked reversal record is created — no row is hard-deleted (FR42)

**Given** a cancelled transaction
**When** the Investment Adjustment ledger is next viewed
**Then** it reflects the reversal — the cancelled amount no longer counts toward Paid Now

**Given** a non-Owner/Admin user
**When** they attempt to cancel/reverse any transaction
**Then** 403

## Epic 3 Summary

8 stories, covering FR15–FR20, FR41, FR42. All FRs assigned to Epic 3 are addressed. The audit/idempotency/transaction pattern established here (Stories 3.3, 3.7, 3.8) is reused, not reinvented, by Epic 4.

---

## Epic 4: Withdraw Money & Money Movement

Owner/Admin can process withdrawals flexibly per partner, with permission-gated Extra Withdrawal, then split a withdrawal across another project, a person, and Available Balance in one action — with cross-project movement auto-linked so nothing is entered twice.

### Story 4.1: Auto-Calculate Can Take

As a **Partner or Sub-partner**,
I want **my normal withdrawal entitlement calculated automatically**,
So that **I know what I can take without doing the math**.

**Acceptance Criteria:**

**Given** Project A has ₹5,00,000 available to withdraw and Share % 50/30/20
**When** any authorized viewer opens the withdrawal screen
**Then** Can Take shows A=₹2,50,000, B=₹1,50,000, C=₹1,00,000, via the same decimal-math module and largest-remainder rule as Should Pay (AD-2)

### Story 4.2: Record Withdrawal Transaction (Audited)

As a **user (or Owner/Admin on their behalf)**,
I want **to record a Take Now amount**,
So that **actual withdrawals are tracked precisely, whatever the amount**.

**Acceptance Criteria:**

**Given** Partner A's Can Take is ₹2,50,000
**When** ₹2,50,000 is recorded as Take Now (Project, Person, Amount, Date, Payment Mode, Reference Number, Notes)
**Then** the transaction is saved with an `audit_log` row in the same DB transaction (AD-5)

**Given** Partner B's Can Take is ₹1,50,000
**When** ₹0 is recorded
**Then** it's valid — no forced withdrawal

**Given** a double-submitted withdrawal with the same idempotency key
**When** both reach the server
**Then** only one transaction is created

*(Creates: `withdrawal_transactions` table.)*

### Story 4.3: Compute Withdrawal Adjustment

As a **Partner or Sub-partner**,
I want **the system to track what I didn't withdraw**,
So that **it's not lost, just kept for later**.

**Acceptance Criteria:**

**Given** Partner B: Can Take ₹1,50,000, Taken ₹0
**When** computed
**Then** it shows Keep for Later ₹1,50,000

**Given** Partner C: Can Take ₹1,00,000, Taken ₹0
**When** computed
**Then** Keep for Later ₹1,00,000

**Given** Partner A: Can Take ₹2,50,000, Taken ₹2,50,000
**When** computed
**Then** no Keep for Later balance is created

**Given** the `withdrawal_adjustments` ledger
**When** any entry is written
**Then** it's keyed by `(shareId, projectId)`, independent from `investment_adjustments` (AD-4) — never auto-netted against it

*(Creates: `withdrawal_adjustments` table.)*

### Story 4.4: Carry Forward Recommended Available Withdrawal

As a **Partner**,
I want **my next withdrawal opportunity to already account for what I kept for later**,
So that **I don't lose track of my own entitlement**.

**Acceptance Criteria:**

**Given** Partner B has Keep for Later ₹1,50,000 from a previous round
**When** a new amount becomes available to withdraw
**Then** their Recommended Available Withdrawal = new Base Entitlement + ₹1,50,000

**Given** this recommendation
**When** Owner/Admin or the Partner records the actual Take Now
**Then** any amount can be entered — never enforced

### Story 4.5: Extra Withdrawal, Permission-Gated

As an **Owner/Admin**,
I want **to authorize someone taking more than their normal entitlement**,
So that **real-world flexibility is possible without losing track of the excess**.

**Acceptance Criteria:**

**Given** Partner A's Can Take is ₹2,50,000
**When** Owner/Admin explicitly authorizes an Extra Withdrawal
**Then** Partner A can withdraw ₹3,00,000, and the excess ₹50,000 is recorded as Extra Taken

**Given** the same scenario
**When** the withdrawal is attempted without the explicit authorization step
**Then** it's rejected — Extra Withdrawal requires a distinct authorization action, not just a bigger number (FR25)

**Given** Extra Taken ₹50,000 exists
**When** the next withdrawal cycle's Recommended Available Withdrawal is computed
**Then** it's automatically reduced by ₹50,000

**Given** a non-Owner/Admin user
**When** they attempt to authorize their own Extra Withdrawal
**Then** 403

### Story 4.6: Sub-partner Withdrawal (Private, Independent)

As a **Sub-partner**,
I want **to withdraw independently of my parent Partner and sibling sub-partners**,
So that **one person's decision doesn't block or force mine**.

**Acceptance Criteria:**

**Given** Partner A withdraws their full ₹1,25,000, Sub1 withdraws ₹0, Sub2 withdraws their full ₹62,500
**When** each transaction is recorded independently
**Then** Sub1 shows Keep for Later ₹62,500 and Sub2 shows no adjustment — neither blocks or forces the other

**Given** this data
**When** Partner B attempts to view it
**Then** 403 (Epic 2's privacy boundary applies here too)

### Story 4.7: Post-Withdrawal Destination Allocation

As an **Owner/Admin**,
I want **to record where withdrawn money actually went, split across multiple destinations**,
So that **the money's path is captured accurately in one action**.

**Acceptance Criteria:**

**Given** a ₹2,50,000 withdrawal by Partner A
**When** Owner/Admin allocates ₹1,50,000 → Project B, ₹50,000 → Person X, ₹50,000 → Available Balance
**Then** the form shows "Distributed: ₹2,50,000 / ₹2,50,000 ✓" and allows saving

**Given** a partial allocation that doesn't sum to the withdrawn amount
**When** save is attempted
**Then** it's blocked until the amounts reconcile exactly

**Given** the save is processed
**When** it commits
**Then** all destination legs commit or roll back together as one transaction (AD-6) — no partial allocation is ever left behind

### Story 4.8: Auto-Linked Cross-Project Movement

As an **Owner/Admin**,
I want **money moved into another project to appear there automatically**,
So that **I never have to enter the same amount twice**.

**Acceptance Criteria:**

**Given** the ₹1,50,000 destined for Project B in Story 4.7
**When** the destination allocation is saved
**Then** the system automatically creates and links the withdrawal record (Project A), a money-movement record, and an investment record (Project B) as one action (FR28, `moveWithdrawalToProject()`, AD-6)

**Given** this linked set
**When** viewed from either Project A or Project B
**Then** the full chain is reachable and mutually navigable

**Given** Owner/Admin checks Project B's Add Money history afterward
**When** they look
**Then** the ₹1,50,000 already appears — never manually re-entered

*(Creates: `money_movements` table.)*

### Story 4.9: Available Balance Ledger

As a **Partner or Owner/Admin**,
I want **withdrawn money not yet used tracked as an Available Balance**,
So that **it's never lost track of between projects**.

**Acceptance Criteria:**

**Given** ₹50,000 allocated to Available Balance in Story 4.7
**When** the allocation is saved
**Then** the Available Balance shows ₹50,000

**Given** an Available Balance of ₹50,000
**When** ₹30,000 is spent into Project C
**Then** the balance decreases to ₹20,000, using the row-lock pattern from AD-10

**Given** an attempt to spend more than the current Available Balance
**When** submitted
**Then** it's rejected — the balance never goes negative (FR29, AD-10)

**Given** two concurrent requests both spending from the same balance
**When** they race
**Then** only the request that doesn't overdraw succeeds — no lost update (AD-10)

*(Creates: `available_balances` table.)*

### Story 4.10: End-to-End Money Trail

As **any authorized viewer**,
I want **every linked transaction reachable as one chain**,
So that **I can trust the system's record of where money went**.

**Acceptance Criteria:**

**Given** the full worked scenario (₹10,00,000 invested → ₹5,00,000 withdrawn → split 3 ways → later ₹30,000 moved from Available Balance to a third project)
**When** the trail is viewed from any single transaction in the chain
**Then** every linked transaction is reachable, forward and backward

**Given** this trail
**When** totals are checked at any point
**Then** they reconcile exactly — nothing double-counted or lost

### Story 4.11: Edit/Cancel a Withdrawal Transaction (Audited)

As an **Owner/Admin**,
I want **to correct or cancel a withdrawal the same way I can for an investment**,
So that **mistakes never require a silent edit or a lost record**.

**Acceptance Criteria:**

**Given** a recorded withdrawal transaction
**When** Owner/Admin edits its details
**Then** the change is saved with a full audit trail (old/new values, who, when) — mirroring Story 3.7

**Given** a recorded withdrawal that's part of a linked bundle (Story 4.8)
**When** Owner/Admin cancels/reverses it
**Then** the cancellation cascades to every record in that bundle — never leaving an orphaned sibling (AD-5)

**Given** a non-Owner/Admin user
**When** they attempt to edit or cancel any withdrawal
**Then** 403

## Epic 4 Summary

11 stories, covering FR21–FR30. All FRs assigned to Epic 4 are addressed. Reuses Epic 3's audit/idempotency/transaction pattern rather than reinventing it.

---

## Epic 5: The Full Picture — History, Adjustments, Dashboards & Reports

Everyone can see their complete, trustworthy financial picture: dashboards, linked Money History, Adjust Next Time, permission-scoped reports, and the audit trail behind any edited transaction.

### Story 5.1: Money History List

As **any authorized user**,
I want **a single plain-language list of every transaction I'm allowed to see**,
So that **I can understand what happened without accounting jargon**.

**Acceptance Criteria:**

**Given** transactions exist across Add Money, Withdraw Money, Movement, and Available Balance actions
**When** an authorized user opens Money History
**Then** they see Date, What Happened (Money Added / Money Withdrawn / Moved to Project B / Given to Person X / Added to Available Balance / Used from Available Balance / Adjustment), Project, Person, Amount, Payment Mode, From, To, Notes

**Given** the list
**When** filtered by date, project, or person
**Then** only matching entries are shown

**Given** a Partner viewing Money History
**When** the list loads
**Then** it's scoped by the same `authorize()`/`authorizeScope()` gate as everywhere else — no entry outside their permitted scope appears (AD-1 extended to a list endpoint)

### Story 5.2: Linked-Transaction Navigation

As **any authorized user**,
I want **to jump between linked transactions**,
So that **I can follow a complete money trail without hunting for it**.

**Acceptance Criteria:**

**Given** a Money History entry that's part of a linked chain (Story 4.8)
**When** opened
**Then** a way to jump to the related linked entries is shown

**Given** the full worked-example chain
**When** followed link by link
**Then** the entire trail from original investment to final remaining balance is reachable

### Story 5.3: Adjust Next Time Page

As a **Partner, Sub-partner, or Owner/Admin**,
I want **to see carried-forward adjustments in plain language, without formulas**,
So that **I understand where I stand at a glance**.

**Acceptance Criteria:**

**Given** Partner A has Extra Paid ₹2,00,000 and Partner C has Pending ₹2,00,000
**When** the Adjust Next Time page loads
**Then** the Investment section shows each clearly ("Next time reduce by ₹2,00,000" / "Next time add ₹2,00,000"), with no formula shown

**Given** Partner B has Keep for Later ₹1,50,000
**When** the same page loads
**Then** the Withdrawal section shows it separately from the Investment section

**Given** both sections
**When** viewed
**Then** Investment and Withdrawal Adjustment are never combined or netted automatically

**Given** an Owner/Admin explicitly performs a netting action between the two
**When** saved
**Then** it's recorded as its own audited transaction type (AD-4), visible in Money History as "Adjustment"

### Story 5.4: Owner/Admin Dashboard

As an **Owner/Admin**,
I want **an uncluttered home view across all my projects**,
So that **I know the overall picture at a glance**.

**Acceptance Criteria:**

**Given** multiple projects with activity
**When** Owner/Admin opens their dashboard
**Then** they see Total Project Money, Total Added, Total Withdrawn, Available Balance, and a partner-wise overview — a handful of cards, not a data dump

### Story 5.5: Partner Dashboard

As a **Partner**,
I want **my own home view**,
So that **I see what matters to me without hunting through the whole system**.

**Acceptance Criteria:**

**Given** a Partner with activity in one or more projects
**When** they open their dashboard
**Then** they see My Projects, My Share %, Money Added, Money Withdrawn, Available Balance, Pending, Extra Paid, Withdrawal Keep for Later, My Sub-partners (per the Story 2.6/2.7 grant), and Money History — scoped to themselves only

### Story 5.6: Sub-partner Dashboard

As a **Sub-partner**,
I want **my own scoped home view**,
So that **I see only what belongs to me**.

**Acceptance Criteria:**

**Given** a Sub-partner with activity
**When** they open their dashboard
**Then** they see the same category of cards as a Partner dashboard, strictly scoped to their own data — no visibility into other Partners or Sub-partners

### Story 5.7: Permission-Scoped Reports

As **any authorized user**,
I want **a set of standard reports scoped to what I'm allowed to see**,
So that **I can review data by project, partner, money type, or payment mode**.

**Acceptance Criteria:**

**Given** the report types (Project Money, Partner, Sub-partner, Money Added, Withdrawal, Available Balance, Money Movement, Payment Mode, Adjustment, Money History)
**When** an authorized user generates any of them
**Then** it returns only data they're permitted to see (`authorizeScope()` extended to report generation)

**Given** a report
**When** filtered by date, project, or person
**Then** results narrow accordingly

### Story 5.8: Report Export

As **any authorized user**,
I want **to export a report**,
So that **I can share or archive it outside the app**.

**Acceptance Criteria:**

**Given** a generated report
**When** exported
**Then** it's available as an Excel file and as a PDF/print-friendly format

**Given** an export
**When** opened
**Then** the exported data matches exactly what was shown on screen — no additional or missing rows

### Story 5.9: Audit History Viewing Surface

As an **Owner/Admin (or a transaction's own Partner/Sub-partner)**,
I want **to see the before/after history behind any edited or cancelled transaction**,
So that **I can trust that nothing changed silently**.

**Acceptance Criteria:**

**Given** a transaction edited in Story 3.7 or 4.11
**When** Owner/Admin views its audit history
**Then** they see who changed it, when, the old value, the new value, and the reason if supplied

**Given** a cancelled/reversed transaction
**When** viewed
**Then** both the original and the reversal record are visible, linked to each other

**Given** a Partner or Sub-partner viewing their own transaction's audit history
**When** permitted per FR41
**Then** they see it; viewing someone else's returns 403

### Story 5.10: Ownership & Money-Flow Structure Diagram

**2026-09-25 addition** — not in the original PRD's FR31-42 range; added per founder request after reviewing a reference diagram (Project → Partners → Sub-partners, boxes connected by lines, each node showing its Share %). Confirmed via a fresh check of `EXPERIENCE.md`/`DESIGN.md`/`epics.md` that no tree/graph ownership view was previously spec'd anywhere — Partner Shares (Epic 2, done) only ever specified a flat indented list (`↳` prefix, one level) with a running-total bar, per `EXPERIENCE.md`'s Component Patterns table.

The founder clarified the reference image is illustrative only: the same box/tree structure must support **three user-selectable view modes**, not just the static percentage shown in the reference:
1. **Percentage** — each node shows Share % (the reference image's own mode) — from `PARTNER_SHARE`/`SUB_PARTNER_SHARE`, no new schema.
2. **Actual Amount** — each node shows that Partner/Sub-partner's actual invested amount to date, reusing Story 3.4's existing per-person Actual Paid computation (`investment-adjustment.ts`) rather than a new aggregation.
3. **Money Flow** — each node/edge shows the *movement* of money over time (investment in, withdrawal out, cross-project movement per Story 4.8), on the same tree skeleton. This mode is the one place this story legitimately overlaps the Money History "trail"/"Trail Quick View" (`DESIGN.md.trail-node`/`trail-branch`) — it should reuse that existing trail data/visual language (box+connector styling) rather than reinvent it, but stays a distinct component from Money History's own trail screen: this is "show me flow *on the ownership tree*," not a replacement for Money History's own chronological trail.

As an **Owner/Admin (or a Partner/Sub-partner viewing their own authorized structure)**,
I want **a visual diagram of a Project's Partner/Sub-partner structure, switchable between Share %, actual amount invested, and money flow**,
So that **I can see whichever picture of the ownership structure I actually need, at a glance, instead of reconstructing it from a flat list or a separate report**.

**Acceptance Criteria:**

**Given** a Project with Partner Shares (and some Partners with Sub-partner Shares)
**When** an authorized user opens its structure diagram
**Then** it renders as connected boxes: the Project as the root, each Partner as a first-level node, and any Sub-partners as second-level nodes branching from their parent Partner — labeled per whichever view mode is currently selected

**Given** the diagram is open
**When** the user switches the view-mode toggle (Percentage / Actual Amount / Money Flow)
**Then** every node relabels accordingly without changing the tree's shape or scope — switching modes is purely a display change, never a different underlying selection

**Given** Percentage mode, and a Partner who has allocated part of their Share % to Sub-partners
**When** their node renders
**Then** it's labeled with their *retained* % ("own, after sub-split"), distinct from a Sub-partner's node, labeled as that Sub-partner's % *of the whole Project* — mirroring `formatSharePercent`/`retainedMessage`'s existing display-only computation from Story 2.3, never a newly stored value

**Given** Actual Amount mode
**When** a node renders
**Then** it shows that person's actual invested amount to date for this Project, sourced from the same computation Story 3.4's Adjustment chip already uses — no new aggregation logic

**Given** Money Flow mode
**When** a node or connecting edge renders
**Then** it reflects real recorded movement (investment/withdrawal/cross-project, per Epics 3-4), reusing the existing trail data rather than a new computation, and clearly indicates direction (in vs. out)

**Given** the user wants to choose what they're looking at
**When** they pick a Project from a selector
**Then** the diagram scopes to that Project's whole structure; **when** they instead pick (or drill into) one specific Partner
**Then** the diagram scopes down to just that Partner and their own Sub-partners, not the Project's other Partners — independent of which view mode is active

**Given** FR7/FR8/AD-1's existing visibility rules (Story 2.4/2.6's precedent: a Partner's Sub-partner split is private)
**When** anyone other than Owner/Admin or that Partner themselves requests a Partner's scoped diagram, in any view mode
**Then** it's refused (403) exactly like Story 2.3's existing Sub-partner-list gate — this diagram is a new read surface over existing data, it never loosens an existing privacy rule

## Epic 5 Summary

10 stories, covering FR31–FR40, the viewing surface for FR41/FR42, and Story 5.10 (2026-09-25 founder addition, no FR number). All FRs assigned to Epic 5 are addressed.


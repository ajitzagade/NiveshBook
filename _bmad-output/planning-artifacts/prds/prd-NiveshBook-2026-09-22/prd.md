---
title: NiveshBook
status: final
created: 2026-09-22
updated: 2026-09-22
---

# PRD: NiveshBook
*Working title — confirm.*

## 0. Document Purpose

This PRD turns the [Product Brief](../../briefs/brief-NiveshBook-2026-09-22/brief.md) and the founder-supplied feature spec into a build-ready requirement set for the UX, Architecture, and Epics/Stories workflows that follow it. It uses Glossary-anchored vocabulary throughout — the same plain-language terms the product itself uses on screen (Should Pay, Extra Paid, Keep for Later) rather than accounting jargon — because the FRs describe user-facing behavior, and that behavior *is* the plain language. Features are grouped; Functional Requirements (FRs) are nested under each and numbered globally (FR-1 through FR-45) so downstream artifacts have stable references. `[ASSUMPTION]` tags mark everything inferred without a direct confirmation from the founder — all are indexed in §11 for one-pass review. FRs are written in the product's own words on purpose: the behavior they describe is stated using the same Glossary terms a user would see on screen, rather than a separate technical description translated from them. Implementation-level detail (deployment mechanics, rejected alternatives, calculation-derivation notes) lives in `addendum.md` alongside this file.

## 1. Vision

NiveshBook is the plain-English system of record for money moving through partnership-run investment projects — real estate developments, joint ventures, family investment groups — where a handful of partners, and often their own private sub-partners, jointly fund and later withdraw from shared projects. Today that tracking happens in spreadsheets and chat threads, redone by hand every funding round, with no real privacy boundary between partners and no reliable trail once money moves between projects.

NiveshBook replaces that with a system where the percentage math, the running record of who paid more or less than their share, and the privacy boundary between partners are all handled automatically and correctly — while the vocabulary stays something a partner with no accounting background can read and trust on sight. Nothing here forces exact behavior: partners can pay late, pay extra, skip a round, or withdraw partially, and the system always knows precisely who is ahead or behind without ever silently changing anyone's ownership share.

It is built from day one as a **product**, not a bespoke app for one business: a single core codebase, configured per client, so a second and third client business can run their own private instance without a rewrite. The interface itself is a deliberate part of that durability — polished enough that partners choose it over falling back to a spreadsheet, and distinctive enough that it never reads as a generic, AI-templated scaffold (§6).

## 2. Glossary

- **Project** — A single funded initiative (e.g. a real estate development) with its own partners, funding rounds, and withdrawals.
- **Partner** — A person or entity with a direct Share % in a Project.
- **Sub-partner** — A person with a share carved out of a Partner's own Share %, expressed as a percentage of the full Project (never as a percentage of the Partner's percentage). One level deep only in v1. `[ASSUMPTION]`
- **Owner / Super Admin** — Full-visibility role: all Projects, all Partners, all money, all reports, user and permission management. Shortened to **Owner/Admin** everywhere else in this document.
- **Project Admin** *(optional role)* — Delegated day-to-day data entry on specific Projects, without Owner-level visibility across all Projects.
- **Share %** — A Partner's or Sub-partner's fixed ownership percentage of a Project. Never changes as a side effect of payment or withdrawal behavior.
- **Add Money** — Recording an actual payment into a Project against a funding requirement.
- **Should Pay** — The amount a Partner/Sub-partner would normally pay this funding round, calculated from Share % × the round's funding requirement (adjusted by any carried-forward balance — see Recommended Amount).
- **Paid Now** — The amount actually paid this round; may be more, less, or none of Should Pay.
- **Extra Paid** — The amount paid above the Recommended Amount for this round (Investment Adjustment, negative direction).
- **Pending** — The amount still owed below the Recommended Amount for this round (Investment Adjustment, positive direction).
- **Recommended Amount** — Should Pay for this round, adjusted by carrying forward the previous round's Pending or Extra Paid. Shown to the user; never enforced.
- **Adjust Next Time** — The page and mechanism showing carried-forward Investment and Withdrawal Adjustments per person.
- **Withdraw Money** — Recording an actual withdrawal of funds from a Project's available-to-withdraw balance.
- **Can Take** — The amount a Partner/Sub-partner would normally be entitled to withdraw this round, from Share % × the Project's amount available for withdrawal (adjusted by carried-forward Withdrawal Adjustment).
- **Take Now** — The amount actually withdrawn this round; may be less than or equal to Can Take, or more with explicit permission (Extra Taken).
- **Keep for Later** — The unwithdrawn portion of Can Take, tracked forward as future entitlement (Withdrawal Adjustment, positive direction).
- **Extra Withdrawal** — The permission-gated act of withdrawing beyond Can Take (see FR-25). The resulting amount is tracked as **Extra Taken**.
- **Extra Taken** — Amount withdrawn above Can Take with Owner/Admin permission (Withdrawal Adjustment, negative direction) — the result of an Extra Withdrawal.
- **Investment Adjustment** and **Withdrawal Adjustment** — Two independent carried-forward balances per person, per Project. Never auto-offset against each other.
- **Available Balance** — Money withdrawn from a Project but not yet sent to another Project or Person; a running balance that can later be spent.
- **Money Movement** — A transfer of previously withdrawn money from Available Balance (or directly from a withdrawal) into another Project, to a Person, or elsewhere.
- **Money History** — The plain-language, filterable log of every transaction: what happened, project, person, amount, mode, from/to, notes.
- **Audit History** — The preserved before/after record of any edit to a financial transaction — who, when, old value, new value, reason.
- **Cancel / Reverse Transaction** — The only sanctioned way to undo a recorded financial transaction; the original record is preserved, never deleted.
- **Client** *(productization sense)* — A separate business (developer, JV group, family office) running its own configured, isolated deployment of NiveshBook.

## 3. Target User

### 3.1 Jobs To Be Done

- **Owner / Super Admin:** "Let me set up a project and know, at a glance, exactly what everyone owes or can withdraw — without doing the percentage math myself, and without worrying I've exposed one partner's private numbers to another."
- **Partner:** "Let me see my own share, what I should pay, what I've paid, what I can withdraw, and trust that my own sub-partner split stays private from my co-partners."
- **Sub-partner:** "Let me see just my own slice — what I owe, what I've paid, what I can take out — with no visibility into anyone else's numbers."
- **Project Admin** *(optional role)*: "Let me enter day-to-day project data without seeing everything the Owner sees across all projects."

### 3.2 Non-Users (v1)

Who this isn't for, and what it isn't trying to do — see §7 Non-Goals for the product's fixed boundaries (no payment processing, not a fundraising platform) and §8.2 Out of Scope for what's deferred (self-serve client onboarding).

### 3.3 Key User Journeys

- **UJ-1. Ravi (Owner) opens a funding round and watches the math happen by itself.**
  - **Persona + context:** Ravi runs Project A, a residential development with three partners. He needs ₹10,00,000 for the next construction phase.
  - **Entry state:** Authenticated as Owner, viewing Project A.
  - **Path:** Ravi opens Add Money → Project A, enters the requirement amount ₹10,00,000, and the system instantly shows Should Pay per partner (A: ₹5,00,000 / B: ₹3,00,000 / C: ₹2,00,000) based on their Share %, split down further for Partner A's own sub-partners.
  - **Climax:** Ravi doesn't calculate anything — the numbers are already right, in front of him, in rupees, before anyone has paid a thing.
  - **Resolution:** Ravi shares the Should Pay numbers with each partner and waits for Paid Now entries. Realizes FR-17, FR-18.

- **UJ-2. Partner A pays more than their share, and the system remembers it for them.**
  - **Persona + context:** Partner A wants to cover a shortfall this round and pays ₹7,00,000 against a ₹5,00,000 Should Pay.
  - **Entry state:** Authenticated as Partner A (or Owner recording on their behalf).
  - **Path:** Owner records the Paid Now amount (₹7,00,000) against Partner A's Should Pay. The system shows **Extra Paid: ₹2,00,000** immediately, and ownership stays at 50% — nothing about Partner A's share changes.
  - **Climax:** Next funding round, Partner A opens Add Money and sees **Normal Share: ₹5,00,000** next to **After Previous Adjustment: ₹3,00,000** — the system already reduced the recommended amount, without being asked, and still lets the Owner type in something else if needed.
  - **Resolution:** Partner A pays the recommended ₹3,00,000 (or any other amount); any new gap again carries forward. Realizes FR-18, FR-19.
  - **Edge case:** If Partner C pays ₹0 that round, the system shows **Pending: ₹2,00,000** for Partner C without blocking the funding round from proceeding with everyone else's payments recorded.

- **UJ-3. Sub1 checks their own numbers and never sees Partner B's.**
  - **Persona + context:** Sub1 is one of Partner A's two private sub-partners (12.5% of the full project each).
  - **Entry state:** Authenticated as Sub1, viewing their dashboard.
  - **Path:** Sub1 sees their own Should Pay, Paid Now, and Pending/Extra Paid, scoped to their 12.5% — and nothing belonging to Partner B or Partner B's own sub-partners.
  - **Climax:** Sub1 tries changing the project URL / partner ID in the browser to see if Partner B's numbers are reachable. The request returns **403 Forbidden** with no data in the response.
  - **Resolution:** Sub1 trusts the app because it enforced the boundary even when tested, not just because the UI didn't show a link. Realizes FR-8, FR-9, FR-10, FR-11.

- **UJ-4. Partner A withdraws and splits the money across three places in one flow.**
  - **Persona + context:** Partner A is entitled to withdraw ₹2,50,000 from Project A's available balance and does so in full, while Partners B and C withdraw nothing this round.
  - **Entry state:** Authenticated as Owner, recording Partner A's withdrawal.
  - **Path:** Owner records the ₹2,50,000 withdrawal, then is prompted **"Where did this money go?"** — splits it as ₹1,50,000 → Project B, ₹50,000 → Person X, ₹50,000 → Available Balance. The form shows **Distributed: ₹2,50,000 / ₹2,50,000 ✓** before it can be saved.
  - **Climax:** The ₹1,50,000 sent to Project B appears there automatically as a linked investment — Owner never re-enters it.
  - **Resolution:** Partners B and C see **Keep for Later: ₹1,50,000** and **₹1,00,000** respectively on their own dashboards — untouched, still tracked, not lost. Realizes FR-22, FR-23, FR-27, FR-28, FR-29.

## 4. Features

### 4.1 Accounts, Roles & Access Control

**Description:** Every user has their own login, scoped by role and by which Projects/Partners/Sub-partners they're associated with. Nothing about access is decided in the frontend — every API call independently re-verifies the logged-in user, their role, and their Project/Partner/Sub-partner association before returning data. Manipulating a URL, ID, or API parameter never grants access; it returns 403.

**Functional Requirements:**

#### FR-1: Login / Logout
User can log in with credentials and log out, ending their session. Realizes account security baseline.

**Consequences (testable):**
- Invalid credentials never reveal whether the username or the password was wrong.
- Logout invalidates the session server-side, not just client-side.

#### FR-2: Forgot / Reset Password
User can request a password reset and set a new password via a time-limited, single-use link.

**Consequences (testable):**
- Reset link expires after a bounded window `[ASSUMPTION: 30 minutes — confirm]`.
- Used or expired links are rejected with a clear message, no silent failure.

#### FR-3: Change Password (authenticated)
Logged-in user can change their own password after confirming the current one.

#### FR-4: Active / Inactive Users
Owner/Admin can mark a user active or inactive; inactive users cannot log in but their historical transactions remain intact and attributed.

**Consequences (testable):**
- Deactivating a user does not alter or hide any transaction they previously created.

#### FR-5: Session Handling
Sessions expire after inactivity and can be revoked by an Owner/Admin (e.g. on role change or account compromise).

**Consequences (testable):**
- Inactivity timeout is 30 minutes. `[ASSUMPTION: confirm]`
- Revoking a session server-side invalidates it immediately — a request already in flight on the client is rejected on its next call.

#### FR-6: Role-Based Access Control
System supports Owner/Admin, Partner, Sub-partner, and optional Project Admin roles, each with a distinct default permission set.

#### FR-7: Project / Partner / Sub-partner Scoped Access — Server-Enforced
Every API/database query independently verifies the logged-in user's role **and** their association to the specific Project, Partner, and Sub-partner records being requested, regardless of what the frontend renders.

**Consequences (testable):**
- Changing a Project ID, Partner ID, Sub-partner ID, or Transaction ID in a request to one the user isn't associated with returns 403, never partial or full data.
- No endpoint relies on the frontend to withhold a menu item or button as its only access control.

#### FR-8: 403 on Unauthorized Access — No Data Leakage
Any unauthorized access attempt (role mismatch, wrong Project/Partner/Sub-partner association, tampered ID) returns HTTP 403 with no data body beyond a generic error.

**Consequences (testable):**
- The privacy test scenario (UJ-3 edge case: Sub1 attempting to reach Partner B's data via ID manipulation) returns 403 with zero fields of Partner B's data present in the response, in every code path (list, detail, export, report).

#### FR-45: Owner/Admin Permissions Management
*(Numbered out of sequence — added during finalization; FR numbers are stable references and are never renumbered once assigned, per §0.)*

Owner/Admin can view and manage the permission grants that gate sensitive actions elsewhere in the product — who can authorize Extra Withdrawal (FR-25), which Partners have enabled Sub-partner visibility (FR-11), and which roles are active for a given deployment (e.g. whether Project Admin is used at all) — from a dedicated Permissions area, distinct from day-to-day user/role assignment (FR-6).

**Consequences (testable):**
- Revoking a permission grant takes effect on the next request for that action — no cached/stale permission state persists past the change.

---

### 4.2 Partner & Sub-partner Privacy

**Description:** Privacy between co-partners in the *same* Project is a first-class requirement, not an artifact of role-based access. Partner A's internal sub-partner split, private transaction detail, available balance, and pending adjustments are invisible to Partner B and vice versa — while Owner/Admin retains full visibility, and each partner may optionally grant their own sub-partners visibility into their own data.

**Functional Requirements:**

#### FR-9: Co-Partner Privacy Boundary
A Partner can never retrieve another Partner's internal sub-partner structure, split percentages, private transaction detail, available balance, or pending/extra-paid adjustments, through any UI path or API call.

**Consequences (testable):**
- Two Partners on the same Project, tested independently, each see only their own Extra Paid/Pending numbers and sub-partner breakdown.

#### FR-10: Sub-partner Own-Data Visibility
A Sub-partner sees only their own Should Pay, Paid Now, adjustments, and withdrawal data — never a sibling Sub-partner's or the parent Partner's full internal split.

#### FR-11: Optional Sub-partner Visibility Grant
A Partner can optionally permit their own Sub-partners to see partner-level context (e.g. total Partner share), without this exposing anything to other Partners. `[ASSUMPTION: exact scope of what's grantable — confirm during UX]`

---

### 4.3 Project Creation & Partner Shares

**Description:** Project creation is deliberately minimal — name and description only. Partner Shares are configured afterward, in a separate step, so creating a project is never blocked on having partner details ready.

**Functional Requirements:**

#### FR-12: Create / Edit Project
Owner/Admin can create a Project with just a Name and Description, and edit either later.

#### FR-13: Add / Edit Partner Shares with 100% Validation
Owner/Admin can add multiple Partners to a Project, each with a Share %, and the system continuously shows the running total against 100%.

**Consequences (testable):**
- Total exactly 100% shows "Total Share: 100% ✓".
- Total under 100% shows "Total is N%. (100-N)% is still remaining."
- Total over 100% shows "Total is N%. Please reduce by (N-100)%."
- Share % supports decimals to at least 2 places (e.g. 33.33%).

#### FR-14: Sub-partner Allocation as % of Full Project
Within a Partner's own share, Owner/Admin (or the Partner, if permitted) can add Sub-partners, each entered and displayed as a percentage of the *full Project* — never as a percentage of the Partner's own percentage.

**Consequences (testable):**
- Entering Sub1 = 12.5% and Sub2 = 12.5% under a Partner with a 50% total share shows "Partner A Total Share: 50%" and "Allocated: 50% ✓" once the Partner's own retained portion plus sub-partner allocations sum to 50%.
- The system never asks for or displays a "percentage of the Partner's percentage" value anywhere in the UI.

---

### 4.4 Add Money — Flexible Investment

**Description:** Owner/Admin creates a funding requirement for a Project; the system calculates each Partner's and Sub-partner's Should Pay automatically from Share %. Actual payment (Paid Now) may be any amount — more, less, or nothing — and never changes ownership. The gap between Should Pay (adjusted for prior history) and what was actually paid is tracked automatically as an Investment Adjustment and carried into the next funding round as a *recommended*, never forced, amount.

**Functional Requirements:**

#### FR-15: Create Investment Requirement
Owner/Admin can create a funding requirement for a Project: amount and date/cycle.

#### FR-16: Auto-Calculate Should Pay
System calculates Should Pay per Partner (Share % × requirement amount) and per Sub-partner (their % of full Project × requirement amount), displayed without requiring any manual math from the user. Realizes UJ-1.

#### FR-17: Record Add Money Transaction
User (or Owner/Admin on their behalf) can record a Paid Now amount against a Should Pay line: Project, Person, Amount, Date, Payment Mode (Cash, Cheque, NEFT, RTGS, IMPS, UPI, Bank Transfer, Other), Reference Number, Notes.

**Consequences (testable):**
- Paid Now accepts any non-negative amount, including 0 and amounts exceeding Should Pay — never blocked or auto-capped.
- Recording a payment never alters the person's Share %.

#### FR-18: Compute Investment Adjustment
For each funding cycle: `New Adjustment = Recommended Amount − Actual Amount`. Positive → **Pending**; negative → **Extra Paid**. Stored per person, per Project, independent of Withdrawal Adjustment. Realizes UJ-2.

**Consequences (testable):**
- Partner A: Should Pay ₹5,00,000, Paid ₹7,00,000 → Extra Paid ₹2,00,000 shown immediately.
- Partner C: Should Pay ₹2,00,000, Paid ₹0 → Pending ₹2,00,000 shown immediately.

#### FR-19: Carry Forward — Recommended Amount
Next funding cycle's Recommended Amount = `Base Amount (Share % × new requirement) + Previous Pending − Previous Extra Paid`, shown alongside the plain Normal Share, and remains freely editable by Owner/Admin when recording the actual payment.

**Consequences (testable):**
- Given the UJ-2 example (A: extra paid ₹2,00,000; C: pending ₹2,00,000) and a new ₹10,00,000 requirement, the system displays A → ₹3,00,000, B → ₹3,00,000, C → ₹4,00,000 as Recommended, and B's Should Pay is unaffected by A's or C's history (adjustments are per-person, not pooled).
- Any remaining gap after the actual amount is entered again carries forward to the following cycle.

#### FR-20: Sub-partner Investment Adjustment (Private)
The same Should Pay → Paid Now → Adjustment → Carry Forward logic applies one level down, privately, within a Partner's own allocation, visible only to that Partner, their own Sub-partners, and authorized Owner/Admin — never to other Partners.

---

### 4.5 Withdraw Money — Flexible Withdrawal

**Description:** Given a Project's amount available for withdrawal, the system calculates each Partner's and Sub-partner's normal Can Take from Share %. Actual withdrawal (Take Now) may be less than or equal to Can Take, tracked as Keep for Later when under; withdrawing more requires explicit Owner/Admin permission and is tracked as Extra Taken against future rounds. No Available Balance entry is created unless money is actually withdrawn.

**Functional Requirements:**

#### FR-21: Auto-Calculate Can Take
System calculates each Partner's/Sub-partner's normal withdrawal entitlement from Share % × Project's available-to-withdraw amount.

#### FR-22: Record Withdrawal Transaction
User (or Owner/Admin on their behalf) can record a Take Now amount: Project, Person, Amount, Date, Payment Mode, Reference Number, Notes.

**Consequences (testable):**
- Recording ₹0 withdrawal is valid and results in the full Can Take being tracked as Keep for Later — no forced withdrawal.

#### FR-23: Compute Withdrawal Adjustment
`Remaining = Can Take − Take Now` → **Keep for Later** when positive. When Take Now exceeds Can Take (with permission, see FR-25) → **Extra Taken**. Independent from Investment Adjustment. Realizes UJ-4.

#### FR-24: Carry Forward — Recommended Available Withdrawal
Next withdrawal cycle: `Recommended Available Withdrawal = Base Entitlement + Previous Keep For Later − Previous Extra Taken`.

#### FR-25: Extra Withdrawal — Permission-Gated
A user may withdraw beyond their current Can Take only with explicit Owner/Admin (or delegated) approval; the excess is recorded as Extra Taken and automatically deducted from future withdrawal availability. `[ASSUMPTION: only Owner/Admin can grant this in v1, not Project Admin — confirm]`

**Consequences (testable):**
- An Extra Taken withdrawal cannot be recorded without an authorization step distinct from the normal withdrawal entry.

#### FR-26: Sub-partner Withdrawal (Private, Independent)
Sub-partners withdraw independently of each other and of the parent Partner — one Sub-partner withdrawing in full does not force or block another's withdrawal.

---

### 4.6 Money Destination, Movement & Available Balance

**Description:** Once money is actually withdrawn, the system asks where it went, and a single withdrawal may be split across multiple destinations. Moving money into another Project auto-links a withdrawal, a movement, and an investment record as one action — never a duplicate manual entry. Money not immediately used is tracked under Available Balance until spent.

**Functional Requirements:**

#### FR-27: Post-Withdrawal Destination Allocation
After an actual withdrawal, user allocates the amount across one or more destinations: another Project, a Person, Available Balance, or Other. Realizes UJ-4.

**Consequences (testable):**
- The form blocks save until the sum of allocated amounts equals the withdrawn amount, shown as "Distributed: ₹X / ₹Y" with a clear ✓ once matched.

#### FR-28: Auto-Linked Cross-Project Movement
When a destination is "another Project," the system automatically creates and links: (1) the withdrawal record in the source Project, (2) a money-movement record, and (3) an investment record in the destination Project — as a single user action.

**Consequences (testable):**
- The user never manually re-enters the same amount as a separate investment in the destination Project.
- The three linked records are mutually navigable (from either Project, the full chain is reachable).

#### FR-29: Available Balance Ledger
System maintains a running Available Balance per relevant scope (Project-sourced, tracked to the person/entity holding it), incremented when a withdrawal is allocated there, decremented when spent into a Project or given to a Person.

**Consequences (testable):**
- Balance never goes negative; spending more than the current Available Balance is rejected, not silently allowed.

#### FR-30: End-to-End Money Trail
Every transaction — investment, withdrawal, movement, balance use — remains linked back to its origin, reconstructable as a single chain regardless of how many times it moved.

**Consequences (testable):**
- The full worked example (₹10,00,000 invested → ₹5,00,000 withdrawn → split 3 ways → ₹30,000 later moved from Available Balance to a third Project) is fully traceable from either end of the chain.

---

### 4.7 Money History

**Description:** This is a single, plain-language, filterable transaction log — deliberately not called a "ledger" anywhere in the UI.

**Functional Requirements:**

#### FR-31: Money History List
Filterable list showing Date, What Happened (Money Added / Money Withdrawn / Moved to Project B / Given to Person X / Added to Available Balance / Used from Available Balance / Adjustment), Project, Person, Amount, Payment Mode, From, To, Notes.

#### FR-32: Linked-Transaction Navigation
Each Money History entry that's part of a linked chain (per FR-28/FR-30) surfaces a way to jump to the related entries.

---

### 4.8 Adjust Next Time

**Description:** This is one page making carried-forward adjustments visible without accounting formulas — split into an Investment section and a Withdrawal section, per person.

**Functional Requirements:**

#### FR-33: Adjust Next Time Page
Shows, per person: Should Pay / Paid / Extra Paid or Pending / "Next time reduce or add by ₹X" (Investment section), and Can Take / Taken / Keep for Later (Withdrawal section).

#### FR-34: Independent Adjustment Balances
Investment Adjustment and Withdrawal Adjustment are never automatically netted against each other; only an explicit Owner/Admin action can offset one against the other, and that action is itself audited (FR-41).

---

### 4.9 Dashboards

**Description:** These are role-scoped and deliberately uncluttered — a handful of cards, not a data dump.

**Functional Requirements:**

#### FR-35: Owner/Admin Dashboard
Shows Total Project Money, Total Added, Total Withdrawn, Available Balance, and a partner-wise overview, across all Projects the Owner/Admin has access to.

#### FR-36: Partner Dashboard
Shows My Projects, My Share %, Money Added, Money Withdrawn, Available Balance, Pending, Extra Paid, Withdrawal Keep for Later, My Sub-partners (if permitted per FR-11), Money History — scoped to that Partner only.

#### FR-37: Sub-partner Dashboard
Shows the same category of cards as the Partner dashboard, scoped strictly to that Sub-partner's own data — no visibility into other Partners or Sub-partners.

---

### 4.10 Reports

**Functional Requirements:**

#### FR-38: Permission-Scoped Report Set
System provides Project Money, Partner, Sub-partner, Money Added, Withdrawal, Available Balance, Money Movement, Payment Mode, Adjustment, and Money History reports, each returning only data the requesting user is authorized to see (per §4.1/§4.2 rules).

#### FR-39: Report Filtering
Reports support filtering by Date, Project, and Person.

#### FR-40: Export
Reports can be exported to Excel and to PDF/print.

---

### 4.11 Audit History

**Description:** Financial data never changes silently. Every edit preserves the full before/after picture; deletion is never permanent.

**Functional Requirements:**

#### FR-41: Immutable Audit Trail
Every edit to a financial transaction (amount, details) preserves: who created it, who changed it, date/time of change, old value, new value, and reason if supplied.

**Consequences (testable):**
- An edited transaction's audit history is visible to Owner/Admin and, where relevant, to the transaction's own Partner/Sub-partner.

#### FR-42: Cancel / Reverse, Never Hard Delete
Financial transactions are never hard-deleted; correcting one requires a Cancel/Reverse action that preserves the original record and creates a linked reversal.

---

### 4.12 Productization & Client Configuration

**Description:** NiveshBook is built as a single core codebase deployable per client, configured rather than forked. `[ASSUMPTION: one dedicated deployment per client, not a shared multi-tenant database — see brief's Productization Approach, to be confirmed at Architecture]`

**Functional Requirements:**

#### FR-43: Per-Client Configuration Layer
A new client's deployment is configured — branding, currency, locale/number formatting, enabled modules/roles (e.g. whether Project Admin is used) — without any code change specific to that client.

**Consequences (testable):**
- Deploying a second client with different branding and currency requires only configuration changes, verified by diffing the deployed application code between two client instances.

#### FR-44: Default Currency & Locale
Default currency/locale is INR with Indian digit grouping (₹10,00,000-style), overridable per client at configuration time. `[ASSUMPTION]`

## 5. Cross-Cutting NFRs & Constraints

*System-wide quality attributes that apply across every feature in §4, not owned by any single one.*

**Security & Access**
- Every access-control rule in §4.1/§4.2 (FR-7, FR-8, FR-9, FR-10) applies uniformly across every endpoint, report, export, and background job — there is no code path where the frontend is trusted as the sole gate.
- No permission decision is ever inferred from client-supplied data (a role name or flag sent by the client is never trusted without a server-side lookup).

**Data Integrity & Transaction Safety**
- All monetary values use decimal-safe storage and arithmetic (fixed-point / smallest-currency-unit integers, or a DECIMAL database type) — never native floating point. See addendum for derivation detail.
- Share %, Should Pay, Can Take, and every adjustment calculation support at least 2 decimal places (e.g. 33.33%).
- Financial updates that touch more than one record (e.g. recording a payment and updating its Investment Adjustment; a withdrawal split across multiple destinations per FR-27) are atomic — a partial failure leaves no record in an inconsistent state.
- No duplicate transactions: resubmitting the same Add Money / Withdraw Money action (e.g. a double form submit) does not create two records.
- No negative or otherwise invalid balances: Available Balance (FR-29) and any entitlement calculation reject an operation that would drive a balance negative, rather than allowing and flagging it after the fact.

**Reliability**
- Every screen that loads data, submits a transaction, or shows a list has defined loading, error, and empty states — never a blank or frozen screen with no feedback.

**Privacy Guardrail**
- The co-partner privacy boundary (FR-9, FR-10) is treated as a security requirement with the same rigor as authentication — not a display preference that could regress if a future feature forgets to filter it.

**Performance & Scale** `[ASSUMPTION: thresholds below — confirm or replace at Architecture]`
- Expected data volume per client deployment is small-to-medium: dozens of Projects, a handful of Partners/Sub-partners each, hundreds to low thousands of transactions per Project over its lifetime — not a big-data or high-throughput system.
- Dashboards, Money History, and report views return in under 2 seconds at that data volume.
- Concurrency needs are modest: a handful to a few dozen users per client deployment working at once, not a high-concurrency public system — the atomicity requirements above (no duplicate transactions, no negative balances) matter more than raw throughput.

## 6. Aesthetic, Tone & Information Architecture

*Covers how the product communicates and is navigated — as load-bearing as the functional requirements, per the founder's explicit "not accounting jargon, not AI-generated" requirements.*

**Voice & Tone**
- All user-facing copy uses the Glossary terms (§2) verbatim and never introduces accounting-register synonyms (no "Capital Contribution," "Ledger," "Entitlement," etc. anywhere in the UI, even in tooltips or error messages).
- Every action whose outcome depends on a calculation (Should Pay, Can Take, adjustments, share validation) is accompanied by a short worked example or helper text at the point of use — e.g. "Share 50% means if the project needs ₹10,00,000, your normal share is ₹5,00,000." This is a product requirement, not a nice-to-have; FR-16, FR-18, FR-21, FR-23 are not considered complete without it.
- Confirmation messages after any financial action are explicit and in plain language (e.g. "₹2,00,000 added to Project A for Partner A" rather than a generic "Success").

**Visual Restraint**
- Avoid: complicated/multiple charts and graphs, excessive modals, more than a handful of fields on one screen, complex nested tables, technical database terminology anywhere in the UI.
- Prefer: clean light interface, large readable amounts, short labels, simple status tags, searchable dropdowns with a clear icon to remove/change a selected value.

**Design & Feel** `[ASSUMPTION]`
Beyond visual restraint, the interface must read as deliberately and distinctively designed — smooth interactions, considered typography and spacing, a fresh identity per client's branding — and specifically must **not** read as a generic, default-component, AI-templated interface. This carries forward the Product Brief's flagged Productization/Design assumption; no concrete visual reference has been supplied yet (see Open Question 1) — Sally (UX) needs at least one anchor ("closer to X than Y") before this is actionable.

**Indian Currency Formatting**
All amounts display with the ₹ symbol and Indian digit grouping (₹10,00,000, not ₹1,000,000) by default, per FR-44.

**Information Architecture**
Main navigation: Home, Projects, Partner Shares, Add Money, Withdraw Money, Available Balance, Adjust Next Time, Money History, Reports. Owner/Admin additionally see Users, Permissions, Audit History. Per FR-7, a menu item never appears for a role/user that isn't authorized to use it — this is IA guidance, not a substitute for the server-side check.

## 7. Non-Goals (Explicit)

- NiveshBook does not process payments or move real money — it records what happened (amount, mode, reference) after the fact, outside the app.
- Not a fundraising or investor-discovery platform — closed, invite-only per Project.
- Not a shared multi-tenant SaaS in v1 (see §4.12 for the chosen per-client deployment model). `[ASSUMPTION]`
- Not a native mobile app in v1 — responsive web only.
- Not sub-partner nesting beyond one level (see Glossary, §2).

## 8. MVP Scope

### 8.1 In Scope

- Everything in §4.1 through §4.12 above (FR-1 through FR-45).
- One real client deployment at launch, built on a configuration layer proven by config (not code) to support a second client later.

### 8.2 Out of Scope for MVP

- Self-serve client signup/onboarding — deferred; v1 onboarding is manual. `[NOTE FOR PM: revisit once 2+ clients are active and onboarding manually becomes a bottleneck]`
- Payment gateway / automated payment collection integration.
- Sub-partner-of-a-sub-partner nesting.
- Native mobile apps.
- Automated netting between Investment and Withdrawal Adjustments (kept manual/explicit per FR-34).

## 9. Success Metrics

**Primary**
- **SM-1**: A first-time Partner or Sub-partner, given their dashboard and no explanation, correctly states what they owe or can withdraw in a usability check. Validates FR-16, FR-18, FR-21, FR-23, FR-36, FR-37.
- **SM-2**: Zero cross-partner data exposures across the full privacy test scenario (UJ-3 edge case, run against every Partner/Sub-partner pairing on a multi-partner Project). Validates FR-7, FR-8, FR-9, FR-10.
- **SM-3**: 100% of transactions in the founder's original worked end-to-end scenario (invest → withdraw → split three ways → later move from Available Balance) are traceable start to finish through Money History. Validates FR-27, FR-28, FR-29, FR-30, FR-31, FR-32.
- **SM-4**: Ownership Share never changes automatically across any adjustment scenario, verified across every Investment and Withdrawal Adjustment case in the founder's original worked examples. Validates FR-16 through FR-26.
- **SM-5**: Zero hard-deleted financial transactions across the system; 100% of edits carry a complete before/after audit record. Validates FR-41, FR-42.

**Secondary**
- **SM-6**: A second client can be configured and deployed with zero client-specific code changes. Validates FR-43, FR-44.
- **SM-7**: The interface reads as deliberately designed and distinctive — not generic or templated — confirmed by qualitative user reaction during UX review, not a design-system checklist alone. Validates the Design & Feel constraint (§6).

**Counter-metrics (do not optimize)**
- **SM-C1**: Approval friction on Extra Taken/Extra Withdrawal should not be reduced by weakening the permission gate — the gate is a safety control, not UX debt. Counterbalances FR-25.
- **SM-C2**: Transaction-entry speed should not be improved by trimming audit capture (who/when/old/new) — completeness of the audit trail outweighs entry speed. Counterbalances FR-41, FR-42.

## 10. Open Questions

1. What visual/design reference should Sally (UX) aim for on "not generic/AI-templated"? No specific reference app named yet, even a rough one ("closer to X than to Y") — resolve before or during `bmad-ux`, since §6's Design & Feel constraint isn't actionable for a designer without it.
2. Should Project Admin ship in v1, or can it be deferred given the spec marks it optional? Affects FR-6 scope.
3. Exact password-reset link expiry window (FR-2) — defaulted to 30 minutes pending confirmation.
4. Exact scope of what a Partner can optionally expose to their own Sub-partners (FR-11) — needs a concrete example during UX.
5. Any jurisdiction-specific compliance considerations (e.g. real estate partnership regulations in the target market) beyond what's specified here.

## 11. Assumptions Index

- §8.2 — v1 onboarding is assisted by the product owner, not self-serve.
- §2 / Glossary — Sub-partner nesting stops at one level.
- §4.2 FR-11 — exact scope of optional Partner→Sub-partner visibility grant.
- §4.5 FR-25 — only Owner/Admin (not Project Admin) can grant Extra Withdrawal permission in v1.
- §4.1 FR-2 — password reset link expiry defaulted to 30 minutes.
- §4.1 FR-5 — session inactivity timeout defaulted to 30 minutes, pending confirmation.
- §4.12 — per-client deployment model (one instance per client, not shared multi-tenant DB) — carried from the Product Brief's flagged Productization Approach assumption.
- §4.12 FR-44 — default currency/locale is INR with Indian digit grouping.
- §5 — Performance/scale thresholds (small-to-medium data volume, sub-2-second views, modest concurrency) are provisional, to be confirmed or replaced at Architecture.
- §6 — Design & Feel: distinctive, non-generic interface required, pending a concrete visual reference (Open Question 1) — carried from the Product Brief's flagged Design & Feel assumption.
- §7 — v1 is not a shared multi-tenant SaaS.

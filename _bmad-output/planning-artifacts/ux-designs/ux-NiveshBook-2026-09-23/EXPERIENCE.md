---
name: NiveshBook
status: draft
sources:
  - _bmad-output/planning-artifacts/prds/prd-NiveshBook-2026-09-22/prd.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-NiveshBook-2026-09-22/ARCHITECTURE-SPINE.md
updated: 2026-09-23
---

# NiveshBook — Experience Spine

> Draft, reconciled against a founder-provided screen-mockup artifact covering all 11 screens (`imports/founder-mockup.html`) plus PRD §3.3/§6, NFR1-19, and the architecture spine. Component behavior below is grounded in that mockup where it shows one; anything the static mockup can't demonstrate (real interactions, empty/error states, the exact mobile collapse) stays `[ASSUMPTION]` pending a founder look. Paired with `DESIGN.md` (visual identity). Spines win on conflict with any mock or import.

## Foundation

Single-surface responsive web app. shadcn/ui on Next.js 16 (App Router) + Tailwind CSS + React 19 supplies interactive primitives (Dialog, Sheet, Popover, Combobox) the static mockup can't show; every visual token (color, radius, shadow, type) is sourced from the mockup, not shadcn's defaults — see `DESIGN.md`. Multi-tenant by deployment, not by UI: each `client.config` (AD-7) is a fully separate deployment — there is no cross-client switcher in the product itself. Within one deployment, a user's role (Owner/Admin, Partner, Sub-partner, optional Project Admin) and their Project/Partner/Sub-partner associations scope everything they see; the server is the only source of truth for that scope (AD-1) — the UI never invents a visibility rule the API doesn't also enforce. The mockup's sidebar "Viewing as" role switcher is prototype-only demo scaffolding and must not be built into the product (`DESIGN.md.Components`).

## Information Architecture

Fixed sidebar nav, per NFR18 — exact item list, never reordered per role, only filtered:

| Surface | Visible to | Purpose |
|---|---|---|
| Home | Everyone | Role-scoped dashboard (Owner/Admin, Partner, or Sub-partner variant — FR-35/36/37) |
| Projects | Everyone (scoped to their Projects) | List + create/edit (Owner/Admin only edits) |
| Partner Shares | Everyone (scoped) | View own share; Owner/Admin edits and validates against 100% |
| Add Money | Everyone (scoped) | Should Pay, Paid Now entry, Investment Adjustment |
| Withdraw Money | Everyone (scoped) | Can Take, Take Now entry, destination split |
| Available Balance | Everyone (scoped) | Running balance not yet moved on |
| Adjust Next Time | Everyone (scoped) | Investment + Withdrawal Adjustment, side by side, never netted |
| Money History | Everyone (scoped) | Plain-language transaction log, money-trail navigation |
| Reports | Everyone (scoped) | Permission-scoped report set, filter + export |
| Users | Owner/Admin only | Activate/deactivate, role assignment |
| Permissions | Owner/Admin only | Role-level approval authority, enabled-modules view |
| Audit History | Owner/Admin only | Before/after record behind any edited transaction |

A nav item is **rendered only** when the user's role/scope allows it (FR-7/FR-8) — never shown disabled or greyed. A Partner or Sub-partner never sees Users/Permissions/Audit History at all, not even as a locked item, since a visible-but-blocked item still leaks that the feature exists.

Sidebar is fixed at 236px above 860px (the mockup's own breakpoint); collapses below that, per `DESIGN.md.Layout & Spacing` — the mockup stacks it bare, `[ASSUMPTION]` the real build upgrades this to a `Sheet` triggered from a top bar.

## Voice and Tone

Microcopy only — brand posture lives in `DESIGN.md.Brand & Style`. Source: PRD §6, which treats this as load-bearing, not a nice-to-have.

| Do | Don't |
|---|---|
| "₹2,00,000 added to Project A for Partner A" | "Success!" / a generic confirmation toast |
| "Share 50% means if the project needs ₹10,00,000, your normal share is ₹5,00,000" (worked example, always visible at point of use) | A bare calculated number with no explanation of how it was derived |
| "Pending: ₹2,00,000" | "Overdue," "Outstanding," "Capital Contribution," "Ledger," "Entitlement," or any accounting-register synonym not in PRD §2 Glossary |
| PRD Glossary terms verbatim, everywhere including errors/tooltips | Inventing a shorter/friendlier synonym for a Glossary term |
| Same tone regardless of role — Owner/Admin, Partner, Sub-partner all get the same plain language | A more "technical" register for Owner/Admin screens |

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Status chip | Money History, Add/Withdraw Money, dashboards | One of `success`/`danger`/`info`/`violet`/`neutral` (see `DESIGN.md.Colors` — mapped to transaction/adjustment meaning, not a generic state). Always paired with a label + amount, never a bare color dot. |
| Stat card / wallet hero | Home dashboard, Available Balance | Stat card: label + value, optionally colored. Wallet hero: the one gradient card, one per product (Available Balance only), the single largest number on screen. |
| Amount display | Everywhere a monetary value renders | Always ₹ + Indian grouping + tabular-nums (`.num` pattern) via one shared formatting component — no ad hoc `{number}` interpolation anywhere in the UI. |
| Worked-example hint | Should Pay, Can Take, Share % validation, any adjustment field | Always visible at point of use, not a hover tooltip (PRD §6 treats this as required, not optional; mockup's Add Money screen shows this exact pattern: "Share 50% means if the project needs ₹10,00,000, Partner A's normal share is ₹5,00,000"). |
| Data table with sub-rows | Partner Shares, Add Money, Withdraw Money, Projects list | Right-aligned numeric columns, first column left-aligned. One indent level only (`↳` prefix) for a sub-partner under a Partner — table-foot note discloses when a sub-split is private ("Partner A's sub-partner split is private — Partner B and Partner C never see these rows"). |
| Share row + distributed check | Partner Shares (create/edit shares), Withdrawal Destination split | Editable percent/amount inputs in a row list, always paired with a running total bar ("100% ✓" / "Distributed: ₹X / ₹Y ✓") — save/next disabled until it matches exactly. Same component powers both Partner Shares validation (FR-13) and Withdrawal Destination (FR-27, UJ-4). |
| Searchable combobox | Project/Partner/Sub-partner/Person pickers | shadcn-supplied (mockup uses plain text inputs, doesn't demonstrate this). Type-to-filter; a clear ("×") affordance once a value is selected (NFR15). Never a bare native `<select>` for a list that can exceed ~8 items. |
| Adjust person card | Adjust Next Time | Investment and Withdrawal render as two side-by-side cards, never merged (PRD: adjustments are independent, never netted) — each person gets one card with a resolution chip. |
| Trail (vertical) + trace banner | Money History detail, linked-transaction navigation (FR-32) | Vertical timeline, one colored dot per node (color = that node's transaction type). A trace banner ("Trace ID: FLOW-A-1024... all child transactions retain their original withdrawal relationship") sits above the trail when tracing a specific chain (FR-28, FR-30). `[ASSUMPTION]` exact trigger to enter trace mode from a list row is undecided — mockup shows it as a static example, not an interaction. |
| Report tile | Reports | Icon badge + name + one-line description, in a 3-up grid — one tile per report type (FR-38). |
| Empty state | Any list/dashboard with no data yet | shadcn's empty pattern + one NiveshBook-specific sentence in Glossary vocabulary. Single primary action where one exists (e.g. "Create your first Project"). Not shown in the mockup (all screens are pre-populated) — `[ASSUMPTION]` copy per surface. |

## State Patterns

Every screen that loads data, submits a transaction, or shows a list defines all four (NFR8) — no exceptions.

| State | Treatment |
|---|---|
| Loading | shadcn `Skeleton` matching the expected layout (dashboard tiles, table rows) — never a bare spinner for a data-shaped surface. |
| Empty | See Component Patterns → Empty state. |
| Error | Inline, in plain language, next to the thing that failed — never a raw stack trace or API error code (AD-1's 403 responses render as "You don't have access to this" with no further detail, per FR-8's no-leakage rule). |
| Success / confirmation | Explicit plain-language toast naming the amount, project, and person (Voice and Tone table) — never a bare "Success." |
| Permission denied | Nav item hidden entirely (IA section); a direct/guessed URL hit returns a plain "You don't have access to this" surface, no data, no hint at what would have been there (FR-8, UJ-3's climax beat). |
| Stale / concurrent edit | `[ASSUMPTION]` not specified in PRD — flagged for a follow-up decision once Epic 3/4 (money-moving) screens are built; AD-10's row-lock means a concurrent write can't corrupt data, but the UI-level "someone else just changed this" messaging is undecided. |

## Interaction Primitives

Mouse/touch-first — NiveshBook's users are Owners, Partners, and Sub-partners checking numbers, not power users driving a command palette. No keyboard-shortcut surface is specified; standard tab-order + Enter-to-submit form conventions apply.

**Banned everywhere:** more than one chart/graph per screen, modal stacks more than one level deep, dense multi-field forms (PRD §6: "a handful of fields" per screen), complex nested tables (NFR15).

## Accessibility Floor

Behavioral; visual contrast lives in `DESIGN.md` (inherits shadcn's WCAG AA defaults; brand color overrides — primary blue, five status colors — must be checked against `background`/`card` at AA before this leaves draft `[ASSUMPTION]`).

- WCAG 2.2 AA across the responsive web surface.
- Status is never color-only — every status chip carries a text label (Voice and Tone), satisfying color-blind and screen-reader users identically.
- Tab order matches visual/reading order on every surface; focus rings inherit shadcn's `ring` token.
- Screen reader announces the current surface and its role-scope on navigation (e.g. "Add Money, Project A, Partner view").
- Amount fields announce their formatted value (₹, grouped) to assistive tech, not the raw numeric input value.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| `≥ 860px` (mockup's own breakpoint) | Sidebar visible and fixed at 236px. Dashboard stat rows: 4-up (then 3-up for the second row); Reports: 3-up. |
| `760–859px` | Stat-card and report-tile grids drop to 2-up / 1-up (mockup's own inner breakpoints). |
| `< 860px` | Sidebar collapses. Mockup stacks it bare above content; `[ASSUMPTION]` real build uses a `Sheet` from a top bar instead (NFR19: usable, not just present, on mobile — a bare stack pushes nav below the fold on a phone). Money History's trail/table should become a stacked-card list below `md`, not horizontally-scrolling. |

NFR19 requires desktop/tablet/mobile usability across the whole product, not a reduced mobile feature set — Partners/Sub-partners checking their numbers on a phone is a primary use case, not an edge case.

## Key Flows

Names and beats mirror PRD §3.3 verbatim.

### Flow 1 — Ravi opens a funding round and watches the math happen by itself (UJ-1)

1. Ravi (Owner) opens Add Money for Project A, enters the requirement amount ₹10,00,000.
2. The screen instantly computes and displays Should Pay per partner (A: ₹5,00,000 / B: ₹3,00,000 / C: ₹2,00,000), each with a worked-example hint showing the Share %-to-amount math, further split for Partner A's own sub-partners.
3. **Climax:** Ravi does nothing but enter one number — every partner's amount is already correct, in rupees, in front of him, before anyone has paid.
4. He shares the numbers and the screen sits ready for Paid Now entries as they come in.

### Flow 2 — Partner A pays more than their share, and the system remembers it (UJ-2)

1. Owner records Partner A's Paid Now (₹7,00,000) against a ₹5,00,000 Should Pay.
2. A `status-chip[success]` "Extra ₹2,00,000" appears immediately next to Partner A's row (mockup: Add Money screen); Share % on the Partner Shares screen is untouched.
3. Next round, Partner A opens Add Money and sees two amounts side by side: "Normal Share: ₹5,00,000" and "After Previous Adjustment: ₹3,00,000."
4. **Climax:** The recommended amount is pre-filled but editable — Partner A can pay it, more, or less; any new gap carries forward the same way.
5. Edge case: if Partner C pays ₹0, their row shows `status-chip[danger]` "Pending ₹2,00,000" and the round proceeds unblocked for everyone else.

### Flow 3 — Sub1 checks their own numbers and never sees Partner B's (UJ-3)

1. Sub1 (one of Partner A's sub-partners, 12.5% of the full project) opens their dashboard.
2. They see only their own Should Pay/Paid Now/Pending-or-Extra-Paid, scoped to 12.5% — Partner B and Partner B's sub-partners never appear, not even as a greyed row.
3. Sub1 edits the URL to try reaching Partner B's data directly.
4. **Climax:** The request returns the plain "You don't have access to this" state (State Patterns → Permission denied) — no partial data, no 500 error, no hint of what would have been there. FR-8's no-leakage rule holds even under direct manipulation, not just because the UI didn't link there.

### Flow 4 — Partner A withdraws and splits the money across three places in one flow (UJ-4)

1. Owner records Partner A's ₹2,50,000 withdrawal, then is prompted "Where did this money go?" (Component Patterns → Distribution confirmation).
2. Owner splits it: ₹1,50,000 → Project B, ₹50,000 → Person X, ₹50,000 → Available Balance. The running indicator reads "Distributed: ₹2,50,000 / ₹2,50,000 ✓" once complete; Save stays disabled until it matches.
3. **Climax:** The ₹1,50,000 appears in Project B automatically as a linked investment, connected via the money trail — Owner never re-enters it, and clicking either end of the trail jumps to the other.
4. Partners B and C, who withdrew nothing this round, see `status-chip[violet]` "₹1,50,000" and "₹1,00,000" (Keep for Later) respectively on their own dashboards — visibly still tracked, not lost.

# Epic 2 Context: Projects, Partner Shares & Privacy

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Owner/Admin can create a project with just a name and description, then — in a separate step — set up its Partner Shares with a validated Share % that's continuously checked against a 100% running total, then split any partner's share privately among their own sub-partners as a percentage of the *full project* (never "percentage of the partner's percentage"). The co-partner and sub-partner privacy boundary is enforced from the moment this ownership data exists: a Partner can never see another Partner's structure or private detail, and a Sub-partner sees only their own data, with an optional per-Partner grant to let their own sub-partners see partner-level context. This epic delivers a complete, correctly-validated, correctly-private ownership structure that Epic 3 (Add Money) depends on for its Should Pay math. It extends Epic 1's `authorize()`/`authorizeScope()` gate to Project/Partner/Sub-partner-scoped resources rather than building a second access-control mechanism.

## Stories

- Story 2.1: Create and Edit a Project
- Story 2.2: Add & Edit Partner Shares with 100% Validation
- Story 2.3: Sub-partner Allocation as % of Full Project
- Story 2.4: Co-Partner Privacy Boundary
- Story 2.5: Sub-partner Own-Data Visibility
- Story 2.6: Optional Partner→Sub-partner Visibility Grant
- Story 2.7: Partner-Specific Permissions View

## Requirements & Constraints

- A Project is created with just Name and Description; no partner information is required to save, and both fields are editable afterward. Empty name is blocked with a clear validation message.
- Partner Shares show a continuously-visible running total against 100%, with explicit over/under messaging (e.g. "Total is 90%. 10% is still remaining." / "Total is 110%. Please reduce by 10%." / "Total Share: 100% ✓"). Share % supports at least 2 decimal places (e.g. 33.33%) — the underlying storage precision goes further (see Technical Decisions).
- A Sub-partner's share is always entered and displayed as a percentage of the *full project*, never as a percentage of their parent Partner's share — this is a hard UX/calc rule, not just a display preference.
- A Partner can never retrieve another Partner's sub-partner structure, split percentages, private transaction detail, balance, or adjustments — via UI or direct URL/ID manipulation, identically. A Sub-partner sees only their own data, with the same no-leakage rule under direct manipulation.
- A Partner may optionally grant their own Sub-partners visibility into partner-level context; this is opt-in, reversible, takes effect immediately in both directions, and never exposes anything to Partners/Sub-partners outside that Partner's own tree.
- Owner/Admin is exempt from the co-partner privacy boundary by design — always has full visibility.
- Unauthorized access of any kind returns HTTP 403 with no data body beyond a generic error, including for list-style endpoints.
- The Permissions area (built in Epic 1, Story 1.7) gets one more view here: per-Partner visibility-grant status, alongside the existing role-level permissions. Owner/Admin-only.
- Money-math correctness (2+ decimal share percentages, largest-remainder rounding) is exercised starting in Epic 3, but the share data model built here must support it precisely — no float storage.

## Technical Decisions

- Creates three tables this epic depends on: `projects` (2.1), `partner_shares` (2.2), `subpartner_shares` (2.3).
- Extends the single `authorize()` (single-resource) / `authorizeScope()` (list/report) gate from Story 1.5 with Project/Partner/Sub-partner-scoped `resourceRef`s — no second access-control mechanism is introduced. The visibility grant from Story 2.6 is evaluated *inside* `authorize()`/`authorizeScope()` itself, never as a bolted-on check after the fact. Every check re-reads live permission/grant data — nothing is cached on the session row. A denied request returns 403 with no data body beyond a generic error.
- `sharePercent` (on both `partner_shares` and `subpartner_shares`) is a distinct, column-scoped, versioned value: immutable once set for an effective period — editing an existing share after transactions exist against it creates a new versioned row with an effective-from date rather than overwriting in place. This matters for every story in this epic that allows editing a share (2.2, 2.3). Other columns on the same row (e.g. a future visibility-grant flag) aren't bound by this immutability — only `sharePercent` is. Every future Investment/Withdrawal transaction snapshots the `sharePercent` effective at calculation time onto the transaction row itself, rather than recomputing it live from current state — foundational for Epic 3/4.
- All IDs are UUID v7. Money/percentage values are never native floats: they cross a nominally-branded `Money`/percentage value type at every boundary (DB row, domain function, API response, UI prop) and go through one designated decimal-math module — no ad hoc `+`/`-`/`*` or `Number()`/`parseFloat` on a monetary or percentage value elsewhere. Percentages store at least 4 decimal digits (supports 33.3333%), even though this epic doesn't yet perform arithmetic on them — that starts in Epic 3's largest-remainder split logic, which this data model must already support precisely.
- Dependency direction is enforced by lint: `apps/web` → `{core, db, ui, types}`; `packages/db` → `{core, types}`; `packages/core` → `{types}` only. Any Project/Partner/Sub-partner domain logic (validation, share-total checks) belongs in `packages/core`, not inlined in a Route Handler.
- Naming mirrors PRD Glossary terms verbatim in code (`sharePercent`, etc.) so product and code vocabulary don't drift.

## UX & Interaction Patterns

- Projects, Partner Shares, and the Permissions view all sit behind the fixed sidebar nav (never reordered per role, only filtered — a nav item is omitted entirely for a role that can't access it, never shown disabled, since a visible-but-blocked item would itself leak that the feature exists).
- Partner Shares (and Sub-partner allocation) reuse the **Share row + Distributed/Allocated check** component pair already built in `packages/ui/src/components/share-row.tsx` (`ShareRow`/`ShareList`: name + editable input + optional action, in a list) and `distributed-check.tsx` (`DistributedCheck`: a label + running-total status bar, e.g. "100% ✓"). These were built speculatively during the design pass and have no consumer yet in the app — Story 2.2 is their first real usage. Save stays disabled until the total reconciles exactly. This same pair also powers the Withdrawal Destination screen in Epic 4 ("Distributed: ₹X / ₹Y ✓") — the validation behavior (block save until it matches) is shared, not epic-specific, so changes to these components affect both epics.
- The Partner Shares / Sub-partner table uses the existing **data table with sub-rows** pattern: right-aligned numeric columns, sub-partners shown one indent level under their Partner with a `↳` prefix and smaller muted text (never a second indent level), plus a table-foot note disclosing that a sub-split is private ("Partner A's sub-partner split is private — Partner B and Partner C never see these rows").
- Every calculation-adjacent field (Share % here; Should Pay/Can Take later) needs a worked-example hint visible at point of use, not a hover tooltip — this epic's analog is explaining what a Share % means in plain terms as it's entered. This pattern is now confirmed against the founder's actual mockup (it was previously missing there and has since been added), not just a prose requirement.
- Permission-denied state is a plain "You don't have access to this" surface with no data and no hint of what would have been there — this is the concrete behavior Story 2.4/2.5's 403s must render as in the UI, not just an API-level status code.
- All copy uses Glossary terms verbatim (e.g. "Share %", never "equity" or "ownership stake"); confirmation messages are explicit and plain-language, not generic toasts.
- Empty state (e.g. a Project with no Partner Shares yet) uses the shared empty-state pattern: one Glossary-vocabulary sentence plus a single primary action where one exists.

## Cross-Story Dependencies

- Within Epic 2, dependencies follow the FR ordering: **2.1 (Project) → 2.2 (Partner Shares) → 2.3 (Sub-partner allocation)** — a project must exist before partners can be added to it, and a Partner Share must exist before it can be split among sub-partners. **2.4 (co-partner privacy) and 2.5 (sub-partner visibility)** depend on Partner/Sub-partner records existing (2.2/2.3) — the privacy boundary has nothing to scope until those records exist. **2.6 (visibility grant)** depends on 2.5 (Sub-partner visibility must exist before a grant can selectively lift part of it). **2.7 (Partner-specific Permissions view)** depends on 2.6 (there must be a grant to list) and extends Epic 1 Story 1.7's Permissions area rather than creating a new one.
- Epic 2 extends the `authorize()`/`authorizeScope()` gate built in Epic 1 Story 1.5 — it is a hard prerequisite, not just prior art.
- Epic 3 (Add Money) depends on this entire epic: Should Pay calculations require finalized, versioned Partner/Sub-partner shares, and Epic 3's requirement creation flow assumes Partner Shares already exist on the project.

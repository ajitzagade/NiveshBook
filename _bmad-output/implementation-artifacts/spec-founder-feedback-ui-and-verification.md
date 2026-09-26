---
title: 'Founder Feedback: Button Tints, Hierarchy Indent, Split Scroll, All Investments, Scenario Verification'
type: 'feature'
created: '2026-09-26'
status: 'in-review'
route: 'dispatch'
baseline_commit: '433f3512a27e3165e9722ae30084e9b6432bc053'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Founder review found: flat action buttons; sub-partner rows carry a "↳" glyph but (on most screens) no indentation, hiding the partner→sub-partner hierarchy; sidebar and content scroll as one page; no cross-project "All Investments" view; the Home dashboard renders flat list sections instead of scannable cards; and no seeded sub-partner credentials nor verified production scenario data to manually validate data visibility and the money trail.

**Approach:** Centralize per-action button tinting (subtle tone border + soft hover fill) and sub-partner indentation in `packages/ui`; lock the dashboard shell to viewport height with independently scrolling panes; add an "All Investments" entry to the Projects dropdown backed by a new self-scoped `/api/my-investments` route reusing the Money History cross-project pattern; then seed the scenario catalog into production through real app workflows, create partner/sub-partner accounts, and deliver credentials plus a seeded/missing/untested/issues verification report.

## Boundaries & Constraints

**Always:** AD-1 — new route calls `authorizeScope()` before touching data. Colors only from existing tokens.css tones; hover fills use the `-soft` tints, never saturated bases. Sub-partner responses contain only that user's own slice (FR10). New/changed `packages/ui` sizing verified by computed style in a real build, not eyeballed (AGENTS.md). Production data written only through real app workflows (login + API/UI), never direct SQL. All existing tests stay green — no regressions.

**Never:** No schema migrations. No business-logic changes to adjustments/netting/money trail. Don't rework `StructureCanvas` (already a true tree layout). Don't add hierarchy indent to Money History/Reports tables — their row shapes carry no parent linkage; out of scope. Don't hand-roll buttons/empty states in `apps/web`.

**Decisions:**
1. Button tone mapping follows DESIGN.md's canonical nav-badge map: Add Money→success, Withdraw→danger, Shares→info, Edit/default→accent, Structure/Available Balance→violet; destructive Cancel→danger; neutral Cancel/Back keeps plain ghost.
2. All Investments shows, per project where the actor holds a current partner or sub-partner share: project name, role, share %, and per-requirement own status (should-pay, paid, pending/extra, recommended) — owner_admin sees all projects/parties. Route: `/all-investments`, reached from the Projects dropdown (plus direct URL).
3. Sub-partner indent = one level (24px) via a new `isSub` prop; glyph retained.
4. Scenario source (confirmed 2026-09-26): repo `scenario-catalog-2026-09-23.html` + `money-flow-flowcharts-2026-09-23.html` are the authoritative checklist (claude.ai artifact not shared; founder approved substitution).
5. Production writes approved (2026-09-26): seed scenarios + create accounts on the production DB through real app workflows; data persists (cancellations are audited reversals).
6. Credentials (approved 2026-09-26): persona emails `firstname.lastname@niveshbook.test`, one strong shared password delivered in the final report, founder rotates after review.
7. Spec size: founder accepted the full ~2,700-token spec over splitting (second confirmation after the intent-level keep-all choice).
8. Dashboard cards (added by founder 2026-09-26 mid-implementation): the Home dashboard's list-style sections (all three role variants) become a 2-column card grid (1 column below 860px) built from `packages/ui` `Card`/`StatCard`; cards get soft shadow elevation and a subtle hover animation (small lift + shadow transition, ~150-200ms ease). Elevation/hover styling lives in `packages/ui` (new Card capability, not hand-rolled per page), stays subtle per DESIGN.md tokens, no new colors.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All Investments, partner | partner with shares in 2 of 4 projects | only those 2 projects, own numbers only | N/A |
| All Investments, sub-partner | sub-partner in 1 project | that project, own slice only; no sibling/parent figures | N/A |
| All Investments, owner_admin | any | all projects, all parties | N/A |
| All Investments, no shares | authenticated user, zero current shares | `EmptyState` | N/A |
| Unauthenticated | no session | 401 / redirect to login | generic error |
| Narrow viewport | <860px single-column | page scrolls as one (no locked shell) | N/A |

</frozen-after-approval>

## Code Map

- `packages/ui/src/styles/tokens.css` -- `.nb-btn` (~96), `.nb-btn-ghost` (no hover today); `@theme` tone pairs (`--color-success`/`-soft`, danger, info, accent, violet); `@source "../";` present
- `packages/ui/src/components/button.tsx` -- `Button` variants `primary|ghost`; add `tone` prop
- `packages/ui/src/components/share-row.tsx`, `split-row.tsx`, `adjust-person-card.tsx` -- render caller-supplied name/label verbatim; NO indent/`isSub` prop exists; add one
- `packages/ui/src/components/table.tsx:21-25` + `tokens.css:185` -- `subRow` → `nb-sub-row` (24px `padding-left`) — the existing indent precedent to match
- Glyph `↳` is baked into name strings by callers at 6 sites: `shares/page.tsx:519` (already wrapper-indented `ml-5 border-l pl-3`), `add-money/page.tsx:923`, `withdraw-money/page.tsx:1103`, `available-balance/page.tsx:291` (already `subRow`-indented), `StructureCanvas.tsx:68` (canvas, leave), `destination-picker.tsx:92` (dropdown option, leave)
- `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.test.tsx:263-264,446-447,614-615` -- asserts `↳` text and row layout; will need updating with the indent change
- `apps/web/app/(dashboard)/layout.tsx` -- shell grid :208-219 (`min-h-screen`, no overflow control) — the whole scrolling fix
- `apps/web/app/(dashboard)/projects/page.tsx` -- :108-132 five ghost action buttons (tone call sites; pattern repeats across add-money, withdraw-money, shares, available-balance, money-history, adjust-next-time, reports, structure pages)
- `apps/web/app/(dashboard)/ProjectSwitcher.tsx` -- dropdown items :53-57; add "All Investments" entry
- `apps/web/app/api/money-history/route.ts` + `packages/core/src/money-history.ts` (`resolveMoneyHistoryScope` :60-85) -- the cross-project self-scoping pattern to mirror
- `packages/core/src/partner-share.ts:186` `listAllCurrentPartnerShares`, `subpartner-share.ts:213` `listAllCurrentSubPartnerShares` -- reuse; no new ports needed
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/my-investment-status/route.ts` -- per-requirement status computation to reuse in the aggregator
- `packages/db/src/seed.ts` -- only seeds one owner_admin (`owner@niveshbook.test`/`changeme123` defaults); no scenario seeding exists

## Tasks & Acceptance

**Execution:**
- [x] `packages/ui/src/styles/tokens.css` -- add `.nb-btn-ghost` hover + `.nb-btn-tone-{accent,success,danger,info,violet}` (1px tone-tinted border; hover: `-soft` background) -- central styling, flows to the raw `nb-btn-ghost` button in reports too
- [x] `packages/ui/src/components/button.tsx` -- add optional `tone` prop appending `nb-btn-tone-*` -- Open/Closed: new variant, no caller breaks
- [x] `packages/ui/src/components/share-row.tsx`, `split-row.tsx`, `adjust-person-card.tsx` -- add `isSub?: boolean` applying 24px left inset (match `nb-sub-row` precedent)
- [x] `apps/web` action-button call sites -- pass `tone` per Decision 1 (projects, add-money, withdraw-money, shares, available-balance, money-history, adjust-next-time, reports, structure pages)
- [x] Sub-row call sites -- pass `isSub` wherever `↳` is baked into the name: `add-money/page.tsx:923`, `withdraw-money/page.tsx:1103` (+ its layout test assertions), `shares/page.tsx:519` (align existing wrapper indent to 24px), `adjust-next-time/page.tsx` (wire from existing "Sub-partner of X" roleLabel data); leave StructureCanvas + destination-picker as-is
- [x] `apps/web/app/(dashboard)/layout.tsx` -- `h-screen overflow-hidden` shell, `overflow-y-auto` on aside+main, `max-[860px]` reverts to single scroll
- [x] `packages/core/src/my-investments.ts` + test -- assembler: filter `listAllCurrent*Shares` by actor (owner_admin: all), join per-requirement own status via existing computation
- [x] `apps/web/app/api/my-investments/route.ts` + test -- `authorizeScope` gate mirroring money-history; returns assembler output
- [x] `apps/web/app/(dashboard)/all-investments/page.tsx` + test; `ProjectSwitcher.tsx` entry -- render Decision 2 shape with `PageHeader`/`EmptyState`/existing components
- [x] `packages/ui/src/components/card.tsx` + `tokens.css` -- add elevation/hover capability to `Card` (soft shadow, hover lift + shadow transition ~150-200ms) per Decision 8 -- beware the 2026-09-24 Card-padding gotcha: measure, don't eyeball
- [x] `apps/web/app/(dashboard)/home/page.tsx` + `page.test.tsx` -- convert list sections (all three role variants) to a 2-column card grid (1-col <860px) using the enhanced `Card`/`StatCard`
- [x] Playwright/computed-style measurement -- verify border/hover colors, 24px indent, independent scroll, card shadow/hover-transition values and grid columns in a real build
- [ ] Scenario seeding + verification (per Decisions 5-6) -- execute catalog scenarios through real workflows incl. multi-role pool (personas as sub in one project, partner in another), extra withdrawal, split destinations, cross-project movement, edits/cancels; log in as each created sub-partner and record visibility checks; write report: seeded+tested / missing / implemented-untested / issues, plus credentials

**Acceptance Criteria:**
- Given any list screen with sub-partners, when rendered, then sub rows sit 24px right of partner rows (Shares, Add Money, Withdraw, Adjust Next Time, Partner dashboard) — measured, not eyeballed
- Given a ghost action button, when hovered, then its background is the mapped `-soft` tint and border the tone color; non-hover border subtly tinted; primary buttons unchanged
- Given viewport ≥860px, when main content scrolls, then the sidebar stays put (and vice versa)
- Given the Home dashboard at ≥860px for any role, when rendered, then its sections lay out as cards two per row with measurable shadow elevation, and hovering a card animates lift/shadow; below 860px the grid is one column
- Given a sub-partner session, when calling `/api/my-investments` (UI or curl), then response contains zero other-party names or amounts
- Given the verification report, when the founder logs in with provided credentials, then every listed scenario is reachable exactly as reported

## Implementation Notes

- 2026-09-26: all execution tasks except production scenario seeding implemented and verified. Judgment calls within Decision 1's map: money-history "View Audit History", both filter-form "Clear" buttons, adjust-next-time "Net Adjustment", and reports' raw Export button take `accent` (default action); the structure page's view-mode toggles take `violet` (Structure family; tone classes are scoped to `.nb-btn-ghost` so the active toggle's primary variant is untouched); dialog Cancel/Close and Back buttons stay plain ghost (neutral). `adjust-next-time` wires `isSub` from each entry's own `partyType` (no `roleLabel` field exists -- the Code Map's reference was approximate).
- Partner `shouldPay` in the All Investments status is `ownShouldPay` (own-retained), never the pooled Partner+Sub-partners total -- it's the amount `adjustmentType`/`adjustmentAmount` are actually computed against (`PartnerInvestmentAdjustment.ownShouldPay`). A Project failing `computeShouldPay`'s preconditions yields `status: null` per requirement (rendered as "Not computable yet"), never a 500 across the whole cross-project list.
- Home dashboard (Decision 8): each section's list items became elevated `Card`s (`PartnerOverviewCard` reshaped; new `DashboardGridCard` keeps `ShareRow`'s `name`/`input`/`action` slot shape) in a `grid-cols-2 gap-4 max-[860px]:grid-cols-1` wrapper; `AdjustPersonCard`/`ShareRow`/`ShareList` no longer used on this page. Stat-card rows unchanged (they're not list-style sections and are 3/4-up by design).
- New `authorize.ts` action `my_investments:list` (plain multi-role grant mirroring `money_history:list`); per-entry scoping lives in `assembleMyInvestments()`.
- Playwright computed-style measurements (real `next build` + `next start` against local Postgres, `scratchpad/measure.mjs` + `measure-shares.mjs`): 22/22 passed -- all 5 tone resting borders + hover fills match their exact `--color-*`/`--color-*-soft` token rgb values; ShareRow `isSub` delta exactly 24px (withdraw-money); shares-page wrapper indent exactly 24px (12px margin + 1px border + 11px padding); AdjustPersonCard `isSub` delta 24px (adjust-next-time); shell `overflow: hidden` at viewport height with both panes `overflow-y: auto` at 1200px, reverting to single scroll at 700px; home grid 2 tracks at 1200px / 1 track at 700px; elevated card resting shadow = `--shadow-card`, hover = `translateY(-2px)` + `--shadow-card-hover`, transition `box-shadow, transform 0.18s`; Card padding still 20px (the 2026-09-24 gotcha); `GET /api/my-investments` 200 in 124ms with 22 entries (NFR10).
- NOT done: production scenario seeding + persona accounts + credentials/verification report (Decisions 4-6) -- requires the production deployment URL and owner credentials, which this session did not have. Everything else is ready for that pass; `/api/my-investments` was exercised end-to-end against the local production build instead.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: clean, all suites green
- `pnpm build` -- expected: no client-bundle/core import breaks
- Playwright script (scratchpad) measuring `getBoundingClientRect`/computed styles -- expected: 24px indent delta; tone border/hover colors match tokens

**Manual checks (if no CLI):**
- All Investments returns <2s at expected volume (NFR10)
- Founder-side: log in as each provided account; verify visibility matrix and money-trail navigation

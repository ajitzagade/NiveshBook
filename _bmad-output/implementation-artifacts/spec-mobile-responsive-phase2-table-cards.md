---
title: 'Mobile Responsive Phase 2: Table-to-Card Layouts for Dense List Screens'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
baseline_commit: '14d3c5856da2c6dee5017d421f42e2d60937b106'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Five screens render dense multi-column tables (`Table`'s own `overflow-x-auto` prevents clipping but not poor UX): Projects (3 cols, 5 inline buttons in one cell), Money History (10 cols), Audit History (7 cols), Reports (6 distinct table shapes, 3-9 cols each), All Investments (6-col nested table per project card). On a phone these force constant horizontal scrolling to read a single row.

**Approach:** Add one new `packages/ui` primitive — a "row card" (title + badge/accessory + stacked label:value fields + optional action), generalizing the `{label, value}` shape `AdjustPersonCard` already established. Below 860px, each screen renders a stack of these cards instead of its table; at/above 860px, the existing table is unchanged. Both renders exist in the DOM simultaneously, switched by the same CSS-only `max-[860px]:`/`min-[861px]:` convention Phase 1 used for the nav drawer vs. desktop sidebar — no JS breakpoint detection, no hydration-mismatch risk.

## Boundaries & Constraints

**Always:** The new card primitive lives in `packages/ui`, not hand-rolled per page. Every field/action currently in a table row is preserved in its card equivalent — no silent data loss (inline buttons, badges, row-click navigation all carry over). Desktop (≥860px) table rendering stays pixel-identical — verified via computed style, not assumed. All existing tests stay green.

**Never:** No backend/API changes — this is rendering-only. No change to Reports' Export (Excel/PDF) — it already operates on the underlying data, not the DOM. Don't touch Phase 1's drawer/dialog/grid work. Don't redesign All Investments' outer `Card`/tint (Decision 5 only touches its nested per-requirement rows).

**Decisions:**
1. New primitive name: `RowCard` (`packages/ui/src/components/row-card.tsx`) — `{ title: ReactNode, badge?: ReactNode, fields: { label: string; value: ReactNode }[], action?: ReactNode, onClick?: () => void }`. Reuses `AdjustPersonCard`'s established `label`/`value` field shape rather than inventing a new one.
2. Money History and Reports' `EntryRowsTable` share field structure (9 of Money History's 10 columns are identical) — extract one shared field-mapping helper both consume, avoiding duplicating the row→card logic twice.
3. Row-click-to-trace-mode (Money History) and any inline action buttons carry over verbatim onto the card (`onClick`/`action` slot) — a mobile user loses no capability a desktop user has.
4. Projects' 5-button action cell: on the card, actions render in a `flex flex-wrap` row (mirrors `PersonCard`'s established wrap-safe pattern from the prior UI batch) rather than being trimmed or hidden.
5. All Investments: only the per-requirement nested table rows convert to `RowCard`s inside the existing outer `Card`; the outer Card/tint/header is untouched.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Phone width, any of the 5 screens | <860px | rows render as a vertical `RowCard` stack, no horizontal scroll needed to read one row | N/A |
| Desktop width | ≥860px | today's `Table` renders unchanged, `RowCard` stack not in the accessible/visible tree | N/A |
| Money History row click (mobile) | tap a non-adjustment-type card | same trace-mode navigation as desktop row click | N/A |
| Money History audit action (mobile) | tap "View Audit History" on a card | same dialog opens, same stopPropagation from the card's own onClick | N/A |
| All Investments requirement with null status (mobile) | `requirement.status === null` | card shows the same "Not computable yet…" fallback text, no crash | N/A |
| Empty list, any screen | zero rows | existing `EmptyState` renders once (not duplicated for table+card renders) | N/A |

</frozen-after-approval>

## Code Map

- `packages/ui/src/components/adjust-person-card.tsx` -- the `AdjustLine`/`lines` shape to generalize into `RowCard`'s `fields`
- `packages/ui/src/components/table.tsx` -- confirmed no responsive/card variant exists; doc comment explicitly notes tables differ too much in shape for one generic `columns` prop (informs Decision 1's per-screen field mapping, not a table-driven abstraction)
- `apps/web/app/(dashboard)/projects/page.tsx` -- 3-col table, 5-button action cell (Edit/Shares/Add Money/Withdraw Money/Structure, each pre-toned per the prior UI batch)
- `apps/web/app/(dashboard)/money-history/page.tsx` -- 10-col table (Date, What Happened, Project, Person, Amount, Payment Mode, From, To, Notes, Audit); row-click → trace-mode content swap (excluded for `adjustment`-type rows); "Audit" column's inline button only for `money_added`/`money_withdrawn` rows, stops row-click propagation
- `apps/web/app/(dashboard)/audit-history/page.tsx` -- 7-col table (Date, Type, Action, Actor, Amount, Reason, Linked), non-interactive, server component
- `apps/web/app/(dashboard)/reports/[type]/page.tsx` -- `ReportTable` switch over 6 table components: `PaymentModeTable` (3 cols), `ProjectMoneyTable` (4), `PartnerTable`/`SubPartnerTable` (6 each), `AvailableBalanceTable` (3), `EntryRowsTable` (9 cols, default branch for 5 report types -- same shape as Money History minus Audit)
- `apps/web/app/(dashboard)/all-investments/page.tsx` -- per-project `Card` (`tint={entry.role}`) already established; nested 6-col table per card (Requirement Date, Requirement Amount, My Should Pay, Paid, Status, Recommended); `status: null` → merged-cell fallback text

## Tasks & Acceptance

**Execution:**
- [ ] `packages/ui/src/components/row-card.tsx` (new) + test -- `RowCard` per Decision 1; `packages/ui/src/index.tsx` export
- [ ] `apps/web/app/(dashboard)/projects/page.tsx` + test -- below-860px `RowCard` stack (title=Name, fields=[Description], action=the 5 existing toned buttons, flex-wrap); table unchanged ≥860px
- [ ] `apps/web/lib/money-history-row-card.ts` (new, or similar shared helper) -- the field-mapping function Decision 2 requires, consumed by both money-history and reports' `EntryRowsTable`
- [ ] `apps/web/app/(dashboard)/money-history/page.tsx` + test -- below-860px `RowCard` stack using the shared helper + the Audit action slot + row-click trace-mode preserved
- [ ] `apps/web/app/(dashboard)/audit-history/page.tsx` + test -- below-860px `RowCard` stack (non-interactive, matching today's table)
- [ ] `apps/web/app/(dashboard)/reports/[type]/page.tsx` + test -- below-860px `RowCard` stack for all 6 table shapes (5 report types reuse the shared helper from money-history; the other 5 get their own small field mapping: PaymentMode/ProjectMoney/Partner/SubPartner/AvailableBalance)
- [ ] `apps/web/app/(dashboard)/all-investments/page.tsx` + test -- nested per-requirement rows become `RowCard`s below 860px inside the existing outer `Card`; outer Card/tint/header unchanged
- [ ] Playwright computed-style pass -- at 375px/414px each of the 5 screens shows cards not tables, no horizontal page overflow; at ≥860px each shows its table unchanged (computed-style diff against baseline); Money History's trace-mode and audit-dialog behaviors work from a tapped card

**Acceptance Criteria:**
- Given any of the 5 screens with real data, when viewed <860px, then every field visible in the desktop table row is present on its card equivalent — verified per screen, not assumed from the mapping existing
- Given Money History <860px, when a non-adjustment card is tapped, then trace mode opens exactly as it does today from a desktop row click
- Given the Projects screen <860px, when a project card renders, then all 5 action buttons are reachable (wrapped, not clipped or hidden)
- Given any screen ≥860px, when rendered, then the layout is byte-for-byte unchanged from before this spec

## Implementation Notes

- 2026-09-26 review pass: 16 findings across 3 layers triaged (see Review Triage Log) — 9 patches applied and re-verified (keyboard accessibility on the clickable RowCard, className assertions on all 5 screens' CSS breakpoint wiring — previously the feature's entire mechanism was untested, "—" field-parity fallbacks on Money History/Audit History, field-key collision fix, AGENTS.md reuse-list addition, data-testid naming consistency, All Investments extra-paid card test, and a real Playwright computed-style measurement of RowCard's new sizing values against a production build), 1 deferred (dual-mount DOM cost — matches Phase 1's already-accepted identical pattern), 6 rejected with evidence. `apps/web/next-env.d.ts`'s auto-generated dev-tooling diff excluded from the commit (not a code change, same as Phase 1). Full gate re-run green: lint (0 violations), typecheck, 71-file/1015-test suite, build.

## Spec Change Log

## Review Triage Log

2026-09-26 review pass 1 (blind-hunter BH, verification-gap VG, edge-case-hunter EC):
- VG **the CSS breakpoint wiring itself (`max-[860px]:hidden`/`hidden max-[860px]:block`) is unverified in every committed test across all 5 screens** — jsdom never evaluates CSS, so both branches are always present in the tree regardless of correctness; a swapped/dropped class ships with CI green — **high, pre-verified, matches this repo's own established `layout.test.tsx`/`home/page.test.tsx` pattern for the identical concern → patch**: add one className assertion per screen's wrapper divs.
- BH+EC clickable `RowCard` has no `role="button"`/`tabIndex`/`onKeyDown`, and drops the desktop `title` hint — the mobile card is the *primary* touch target and is currently unreachable via keyboard/assistive tech — **high, two independent confirmations → patch**.
- BH+VG Audit History's "Reversed" badge is unverified on the mobile card, and the one existing broad `JSON.stringify(result)` assertion would still pass even if the card's badge logic broke (satisfied by the always-present desktop `<Td>` alone) — **medium (VG pre-verified) → patch**: add a per-card assertion with a `linkedTransactionId` fixture.
- EC Money History's Audit action slot omits desktop's "—" fallback for non-auditable rows (the whole action row doesn't render, vs. desktop showing "—") — **low → patch**: add the "—" fallback for literal field-parity with the spec's own "no silent data loss" boundary.
- EC Audit History's "Linked" column similarly omits a "—" fallback when not reversed — **low → patch**: same fallback treatment, for consistency with the Money History fix above.
- EC `RowCard` field rows keyed by `label` alone — two same-labeled fields would collide — **low → patch**: key by `${label}-${index}`.
- BH `RowCard` not added to AGENTS.md's canonical `packages/ui` reuse list — **low → patch**: one-line addition.
- BH `report-row-cards` `data-testid` doesn't match the `<route>-row-cards` pattern used by the other 4 screens — **low → patch**: rename to `reports-row-cards`.
- BH All Investments: the "Extra Paid + amount" branch is untested on the mobile card (only the amount-less "Pending" case is) — **low → patch**: add the missing test case.
- BH new fixed-size values in `row-card.tsx` (font sizes, padding, margin) lack the explicit computed-style measurement AGENTS.md mandates for new `packages/ui` sizing — **medium → patch**: one Playwright computed-style assertion on `RowCard`'s key dimensions, folded into re-verification.
- BH `RowCard`'s own unit tests call it as a bare function and walk the returned tree rather than using `render`+`@testing-library/react` — **false**: matches the established, deliberate, repo-wide `packages/ui` test convention (no jsdom/testing-library deps in that package by design — confirmed in this same initiative's earlier batch, which added this pattern for `button.test.tsx`/`card.test.tsx`/`person-card.test.tsx`/`share-row.test.tsx` for the identical reason).
- BH shared helper's column order has no meta-test guarding drift between it and the two tables' own column definitions — **low → reject**: the shared-helper extraction is itself the fix for drift; no demonstrated near-term harm beyond ordinary refactor risk present everywhere.
- BH no committed test for narrow-width tappability/overlap beyond class-presence — **low → reject**: live Playwright verification already covered this per the implementation's own report; matches this initiative's established convention of not committing scratch Playwright checks (Phase 1, batches 1-2 same treatment).
- BH no doc comment on a hypothetical future per-row side-effect double-firing from the dual-mount — **reject**: speculative, no current code triggers it.
- EC desktop ≥860px "pixel-identical" claim has no committed Playwright/computed-style test in this diff — **low → reject**: structurally low-risk (an unstyled wrapping div around unchanged `<Table>` JSX, same pattern Phase 1 used for the desktop `<aside>`); matches this initiative's established uncommitted-live-verification convention, already performed per the implementation's own report.
- BH dual-mount (table + card stack always both rendered) DOM-node cost under NFR10 — **low → defer**: matches Phase 1's identical, already-accepted dual-mount pattern (`MobileNav`'s second `SidebarShell`); no fetch/compute cost added (same in-memory data, no extra requests), fix would mean a rendering-strategy redesign trading away the CSS-only hydration-safety this initiative deliberately chose.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: clean, all suites green
- `pnpm build` -- expected: clean
- Playwright script (scratchpad) at 375px/414px/900px across all 5 screens -- expected: card vs. table visibility matches the I/O matrix; ≥860px pixel-identical to baseline; Money History trace/audit interactions work from cards

**Manual checks (if no CLI):**
- Founder-side: browse each of the 5 screens on an actual phone or device emulation; confirm no field feels "missing" compared to the desktop table

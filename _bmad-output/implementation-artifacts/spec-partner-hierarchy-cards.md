---
title: 'Partner/Sub-partner Hierarchy Cards: Nested + Role-Tinted, and Action-Column Crop Fix'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
baseline_commit: 'b24a96f501d517466966300ea02c30272266f7ac'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Founder review (screenshots 2026-09-26 PM): (a) on Partner Shares, action buttons overflow and clip past the card edge — the "Sub-partners" button is cropped invisible; (b) partner/sub-partner hierarchy still reads poorly — the founder wants each partner as its own card with their sub-partners as cards inside it, visually connected, and role identifiable at a glance from card styling alone.

**Approach:** Add a role-tinted `PersonCard` capability to `packages/ui` (light tinted border+background per role; sub-partner cards nest inside their parent partner card behind a colored connector rail — containment replaces literal drawn lines per the founder-approved hybrid). Apply it to every screen rendering partner/sub-partner lists. Fix `ShareRow`'s fixed 70px action track so wide action sets can never clip.

## Boundaries & Constraints

**Always:** Colors from existing tokens.css tones only — light `-soft` tints for backgrounds so text stays readable; role tinting and nesting live in `packages/ui`, never hand-rolled per page. New/changed sizing and colors verified by computed style in a real build. All existing tests stay green. Data shapes, APIs, and authorization untouched — this is presentation only.

**Never:** No schema/API changes. No literal SVG/absolute-positioned connector lines in list screens (that's `StructureCanvas`'s paradigm — leave it as-is). No new color families. Don't regress the batch-1 tone buttons, indents, card grid, or scroll behavior.

**Decisions:**
1. Hybrid design (founder-approved 2026-09-26): hierarchy = containment (sub cards INSIDE the partner card) + role tint; the partner→sub connection is a colored left rail on the nested sub section, not drawn lines.
2. Role palette from the established role colors (StatusChip/nav precedent): partner cards = `info` family (teal: `--color-info-soft` background tint, `--color-info`-tinted border); sub-partner cards = `violet` family. Partner-to-partner separation = distinct cards with standard spacing.
3. Crop fix: `ShareRow`'s action track becomes content-sized (`auto`), so action sets can never paint past the card edge; rows keep their alignment via the existing name/input tracks.
4. Screens in scope (the verified full inventory): Partner Shares, Add Money, Withdraw Money, Adjust Next Time, Home dashboard (Partner-dashboard My Sub-partners + owner Partner-wise Overview), All Investments. Out of scope: StructureCanvas (already a tree), destination-picker dropdown options, Money History/Reports tables (no parent linkage in row shapes — unchanged from batch 1).
5. The batch-1 24px indent inside nested sections is superseded where nesting itself conveys hierarchy; keep the `↳` glyph in names only where a flat row remains.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partner with subs | shares/add-money/withdraw screens | partner card (teal tint) containing violet sub cards behind a colored rail | N/A |
| Partner without subs | any list screen | plain teal-tinted partner card, no empty nested section | N/A |
| Sub-partner actor's own views | adjust-next-time, all-investments, sub dashboard | their cards violet-tinted — role obvious without a parent card present | N/A |
| Wide action set | Shares row: Edit + "Sub-partners (n)" | fully visible inside the card at 1200px and 900px widths | N/A |
| Narrow viewport | <860px | cards stack, nested structure preserved, no horizontal overflow | N/A |

</frozen-after-approval>

## Code Map

- `packages/ui/src/components/card.tsx`, `share-row.tsx` (`ShareRow` grid `grid-cols-[1fr_110px_70px]` :21 — the crop cause; `ShareList` :32), `adjust-person-card.tsx`, `tokens.css` (`@theme` tone pairs; `.nb-card*`; batch-1 `.nb-btn-tone-*`) -- add `PersonCard`/role-tint capability here
- `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` -- partner `ShareRow`s :470-497 (action = Edit + Sub-partners buttons, the cropping set); expanded sub block :500-530 (`ml-3 border-l pl-[11px]` wrapper) → nested sub cards
- `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` -- per-partner expandable block :818+ (`border-l pl-3`), partner ShareRow + sub ShareRows :920s, sub ancillary wrappers `ml-7` (batch-1) → partner card containing sub cards
- `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx` -- `ShareList` :1037-1146, partner ShareRow :1048, nested sub `ShareList` :1096-1141 → same conversion; `page.test.tsx` asserts `ml-6`/`↳` (update to new structure)
- `apps/web/app/(dashboard)/adjust-next-time/page.tsx` -- `AdjustPersonCard` with batch-1 `isSub` → role tint via new prop
- `apps/web/app/(dashboard)/home/page.tsx` -- `DashboardGridCard`/`PartnerOverviewCard` + My Sub-partners `ml-6` grid → role tints; sub cards violet
- `apps/web/app/(dashboard)/all-investments/page.tsx` -- per-entry `Card` with role `StatusChip` → add matching card tint by `entry.role`
- Batch-1 tests to update: `withdraw-money/page.test.tsx`, `add-money/page.test.tsx`, `adjust-next-time/page.test.tsx`, `home/page.test.tsx` indent assertions; `packages/ui` class-emission tests extend to the new props

## Tasks & Acceptance

**Execution:**
- [ ] `packages/ui/src/styles/tokens.css` -- `.nb-person-card`, `.nb-person-card-partner` (info-soft bg tint, info-tinted border), `.nb-person-card-sub` (violet equivalents), `.nb-person-nest` (nested section: colored left rail `--color-info`→`--color-violet` gradient or violet rail, inset padding)
- [ ] `packages/ui/src/components/person-card.tsx` (new) -- `PersonCard { role: "partner" | "sub_partner", header slots (name/badge/value/action), children }`; nested children render inside the rail section; + class-emission tests
- [ ] `packages/ui/src/components/share-row.tsx` -- action track `70px` → `auto`; extend `share-row.test.tsx`
- [ ] `packages/ui/src/components/adjust-person-card.tsx` -- add `role` tint prop (kept separate from `isSub`); test
- [ ] `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` -- partner rows → `PersonCard`s with sub cards nested in the expansion; crop AC verified here
- [ ] `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` + `withdraw-money/page.tsx` (+ their tests) -- per-partner blocks → `PersonCard` containment; sub rows → nested sub cards; drop now-redundant `ml-6`/`ml-7` wrappers inside nests
- [ ] `apps/web/app/(dashboard)/adjust-next-time/page.tsx` + test -- pass role tint
- [ ] `apps/web/app/(dashboard)/home/page.tsx` + test -- role tints on grid cards; sub cards violet
- [ ] `apps/web/app/(dashboard)/all-investments/page.tsx` + test -- entry card tint by role
- [ ] Playwright computed-style pass -- tint colors match tokens; no horizontal overflow on Shares at 1200/900px; nested rail renders; batch-1 behaviors (tones, scroll, grid) unregressed

**Acceptance Criteria:**
- Given the Shares screen with 3+ partners each having Edit + Sub-partners buttons, when rendered at 1200px and 900px, then every action button is fully visible inside the card (measured: no element paints outside the card's content box)
- Given any in-scope screen, when a partner with subs renders, then the subs appear as violet-tinted cards inside the partner's teal-tinted card behind a colored rail — role identifiable from card styling alone with text contrast preserved (light tints)
- Given a screen where only one role appears (e.g. sub-partner's own views), when rendered, then that role's tint still applies
- Given batch-1's delivered behaviors (button tones, independent scroll, dashboard grid, All Investments), when this batch lands, then all their tests still pass unmodified except where structure intentionally changed (documented per test)

## Implementation Notes

- 2026-09-26 review pass: 14 findings across 3 layers triaged (see Review Triage Log) — 10 patches applied and re-verified (sr-only role label for accessibility, dead `ShareRow` removed with `ShareList` promoted to its own file, empty-array `nested` guard, `color-mix()` fallback, new test coverage for All Investments tint and the Shares page's full hierarchy rendering, `PersonCard` `className` passthrough, unused `badge` prop removed, corrected "byte-for-byte" test claim, e2e gradient-rail + locator-robustness assertions), 1 deferred (DESIGN.md/EXPERIENCE.md doc sync), 1 rejected with evidence (PersonCard vs. Card dual tint mechanism — no demonstrated near-term harm, fix conflicts with Card's own padding/shadow system). Full gate re-run green: lint (0 violations), typecheck, 68-file/972-test suite, build.

## Spec Change Log

## Review Triage Log

2026-09-26 review pass 1 (blind-hunter BH, verification-gap VG, edge-case-hunter EC):
- BH1 color+containment-only role distinction on Shares/Add Money/Withdraw Money, no text label for screen readers (WCAG 1.4.1-adjacent) — **medium → patch**: sr-only role label in `PersonCard`'s header.
- BH2+EC3+VG(other) `ShareRow` now has zero production callers (all three converted pages moved to `PersonCard`; Decision 3's crop fix never executes) — **confirmed via repo-wide grep → patch**: remove `ShareRow`/its test/export once re-confirmed no remaining import.
- BH3+EC1 `PersonCard`'s `nested` guard passes a truthy empty array, could render an empty rail — **low → patch**: direct one-line correction; no current caller triggers it, but the fix is trivial.
- EC2 `.nb-person-card-partner/-sub` border-color has no fallback before `color-mix()` for browsers without support — **low → patch**: trivial one-line fallback declaration.
- VG1+EC4 `all-investments/page.tsx`'s new `tint={entry.role}` has no test — **medium (pre-verified) → patch**.
- VG2 `shares/page.tsx`'s full PersonCard/nesting rewrite has zero coverage in `pnpm test` (only the non-CI e2e spec touches it) — **medium (pre-verified) → patch**: add `shares/page.test.tsx` hierarchy assertions mirroring add-money/withdraw-money.
- BH4 no `DESIGN.md`/`EXPERIENCE.md` update despite tokens.css's stated sync contract — **low → defer**: real but requires documenting the whole new pattern, more than a direct patch.
- BH5 `PersonCard`'s own `.nb-person-card` base class vs. `Card`'s `tint`-only (no shared base) — two different card systems — **low → reject**: unifying them conflicts with `Card`'s own `.nb-card` padding/shadow system; no demonstrated near-term caller harmed.
- BH6 `PersonCard` has no `className`/rest-prop passthrough, forcing fragile xpath e2e locators — **low → patch**: trivial passthrough addition.
- BH7 `badge` slot on `PersonCardProps` unused, untested — **low → patch**: remove until a caller needs it (no hypothetical-future surface).
- BH8 `adjust-person-card.test.tsx`'s "byte-for-byte" claim doesn't actually assert exact string equality — **low → patch**: fix the test/comment to match what's asserted.
- BH9 the gradient rail itself (the newest, most fragile CSS) isn't measured in the new e2e spec, only border width — **low → patch**: add a `borderImageSource` assertion.
- BH10 e2e `addPartner`'s `.first()` locator dodges a strict-mode duplicate by DOM-order coincidence — **low → patch**: scope the locator.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green
- `pnpm build` -- expected: clean
- Playwright measurement script -- expected: tint rgb values match tokens; zero horizontal overflow on Shares; rail present in nested sections

**Manual checks (if no CLI):**
- Founder-side after deploy: Shares crop gone; hierarchy readable at a glance on all six screens

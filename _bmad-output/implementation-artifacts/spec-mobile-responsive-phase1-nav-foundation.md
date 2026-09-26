---
title: 'Mobile Responsive Phase 1: Drawer Navigation, Dialog/Popover Safety, Dashboard & Canvas Tuning'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
baseline_commit: '561ce35e3bf5b69f1abb080be6dbea3ecbb0b7ee'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app has exactly one responsive breakpoint (`max-[860px]`, sidebar-stacks-above-content) and no phone-specific tuning. Below 860px the full 10-item sidebar nav renders in-flow above every page's content — on a 375-430px phone this buries actual content ~500-600px down the screen on every single route, the single biggest mobile usability break in the app. Dashboard stat-card rows never collapse past 2-per-row, crowding large ₹ amounts; the Ownership Structure canvas has a fixed 520px height and 190px-wide nodes untuned for touch/small screens; Popover/DropdownMenu have no confirmed edge-collision handling.

**Approach:** Replace the in-flow stacked sidebar with a true off-canvas drawer (hamburger trigger + slide-in panel + backdrop) below a phone-appropriate breakpoint, built as a `packages/ui` capability so every current and future dashboard page inherits it for free. Add a true 1-column collapse to the dashboard stat-card grids at narrow widths, tune `StructureCanvas` for small viewports, and confirm/harden Popover and DropdownMenu's viewport collision handling.

## Boundaries & Constraints

**Always:** New breakpoint work lives in `packages/ui`/shared shell code, not hand-rolled per page. Drawer trigger and panel are keyboard- and screen-reader-accessible (focus trap while open, `Escape` closes, labelled toggle button). Existing ≥860px desktop layout stays pixel-identical — verified via the existing Playwright computed-style discipline. All existing tests stay green.

**Never:** No table/list-to-card conversions in this phase (Phase 2's job — Projects, Money History, Audit History, All Investments, Reports stay as-is here). No changes to PersonCard's button copy/sizing (tracked separately, low priority). No new color tokens — reuse existing tokens.css tones for the drawer backdrop/panel.

**Decisions:**
1. Drawer breakpoint: same `860px` cutoff already established (not a new phone-only breakpoint) — below it, the sidebar becomes a slide-in drawer triggered by a hamburger button in a new persistent top bar; at/above 860px, today's fixed sidebar is unchanged.
2. Drawer closes on: backdrop tap, `Escape`, and navigating to a new route (selecting a nav item or a project).
3. Dashboard stat-card grids (`home/page.tsx`'s 3 grids, `reports/page.tsx`'s) get a `max-[480px]:grid-cols-1` addition on top of their existing `max-[760px]:grid-cols-2` — true single-column below 480px, unchanged above it.
4. `StructureCanvas`: reduce the fixed container height on narrow viewports (`max-[600px]:h-[380px]` or similar) and confirm/set React Flow's `fitView` + a sensible `minZoom` so the initial render isn't cropped on a 375px screen. Node width (190px) stays — shrinking it risks text truncation illegibility; pan/zoom already handles overflow.
5. Popover/DropdownMenu: add explicit `collisionPadding` (matching the shell's existing padding conventions) and confirm `avoidCollisions` (Radix default `true`) isn't disabled anywhere — a defensive, low-risk hardening pass, not a redesign.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Phone width, drawer closed | <860px, initial load | hamburger + top bar visible, page content starts near the top, drawer hidden | N/A |
| Drawer open | hamburger tapped | panel slides in, backdrop visible, body scroll locked, focus moves into panel | N/A |
| Drawer close paths | backdrop tap / Escape / nav-item selected | panel closes, focus returns to trigger, body scroll restored | N/A |
| Desktop width unaffected | ≥860px | today's fixed sidebar renders exactly as before, no hamburger/drawer markup active | N/A |
| Narrow stat grid | <480px | stat cards render 1-per-row; 480-760px still 2-per-row; ≥760px unchanged | N/A |
| Structure canvas on phone | <600px viewport | canvas fits the viewport without initial crop; pan/zoom still functional | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/app/(dashboard)/layout.tsx` -- shell grid :208-222 (`h-screen`/`overflow-hidden`/`max-[860px]` from the prior batch); the `<aside>` becomes conditionally a drawer below 860px
- `apps/web/app/(dashboard)/SidebarShell.tsx` -- houses `ProjectSwitcher` + `SidebarNav`; needs an open/close state (client component already, `"use client"`) threaded to the new drawer wrapper
- `apps/web/app/(dashboard)/SidebarNav.tsx`, `packages/ui/src/components/nav-item.tsx` -- 10 `NavItem`s, `py-3` each (~44px); nav-item selection should close the drawer
- New: `packages/ui/src/components/drawer.tsx` (or similar) -- off-canvas panel + backdrop + focus-trap primitive, reusable shell capability; new hamburger trigger button (likely `packages/ui`'s `Button` with an icon)
- `packages/ui/src/components/popover.tsx`, `dropdown-menu.tsx` -- Radix `Content` props for collision handling
- `apps/web/app/(dashboard)/home/page.tsx` -- 3 stat-card grids (:262, :394, :539) currently `grid-cols-{3,4} max-[760px]:grid-cols-2`
- `apps/web/app/(dashboard)/reports/page.tsx` -- its own `max-[760px]` stat/tile grid(s)
- `apps/web/app/(dashboard)/structure/[projectId]/StructureCanvas.tsx` -- fixed `h-[520px] w-full` container :115, `w-[190px]` node width :39, React Flow `fitView`/zoom config
- `packages/ui/src/styles/tokens.css` -- existing tone/shadow tokens to reuse for the drawer backdrop/panel; no new colors

## Tasks & Acceptance

**Execution:**
- [x] `packages/ui/src/components/drawer.tsx` (new) + test -- off-canvas panel: open/close state (controlled or internal), backdrop, `Escape` handler, focus trap on open, focus-restore on close, `aria-hidden`/`role="dialog"` semantics
- [x] `apps/web/app/(dashboard)/layout.tsx` -- below 860px, render a persistent top bar (logo + hamburger trigger) and mount `SidebarShell`'s contents inside the new `Drawer`; ≥860px path unchanged (verify byte-identical via computed style)
- [x] `apps/web/app/(dashboard)/SidebarShell.tsx`/`SidebarNav.tsx` -- close the drawer on nav-item/project selection; expose whatever callback the drawer needs
- [x] `packages/ui/src/components/popover.tsx`, `dropdown-menu.tsx` -- add `collisionPadding`, confirm `avoidCollisions` default; + test if a meaningful assertion exists
- [x] `apps/web/app/(dashboard)/home/page.tsx`, `reports/page.tsx` -- add `max-[480px]:grid-cols-1` to the stat/tile grids; update their tests' breakpoint assertions
- [x] `apps/web/app/(dashboard)/structure/[projectId]/StructureCanvas.tsx` -- narrow-viewport container height + `fitView`/zoom tuning; update/extend its test
- [x] Playwright computed-style pass -- drawer open/close/focus-trap/backdrop-dismiss at 375px and 414px; ≥860px desktop layout unchanged (pixel/computed-style diff against the pre-existing shell); stat-grid column counts at 375/480/760/900px; structure canvas fits at 375px without initial crop

**Acceptance Criteria:**
- Given a phone-width viewport (<860px), when the dashboard loads, then page content is visible without scrolling past a stacked nav list — the nav lives in a closed drawer, not in-flow
- Given the drawer is open, when the user taps the backdrop, presses Escape, or selects a nav item/project, then the drawer closes and focus returns sensibly
- Given a desktop-width viewport (≥860px), when any dashboard page renders, then the layout is unchanged from before this spec (verified, not assumed)
- Given a viewport <480px, when the Home dashboard or Reports page renders, then stat/tile cards stack one per row
- Given a phone viewport, when the Ownership Structure page renders, then the diagram is visible without being cropped on initial load

## Implementation Notes

- 2026-09-26 review pass: 11 findings across 3 layers triaged (see Review Triage Log) — 8 patches applied and re-verified (reduced-motion CSS source-order fix, drawer teardown on resize-past-breakpoint via matchMedia, inert-nav-item guard, new tests for the layout bug fix itself and for MobileNav's open/close/navigate-closes wiring, breakpoint-assertion robustness, shared `findAllByClassName` test util, visible drawer close button), 1 deferred (repeated project-list refetch on reopen — matches an already-accepted pre-existing pattern), 2 rejected with evidence. `apps/web/next-env.d.ts`'s auto-generated dev-tooling diff excluded from the commit (not a code change). Full gate re-run green: lint (0 violations), typecheck, 70-file/985-test suite, build.

**Drawer (`packages/ui/src/components/drawer.tsx`):** built directly on `@radix-ui/react-dialog` (the same primitive `Dialog`/`Popover`/`DropdownMenu` in this folder already use), rather than a hand-rolled focus trap -- `Escape`-to-close, focus trap while open, focus-restore to the trigger on close, and body-scroll-lock all come from Radix for free (verified live, not assumed -- see Verification below). The only custom work is visual: pinned to the left edge, full height, an `nb-drawer-panel` CSS `@keyframes` entrance (in `tokens.css`, mirroring this package's existing "no utility class used only inside `packages/ui/src` without checking it actually renders" discipline) rather than a `transition`, since Radix's `Content` isn't mounted until first open -- a `transition` has no "before" frame to animate from, a CSS *animation* plays on mount regardless. A visually-hidden `Dialog.Title` (`sr-only`) satisfies Radix's accessible-name requirement; `aria-describedby={undefined}` suppresses the dev-mode "missing description" warning since a nav list has nothing to describe. One observation, not a defect: this installed Radix Dialog version (`1.1.23`) does not emit an `aria-modal` attribute on `Content` (confirmed by reading `node_modules/@radix-ui/react-dialog/dist/index.js` directly) -- `role="dialog"` plus its own `aria-hidden`-on-siblings/focus-trap mechanics still satisfy this spec's "role=dialog semantics" ask; noting it here since a stricter a11y audit might otherwise expect it.

**Two `SidebarShell` mounts, not one relocated (`layout.tsx`/`MobileNav.tsx`):** the existing `>=860px` `<aside>` is left completely untouched except `max-[860px]:hidden` (replacing its old restacking `max-[860px]:*` overrides, which no longer apply now that the sidebar doesn't render in-flow below 860px at all) -- this is what makes the `>=860px` byte-identical claim trivially true rather than something to carefully re-derive. A second `SidebarShell` instance lives inside the new `MobileNav` client component's `Drawer`, mounted only below 860px (via `MobileNav`'s own `max-[860px]:flex` top bar). Radix Dialog's `Content` isn't mounted into the DOM until first opened (no `forceMount`), so this second instance's `listProjects()` fetch/effects genuinely never run until a phone user taps the hamburger at least once -- not a double-fetch-on-every-load regression.

**`NavItem` (`packages/ui`):** `onClick` was previously mutually exclusive with `href` (only used for the no-destination-yet inert item). Now attached to the `<a>` alongside `href` too, so `SidebarNav`'s new `onNavigate` prop (threaded from `SidebarShell` -> `MobileNav`) can close the drawer on nav-item selection without giving up the link's own navigation. `SidebarShell.selectProject`/its `ProjectSwitcher onSelectAllInvestments` handler both call the same `onNavigate` after their `router.push()`, since those are genuine client-side transitions (unlike a plain `<a href>` full-page nav, where closing the drawer first is inconsequential -- the page unloads immediately after either way).

**Reports grid (`reports/page.tsx`):** already collapsed to 1 column below 760px (`max-[860px]:grid-cols-2 max-[760px]:grid-cols-1`), unlike `home/page.tsx`'s 3 grids (2-column floor at 760px). `max-[480px]:grid-cols-1` was still added per Decision #3's literal instruction, for explicitness/consistency across both pages -- functionally a no-op today, but removes any dependency on the 760px threshold never changing.

**`StructureCanvas.tsx`:** `max-[600px]:h-[380px]` added on top of the existing `h-[520px]`; `fitView` kept, with `fitViewOptions={{ minZoom: 0.2, padding: 0.15 }}` and `minZoom={0.2}`/`maxZoom={1.5}` added so the initial fit can always shrink to fit a narrow viewport instead of cropping. Verified live (see below) against a real seeded Partner Share -- the diagram fits fully inside its container with no crop at 375px. Node width (190px) was left unchanged per the frozen Decision #4.

**Pre-existing, out-of-scope finding (not fixed here):** the Ownership Structure page's own view-mode toggle row (`page.tsx`, "Percentage"/"Actual Amount"/"Money Flow" buttons -- NOT `StructureCanvas.tsx`) causes ~21px of page-level horizontal overflow at 375px; it predates this spec (that file isn't in this spec's Code Map, and the Boundaries explicitly scope this phase away from anything beyond the Code Map's own file list) and doesn't affect this spec's own AC ("the diagram is visible without being cropped" -- true; the canvas itself is not the source of the overflow). Flagging for a follow-up spec/story rather than fixing opportunistically here.

## Spec Change Log

(none -- implemented as frozen, no deviations from the Intent/Decisions above.)

## Review Triage Log

2026-09-26 review pass 1 (blind-hunter BH, verification-gap VG, edge-case-hunter EC):
- BH+EC `.nb-drawer-panel`'s reduced-motion override is declared BEFORE the unconditional animation rule (same specificity, later source order wins) — **high, confirmed by two independent layers → patch**: reorder so the base rule precedes the `@media (prefers-reduced-motion: reduce)` block, matching `.nb-card-elevated`'s correct existing order.
- BH drawer isn't torn down when the viewport crosses 860px while open (resize/rotation/devtools) — **medium → patch**: matchMedia listener in `MobileNav` closing the drawer on crossing the breakpoint.
- BH repeated `listProjects()` fetch on every drawer reopen — **low → defer**: matches an already-accepted pre-existing pattern in this codebase (deferred-work.md's `SidebarShell` entry); no correctness impact, fix requires state-lifting beyond a direct correction.
- BH stray `apps/web/next-env.d.ts` change — **not a code finding**: confirmed auto-generated Next.js dev-tooling artifact (file's own header: "should not be edited"); excluded from the commit, not patched as code.
- BH+VG `MobileNav`/`onNavigate` drawer-close wiring has zero test coverage (two independent confirmations) — **medium (VG pre-verified) → patch**.
- VG `layout.tsx`'s actual bug fix (`<aside>` `max-[860px]:hidden` + `MobileNav` mount) has no test that would catch a regression — **medium (pre-verified) → patch**.
- BH `findAllByClassName` duplicated verbatim across `home/page.test.tsx` and `reports/page.test.tsx` — **low → patch**: extract to a shared test-utils module.
- BH no visible close ("X") affordance inside the drawer (only backdrop/Escape) — **low → patch**: render `DrawerClose` with an icon in the panel header, the conventional mobile-drawer affordance.
- BH+EC breakpoint-assertion tests destructure the first `findAllByClassName` match without asserting it's defined (5 call sites: `home/page.test.tsx` ×3, `reports/page.test.tsx` ×1) — **low → patch**: add a definedness assertion before use at each site.
- BH `nav-item.tsx`'s `<a href>` `onClick` wiring is functionally inert for a full-page-reload link — **reject**: already acknowledged as inconsequential in the spec's own Implementation Notes; harmless, no fix needed.
- EC `SidebarNav` now passes `onClick={onNavigate}` unconditionally, bypassing `NavItem`'s "no-destination-yet" inert branch (`!onClick` check) if `onNavigate` is truthy — verified: currently unreachable (every real nav item in `layout.tsx` has an `href`, so no item hits this branch today), but the fix is a trivial one-line correction and the "inert" pattern is an established, intentional one the codebase anticipates reusing — **low → patch**: `onClick={item.href ? onNavigate : undefined}` in `SidebarNav.tsx`.

(not run this pass -- implemented directly per the user's request, no separate review-agent pass invoked.)

## Verification

**Commands run:**
- `pnpm --filter @niveshbook/ui test` -- 8 files / 41 tests, all green (incl. 3 new: `drawer.test.tsx`, `popover.test.tsx`, `dropdown-menu.test.tsx`)
- `pnpm --filter @niveshbook/web test` -- 69 files / 975 tests, all green (incl. new `StructureCanvas.test.tsx` and the updated grid-breakpoint assertions in `home/page.test.tsx`/`reports/page.test.tsx`)
- `pnpm lint` (incl. `eslint-plugin-security`) + `pnpm lint:boundaries` (`dependency-cruiser`) -- clean, only pre-existing unrelated warnings
- `pnpm typecheck` -- clean
- `pnpm build` -- clean, all 14 dashboard routes present

**Playwright pass (scratchpad, `apps/web/e2e/_scratch-mobile-nav.spec.ts`, run against `next dev` + local Docker Postgres, then deleted -- not part of the permanent suite):**
- 375px: hamburger + top bar visible, `<aside>` hidden, "Home" heading visible near the top (y < 150px) -- no in-flow-nav-burying-content regression
- Drawer open (via hamburger): `role="dialog"` panel visible, `document.body`'s computed `overflow: hidden` (scroll lock), focus verifiably inside the panel (focus trap)
- `Escape`: panel closes, focus returns to the hamburger trigger, body scroll restored
- Backdrop tap: panel closes
- Nav selection (Project Switcher's "All Investments", a genuine client-side `router.push`): drawer closes, URL updates
- 900px (desktop): hamburger hidden, `<aside>` visible at its existing 236px width
- Home stat grid column counts (probed just inside/outside each threshold, since Tailwind's `max-[Npx]:` variant is exclusive): 1 col at 375/479px, 2 at 481/759px, 4 at 761/900px -- matches the I/O matrix
- Structure canvas (real project + seeded Partner Share): diagram renders fully inside its container, height <= 380px at 375px, not cropped

**Manual checks (if no CLI):**
- Founder-side: open the app on an actual phone or Chrome DevTools device emulation; confirm the drawer feels native (no jank, no scroll-lock leaks)

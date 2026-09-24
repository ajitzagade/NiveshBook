---
name: NiveshBook
description: Plain-English system of record for partnership investment money. Reconciled against a founder-provided screen-mockup artifact (imports/founder-mockup.html, 11 screens) -- tokens below are sourced from that mockup's own CSS custom properties, not invented. Expanded in mockups/all-screens-demo.html to all 14 screens (adds Users, Permissions, Audit History, plus a Trail Quick View), same tokens, for stakeholder demo purposes. shadcn/ui supplies interactive primitives (Dialog, Popover, Sheet, Combobox) the static mockup doesn't demonstrate; those inherit shadcn defaults except where noted. Tailwind CSS + Next.js 16 + React 19.
status: draft
updated: 2026-09-23
colors:
  # Sourced verbatim from imports/founder-mockup.html :root. Light mode only --
  # the mockup has no dark-mode variant; dark values are `[ASSUMPTION]` extrapolations, not confirmed.
  ink: '#1E293B'
  ink-soft: '#64748B'
  ink-faint: '#94A3B8'
  ground: '#F3F5F9'
  surface: '#FFFFFF'
  surface-alt: '#F7F9FC'
  border: '#E7EBF1'
  accent: '#2F6FED'
  accent-strong: '#1E54C7'
  accent-soft: '#E7EFFE'
  success: '#17A566'
  success-soft: '#E3F8EC'
  danger: '#E5484D'
  danger-soft: '#FCEAEA'
  info: '#0EA5A5'
  info-soft: '#E1F7F5'
  violet: '#8B5CF6'
  violet-soft: '#F1EAFE'
  amber: '#E8A317'
  amber-soft: '#FCF1DC'
  # `[ASSUMPTION]` dark-mode extrapolation, unconfirmed -- mockup has no dark variant.
  ground-dark: '#0E1320'
  surface-dark: '#161B2E'
typography:
  # Mockup uses the OS system font stack, not a custom webfont -- corrects
  # this DESIGN.md's earlier (wrong) "Plus Jakarta Sans" assumption.
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 14.5px
    lineHeight: '1.5'
  heading:
    fontWeight: '650'
  stat-value:
    fontSize: 19px
    fontWeight: '700'
    note: 'tabular-nums via .num / font-variant-numeric'
  stat-value-hero:
    fontSize: 27px
    fontWeight: '700'
    note: 'wallet-hero variant only -- the single largest number on screen, tabular-nums'
rounded:
  card: 14px
  el: 9px
  chip: 9999px
spacing:
  sidebar-width: 236px
components:
  status-chip:
    radius: '{rounded.chip}'
    variants:
      success:
        background: '{colors.success-soft}'
        foreground: '{colors.success}'
      danger:
        background: '{colors.danger-soft}'
        foreground: '{colors.danger}'
      info:
        background: '{colors.info-soft}'
        foreground: '{colors.info}'
      violet:
        background: '{colors.violet-soft}'
        foreground: '{colors.violet}'
      neutral:
        background: '{colors.surface-alt}'
        foreground: '{colors.ink-faint}'
        border: '{colors.border}'
  stat-card:
    background: '{colors.surface}'
    border: '{colors.border}'
    radius: '{rounded.card}'
    shadow: '0 1px 2px rgba(30,41,59,0.04), 0 8px 20px rgba(30,41,59,0.05)'
  nav-item:
    # Corrected 2026-09-24 after a code-level UI audit found the shipped
    # sidebar drifted from a comfortable touch/click target: row height was
    # ~38px (py-2 + the 22px badge) and the icon glyph was rendered at 12px,
    # visibly small inside its own 22px badge. Row height and icon-label gap
    # are real, changeable CSS; the 22px badge size itself is NOT changed
    # here (it is the confirmed founder-mockup size) -- so the icon glyph
    # goes to 14px (fills the fixed badge better) rather than the more
    # generic 18-20px a size-agnostic checklist would suggest, which would
    # no longer fit inside the approved 22px badge without enlarging it.
    height: '44-46px (py-3 vertical padding on the 22px badge)'
    icon-size: '14px'
    icon-label-gap: '12px'
    # Label color/weight corrected 2026-09-24: shipped as ink-soft/font-medium
    # (too light to read as primary navigation, and the `active` prop was
    # never actually wired to the current route so selection never showed).
    # Enabled-but-not-current now reads at full ink contrast, bold; the
    # current page additionally gets the accent tint + accent-strong text.
    label-color: '{colors.ink}, font-weight 600 (was ink-soft, font-weight 500)'
    active-label-color: '{colors.accent-strong} on {colors.accent-soft} background'
  nav-badge:
    radius: '{rounded.el}'
    size: '22px'
    # Only 5 of 9 items are semantically colored; the rest are neutral slate.
    # This corrects the earlier "colored icon badges" (implying all) assumption.
    colors:
      home: '#475569'
      projects: '{colors.accent}'
      partner-shares: '{colors.info}'
      add-money: '{colors.success}'
      withdraw-money: '{colors.danger}'
      available-balance: '{colors.violet}'
      adjust-next-time: '#475569'
      money-history: '#475569'
      reports: '#475569'
  trail-node:
    dot-size: '14px'
    connector: '2px solid {colors.border}'
    # dot color = the transaction/movement type at that node, not a fixed color
  trail-branch:
    # Horizontal alternate to trail-node, added for the "Trail Quick View" toggle
    # -- same trail data, laid out as branching boxes + connector lines instead
    # of a vertical list. Layout inspired by a founder-supplied reference image
    # (dark theme, unconfirmed as a palette direction) -- colors below stay
    # NiveshBook's own light tokens; only the branching-box layout is adopted.
    box:
      background: '{colors.surface}'
      border: '2px solid {colors.border}'
      radius: '{rounded.card}'
      # left border recolors per node type, matching trail-node's dot color
    connector: '2px solid {colors.border}'
  button-primary:
    background: '{colors.accent}'
    foreground: '#FFFFFF'
    radius: '{rounded.el}'
    # Padding corrected 2026-09-24: 9px 15px measured ~34-38px tall in the
    # shipped app -- short of a comfortable click target. 11px 18px lands in
    # the 40-44px range without changing font-size, weight, or radius.
    padding: '11px 18px'
    # Icon convention added 2026-09-24 -- see Brand & Style's "Icons" note.
    icon: 'lucide-react, 14px, leading (before the label text), 6px gap'
  button-ghost:
    background: '{colors.surface}'
    foreground: '{colors.ink-soft}'
    border: '{colors.border}'
    radius: '{rounded.el}'
    padding: '11px 18px'
    icon: 'lucide-react, 14px, leading (before the label text), 6px gap'
  page-header:
    # Added 2026-09-24, extracted from a pattern every real screen (Projects,
    # Partner Shares, Add Money, Edit Project) had already independently
    # implemented identically -- centralized as `packages/ui`'s `PageHeader`
    # so it can't drift per-page again. Shape: optional back-link (12.6px,
    # ink-soft) above an h1 (22px), an optional description (13.4px,
    # ink-soft) below it, and a right-aligned primary action -- wraps to a
    # new line under the title on narrow viewports rather than compressing.
    title-size: '22px'
    description-size: '13.4px'
    back-link-size: '12.6px'
    margin-bottom: '24px'
  empty-state:
    # Added 2026-09-24 to replace a bare line of text as the "nothing here
    # yet" pattern (the Projects/Partner Shares/Add Money list screens'
    # original empty state) -- centered icon + heading + description +
    # optional primary action, generous vertical padding so it reads as a
    # considered state rather than a stray sentence in an otherwise-empty
    # Card.
    icon-size: '22px'
    icon-badge: 'surface-alt circle, 48px'
    title-size: '14.5px, weight 650'
    description-size: '13px, max-width 360px'
    vertical-padding: '48px (py-12)'
---

## Brand & Style

NiveshBook is the plain-English record of real money moving between real partners. The confirmed visual direction (`imports/founder-mockup.html`) is unfussy SaaS-dashboard: a soft grey-blue canvas, white cards with a light shadow for depth (not borders alone), a confident mid-blue accent, and five semantic colors doing real work rather than decoration -- every color in the palette maps to a specific transaction or adjustment meaning, never used as pure ornament. The mockup's own restraint is the brand: no gradients except one deliberate one (Available Balance's hero card), system fonts throughout, numbers always tabular so they don't jitter.

**Icons (revised 2026-09-24)** — the mockup itself has none (it's a static prototype using literal glyphs like "+"/"←"), and this doc originally carried that forward as "no decorative icons." The real product overrides this: every `Button` and `PageHeader` back-link gets a matched `lucide-react` icon (14px for buttons, 12px for the back-arrow) alongside its text label -- never icon-only, never a unicode glyph (⌂ ▤ % + ←). Icons stay semantic, not decorative: `Plus` for create actions, `Pencil` for edit, `X`/`ArrowLeft` for cancel/back, `Save` for submit, `Ban` for a destructive cancel-payment confirmation, entity-specific icons (`UserPlus`, `Wallet`, `Percent`) where one exists. See `{components.button}`.

The component set is dashboard/table-heavy (Partner Shares, Add Money, Money History are all tabular), which matches PRD §6's allowance for genuinely tabular data while still banning *complex nested* tables and multi-chart clutter -- the mockup holds to this: one table per card, sub-rows indented once (never twice), one hero number per screen at most.

## Colors

- **Canvas (`ground` `#F3F5F9`)** — page background, everywhere.
- **Card (`surface` `#FFFFFF`)** — every data surface. Depth comes from the shadow token (`0 1px 2px rgba(30,41,59,.04), 0 8px 20px rgba(30,41,59,.05)`) plus a 1px `border` (`#E7EBF1`), not color contrast alone.
- **`surface-alt` (`#F7F9FC`)** — secondary surfaces nested inside a card (the role-switcher block in the mockup's sidebar, neutral-chip background).
- **Accent (`accent` `#2F6FED`, hover/active `accent-strong` `#1E54C7`, tint `accent-soft` `#E7EFFE`)** — primary buttons, active nav state + its badge, the worked-example hint's background, the Projects nav badge.
- **Five semantic colors, each tied to a transaction/adjustment meaning, not a generic "state":**
  - `success` (`#17A566`) — money added, extra paid, an adjustment resolving in the person's favor ("Reduce by ₹X"). Also the Add Money nav badge.
  - `danger` (`#E5484D`) — a withdrawal event, Pending, an adjustment owed ("Add ₹X"). Also the Withdraw Money nav badge. *(Note: reused for both "a withdrawal happened" (neutral fact) and "you owe money" (negative) — context, not the color alone, disambiguates; see Component Patterns.)*
  - `info` / teal (`#0EA5A5`) — money movement between projects, informational trace links ("View Full History →"). Also the Partner Shares nav badge.
  - `violet` (`#8B5CF6`) — Available Balance, Keep for Later, a transfer to a person. Also the Available Balance nav badge.
  - `amber` (`#E8A317`) — a later/secondary reinvestment step in a money trail, the Adjustment Report tile. The one color not tied to a nav item.
- **Neutral text ramp:** `ink` (`#1E293B`, primary text), `ink-soft` (`#64748B`, secondary/labels), `ink-faint` (`#94A3B8`, captions, disabled, chip-neutral text).
- `[ASSUMPTION]` **Dark mode** is unspecified — the mockup is light-only. Placeholder dark tokens exist in frontmatter but are not confirmed; treat dark mode as out of scope until asked for explicitly.

## Typography

System font stack (`-apple-system, "Segoe UI", Roboto, ...`) — no custom webfont, correcting this document's earlier assumption. Base body 14.5px/1.5. Headings (`h1`/`h2`/`h3`) at weight 650, not a bespoke display role. The one deliberately over-specified role is numeric: any value in a `.num`/stat context uses `font-variant-numeric: tabular-nums`, sized contextually — 19px/700 for a dashboard stat tile, 27px/700 for the single Available Balance hero figure (used exactly once per product, per the mockup), inline/table-cell sizes inherit body size but keep tabular-nums and weight 650+.

## Layout & Spacing

Fixed sidebar at exactly `236px`, content area `max-width: 1020px` with `28px 36px` padding (`20px 16px` under 860px). Below `860px` the mockup collapses to a single column — it does not demonstrate a drawer/sheet pattern for the sidebar at that width. `[ASSUMPTION]` for the real (non-mockup) responsive build, a shadcn `Sheet` triggered from a top bar is the sensible upgrade over a bare stack, matching EXPERIENCE.md's NFR19 requirement that mobile be genuinely usable, not just present — this needs a founder look before it's final. Dashboard stat-card rows are a 4-column grid (2-column under 760px); the Reports tile grid is 3-column (1-column under 760px).

## Elevation & Depth

One shadow value, used identically on every card and stat tile: `0 1px 2px rgba(30,41,59,0.04), 0 8px 20px rgba(30,41,59,0.05)`. No secondary elevation tier — dialogs/popovers (shadcn-supplied, since the mockup doesn't show them) should use shadcn's own elevation rather than inventing a second NiveshBook-specific shadow.

## Shapes

Two radii cover the whole surface: `{rounded.card}` (14px) for cards, stat tiles, dialogs; `{rounded.el}` (9px) for buttons, inputs, nav items, report-tile icons. Status chips and trail dots use `{rounded.chip}` (full pill/circle) exclusively — no other element is fully rounded.

## Components

**From the mockup, verbatim** (build these first — every other Epic 2+ screen composes from them):

- **Stat card** — label (11.6px, `ink-faint`, weight 600) over value (19px/700, optionally `success`/`danger`/`violet` colored). Used in 4-up and 3-up dashboard rows.
- **Wallet hero** — the one exception to "cards are white": a diagonal `accent-soft`→`info-soft` gradient card, used only on Available Balance, with the 27px hero stat value.
- **Status chip** — 5 variants (`success`/`danger`/`info`/`violet`/`neutral`), pill-shaped, text+color always together (never color-only), per `DESIGN.md.Components.status-chip`.
- **Data table with sub-rows** — right-aligned numeric columns, first column left-aligned. A sub-row (e.g. a sub-partner under a Partner) is denoted with a `↳` prefix, 24px extra left padding, smaller (12.6px) muted text — never more than one indent level (matches PRD's "no complex nested tables").
- **Share row** — name + editable percent input + neutral "Edit" chip, stacked in a `share-list`; always paired with a **Distributed/Allocated check** bar below (success-soft background, "100% ✓" or "Remaining 0%" pattern) — this exact component also does duty as the Withdrawal Destination screen's "Distributed: ₹X / ₹Y ✓" bar (UJ-4).
- **Split row** — a destination-split line item: colored dest-icon (26px, radius `el`) + label, amount input on the right. Used only on the Withdrawal Destination screen.
- **Adjust person card** — name + one or two label/value lines + a resolution chip (`success` "Reduce by ₹X" / `danger` "Add ₹X" / `violet` "Keep for Later ₹X"), grouped in an Investment column and a Withdrawal column side by side, never merged (PRD: adjustments are independent, never netted).
- **Trail (vertical)** — a left-bordered vertical timeline, each node a small colored dot (`{colors}` per the node's transaction type, not a fixed color) + a what/meta/amount row. Paired with a **trace banner** above it (muted `surface-alt` bar showing "Trace ID: X" + an `info`-chip link) when viewing a specific money trail. This is the default/primary trail pattern.
- **Trail Quick View (horizontal branching)** — an alternate, expanded rendering of the same trail data as boxes connected by lines, arranged left-to-right in generations (origin → withdrawal → its direct destinations → any of those destinations' own further splits), so a viewer sees the branching shape at a glance instead of reading a flat chronological list. Each box uses `{components.trail-branch}` — white card, `{rounded.card}`, a 3px left border colored per `{colors}` for that node's transaction type (same color mapping as the vertical trail's dots). Toggled via the existing "Trail Quick View" control next to Money History's trail (`DESIGN.md.Do's and Don'ts`: still one hero visualization per screen — this replaces the vertical trail in place when active, it doesn't add a second one alongside it).
- **Report tile** — colored icon badge (30px, radius `el`) + name + one-line description, in the 3-up report grid.
- **Button** — `primary` (accent fill, white text) and `ghost` (white fill, border, `ink-soft` text) only; both `{rounded.el}`, `11px 18px` padding (corrected 2026-09-24 from `9px 15px` — see `{components.button-primary}`), weight 650. Every button carries a leading `lucide-react` icon (2026-09-24, see Brand & Style's "Icons" note and `{components.button-primary.icon}`) — never text-only, never a `+`/`←` literal character.
- **Nav badge** — 22px square, `{rounded.el}`, colored per the mapping in frontmatter — 5 of 9 items get a semantic color, the rest (Home, Adjust Next Time, Money History, Reports) are neutral slate `#475569`. Real build uses `lucide-react` icons at **14px** (corrected 2026-09-24 from an unintentional 12px) inside the fixed 22px badge, `12px` gap to the label, `44-46px` nav-item row height (`{components.nav-item}`) — covers all 9 semantically: Home, LayoutGrid, Percent, Plus, Minus, Wallet, RotateCcw, History, BarChart3. Label is `ink`/semibold when enabled, `accent-strong` on `accent-soft` when the current route matches it (corrected 2026-09-24 — shipped too light, and selection never actually rendered because `active` was never wired to the route).
- **Logo / brand mark** (added 2026-09-24, `packages/ui`'s `Logo`) — the mockup's `.brand-mark`: a 2x2 grid of 9px squares (2px gap, 3px radius each) in `accent`/`success`/`info`/`amber`, in that exact order. This existed in the source mockup from the start but was never actually built into the real app (only the "NiveshBook" wordmark was) — now used next to the wordmark on the login screen and the sidebar, everywhere the wordmark appears.
- **Page header** (added 2026-09-24, `packages/ui`'s `PageHeader`) — every screen's title block: optional back-link, 22px `h1`, optional 13.4px description, right-aligned primary action. Extracted from a pattern four screens had already implemented independently and identically — use this component for any new screen's header rather than reimplementing the div/h1/p/button shape inline (`{components.page-header}`).
- **Empty state** (added 2026-09-24, `packages/ui`'s `EmptyState`) — the "nothing here yet" pattern for any list screen: centered icon (lucide, 22px, in a 48px `surface-alt` circle) + 14.5px heading + optional 13px description (max-width 360px) + optional primary action, `48px` vertical padding. Replaces a bare sentence of text as the empty-state treatment for Projects, Partner Shares, Add Money, and any future list screen (`{components.empty-state}`).

**Not in the mockup — shadcn/ui, unmodified**, used for interactions the static prototype can't demonstrate: `Dialog`, `Sheet` (mobile nav), `Popover`, `DropdownMenu` (Export ⌄ on Money History), `Combobox` (searchable Project/Partner/Person pickers — NFR15's "clear-selection affordance" requirement).

**Explicitly excluded from the product:** the mockup's sidebar "Viewing as: Owner / Partner A / Sub-partner" role switcher is prototype-only scaffolding for demoing different permission views in a static file. The real product determines role from the authenticated server session (AD-1) — a client-side role switcher would be a security anti-pattern and must not be built.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Source every token from `imports/founder-mockup.html`'s CSS custom properties | Invent a color/radius/shadow value not present in the mockup without flagging it `[ASSUMPTION]` |
| Use `.num`-style tabular-nums on every monetary value, everywhere | Let a number's digit width jitter as it changes |
| Pair every status chip with a text label | Ship a color-only status indicator |
| Indent a sub-row once, with `↳` | Nest a second level of sub-rows inside a sub-row |
| Determine role/visibility server-side (AD-1) | Build any client-side role switcher, even for a demo/admin surface |
| Use `packages/ui`'s `PageHeader` for every screen's title block | Re-implement the title/description/action header markup inline per page |
| Use `packages/ui`'s `EmptyState` for a list screen with nothing in it yet | Ship a bare sentence of text as an empty state |
| Fix a spacing/sizing inconsistency at the token or shared-component level (`tokens.css`, `packages/ui`) | Patch one page's CSS in isolation, leaving the same value wrong everywhere else |
| Use `lucide-react` icons matched to the mockup's badge colors, and on every `Button` (2026-09-24) | Ship literal unicode glyphs (⌂ ▤ % + ←) as the production icon or button-decoration set |
| Measure a new fixed-size/padding/spacing value in `packages/ui` against an actual build (computed style, not a screenshot glance) before calling it done | Assume a Tailwind class compiled correctly just because the className string is correct in source — see AGENTS.md's "UI build gotchas": `packages/ui` is consumed as raw source, and a class used only there can silently generate no CSS at all |

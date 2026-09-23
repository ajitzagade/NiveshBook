---
name: NiveshBook
description: Plain-English system of record for partnership investment money. Reconciled against a founder-provided screen-mockup artifact (imports/founder-mockup.html, all 11 screens) -- tokens below are sourced from that mockup's own CSS custom properties, not invented. shadcn/ui supplies interactive primitives (Dialog, Popover, Sheet, Combobox) the static mockup doesn't demonstrate; those inherit shadcn defaults except where noted. Tailwind CSS + Next.js 16 + React 19.
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
  button-primary:
    background: '{colors.accent}'
    foreground: '#FFFFFF'
    radius: '{rounded.el}'
  button-ghost:
    background: '{colors.surface}'
    foreground: '{colors.ink-soft}'
    border: '{colors.border}'
    radius: '{rounded.el}'
---

## Brand & Style

NiveshBook is the plain-English record of real money moving between real partners. The confirmed visual direction (`imports/founder-mockup.html`) is unfussy SaaS-dashboard: a soft grey-blue canvas, white cards with a light shadow for depth (not borders alone), a confident mid-blue accent, and five semantic colors doing real work rather than decoration -- every color in the palette maps to a specific transaction or adjustment meaning, never used as pure ornament. The mockup's own restraint is the brand: no gradients except one deliberate one (Available Balance's hero card), no decorative icons, system fonts throughout, numbers always tabular so they don't jitter.

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
- **Trail (vertical)** — a left-bordered vertical timeline, each node a small colored dot (`{colors}` per the node's transaction type, not a fixed color) + a what/meta/amount row. Paired with a **trace banner** above it (muted `surface-alt` bar showing "Trace ID: X" + an `info`-chip link) when viewing a specific money trail.
- **Report tile** — colored icon badge (30px, radius `el`) + name + one-line description, in the 3-up report grid.
- **Button** — `primary` (accent fill, white text) and `ghost` (white fill, border, `ink-soft` text) only; both `{rounded.el}`, `9px 15px` padding, weight 650.
- **Nav badge** — 22px square, `{rounded.el}`, colored per the mapping in frontmatter — 5 of 9 items get a semantic color, the rest (Home, Adjust Next Time, Money History, Reports) are neutral slate `#475569`. Icons in the mockup are unicode glyph placeholders (⌂ ▤ % + − ₹ ↻ ☰ ▦); the real build should replace these with a real icon set (`lucide-react` — the standard shadcn companion, MIT-licensed, covers all 9 semantically: Home, LayoutGrid, Percent, Plus, Minus, Wallet, RotateCcw, History, BarChart3).

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
| Use `lucide-react` icons matched to the mockup's badge colors | Ship literal unicode glyphs (⌂ ▤ %) as the production icon set |

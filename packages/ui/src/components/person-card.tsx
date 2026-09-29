import { ChevronDown, ChevronRight } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/cn";

export type PersonCardRole = "partner" | "sub_partner";

const ROLE_LABEL: Record<PersonCardRole, string> = {
  partner: "Partner",
  sub_partner: "Sub-partner",
};

export interface PersonCardProps {
  /**
   * Role tint (founder-approved hybrid, 2026-09-26): `partner` = teal
   * (`--color-info-soft` background, info-tinted border), `sub_partner` =
   * the violet equivalents -- so the role is identifiable from card
   * styling alone, on every screen rendering partner/sub-partner lists.
   * Also renders an sr-only "Partner"/"Sub-partner" text label next to
   * `name` (review fix, 2026-09-26) -- color tint + DOM nesting alone
   * aren't reliably perceivable by screen reader users.
   */
  role: PersonCardRole;
  /** Header slots: name gets the flexible track; value/action trail it. */
  name: ReactNode;
  /**
   * Up to 2 uppercase initials (e.g. `initialsOf(name)` from `@/lib/initials`)
   * rendered as a small avatar circle before `name` (2026-09-29, founder
   * feedback -- easier to place a person at a glance). Omit for no avatar --
   * every existing caller is unaffected.
   */
  avatarInitials?: string;
  value?: ReactNode;
  action?: ReactNode;
  /**
   * Card-body content below the header row -- the person's OWN ancillary
   * lines (adjustment chips, retained/"Own" figures, per-person actions).
   */
  children?: ReactNode;
  /**
   * The nested sub-partner section, rendered inside `.nb-person-nest`'s
   * colored rail (the partner -> sub connection -- containment, never
   * literal drawn lines). Pass `null`/omit/an empty array for a partner
   * without subs: no empty nested section is emitted.
   */
  nested?: ReactNode;
  /**
   * Always-visible content, rendered between the header row and the
   * collapsible `children`/`nested` (2026-09-29) -- for a status a viewer
   * needs even without expanding (e.g. an adjustment chip). Renders
   * regardless of `collapsed`; omit for none.
   */
  summary?: ReactNode;
  /**
   * Opt-in collapse affordance (2026-09-29, founder feedback on the
   * Withdraw Money screen's long per-Partner/Sub-partner cards -- extended
   * the same day to make the WHOLE header clickable, not just the name,
   * after founder follow-up that a name-only target was hard to notice):
   * when `onToggleCollapse` is supplied, the entire header row (chevron,
   * avatar, name, `value`, `action`) becomes one clickable/keyboard-
   * operable control (mirrors `RowCard`'s identical whole-row-click
   * pattern, incl. its "a nested action's own onClick must call
   * `event.stopPropagation()` if it shouldn't also toggle collapse"
   * convention -- not needed by any current caller: Withdraw Money and Add
   * Money's Should Pay panel opt into `onToggleCollapse` today, and neither's
   * `value`/`action` carry nested buttons). `children`/`nested` render only while
   * `collapsed` is falsy. Fully controlled, mirroring this package's
   * `Dialog` -- every call site owns its own collapse state (e.g. a
   * `Set<string>` of expanded ids) rather than `PersonCard` holding
   * internal state, which keeps this a plain, hook-free function
   * component (this package deliberately ships with no jsdom
   * devDependency, so its own tests call components directly rather than
   * rendering+firing events -- see `combobox.tsx`'s doc comment). Omit
   * `onToggleCollapse` for the original, always-expanded, non-interactive
   * header -- every existing caller is unaffected.
   */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Merged onto the root element (`Card`'s own convention) so callers/tests can target instances without fragile text-content lookups. */
  className?: string;
}

/**
 * A role-tinted person card (spec-partner-hierarchy-cards, 2026-09-26):
 * partner cards contain their sub-partner cards behind a colored left
 * rail. The header is `flex-wrap`, so a wide action set (e.g. Edit +
 * "Sub-partners (n)") wraps inside the card rather than ever painting
 * past its edge.
 */
export function PersonCard({
  role,
  name,
  avatarInitials,
  value,
  action,
  summary,
  children,
  nested,
  collapsed,
  onToggleCollapse,
  className,
}: PersonCardProps) {
  // An array `nested` (e.g. `partner.subPartners.map(...)`) that resolved to
  // zero elements is truthy but has nothing to render -- treated the same as
  // `null`/`undefined`/`false` so no empty `.nb-person-nest` rail is emitted
  // (review fix, 2026-09-26).
  const hasNested = Array.isArray(nested) ? nested.length > 0 : nested != null && nested !== false;
  // Collapsing hides `children` AND `nested` together -- a collapsed Partner
  // shouldn't still spill its Sub-partners' full cards below it.
  const showBody = !onToggleCollapse || !collapsed;

  // Mirrors `RowCard`'s identical "a plain div onClick is invisible to
  // keyboard/assistive tech" fix -- role="button" + tabIndex + Enter/Space
  // activation makes the whole header a real, reachable control.
  function handleHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onToggleCollapse) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleCollapse();
    }
  }

  return (
    <div
      className={cn(
        "nb-person-card",
        role === "partner" ? "nb-person-card-partner" : "nb-person-card-sub",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-el",
          onToggleCollapse && "-m-1.5 cursor-pointer p-1.5 transition-colors hover:bg-surface-alt",
        )}
        onClick={onToggleCollapse}
        role={onToggleCollapse ? "button" : undefined}
        tabIndex={onToggleCollapse ? 0 : undefined}
        onKeyDown={onToggleCollapse ? handleHeaderKeyDown : undefined}
        aria-expanded={onToggleCollapse ? !collapsed : undefined}
      >
        {onToggleCollapse ? (
          collapsed ? (
            <ChevronRight size={16} className="shrink-0 text-ink-faint" />
          ) : (
            <ChevronDown size={16} className="shrink-0 text-ink-faint" />
          )
        ) : null}
        {avatarInitials ? (
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold text-white",
              role === "partner" ? "bg-info" : "bg-violet",
            )}
          >
            {avatarInitials}
          </span>
        ) : null}
        {/*
          The sr-only role label is a SIBLING of the name span, not nested
          inside it: nesting it merges into the name span's own accessible/
          visible text ("Nest Partner (Partner)"), which breaks every
          existing exact-text lookup keyed on the plain name (both this
          package's callers' tests and the e2e suite's Playwright
          `getByText(name, { exact: true })` locators -- Playwright computes
          an element's text from its full descendant subtree, unlike RTL's
          default direct-text-node-only matcher, so this only surfaced
          against a real browser).
        */}
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{name}</span>
        <span className="sr-only">{ROLE_LABEL[role]}</span>
        {value}
        {action}
      </div>
      {summary}
      {showBody ? children : null}
      {showBody && hasNested ? <div className="nb-person-nest">{nested}</div> : null}
    </div>
  );
}

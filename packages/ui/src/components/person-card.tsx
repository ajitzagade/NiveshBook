import type { ReactNode } from "react";
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
export function PersonCard({ role, name, value, action, children, nested, className }: PersonCardProps) {
  // An array `nested` (e.g. `partner.subPartners.map(...)`) that resolved to
  // zero elements is truthy but has nothing to render -- treated the same as
  // `null`/`undefined`/`false` so no empty `.nb-person-nest` rail is emitted
  // (review fix, 2026-09-26).
  const hasNested = Array.isArray(nested) ? nested.length > 0 : nested != null && nested !== false;

  return (
    <div
      className={cn(
        "nb-person-card",
        role === "partner" ? "nb-person-card-partner" : "nb-person-card-sub",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
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
        <span className="min-w-0 flex-1 text-[13.4px] font-semibold">{name}</span>
        <span className="sr-only">{ROLE_LABEL[role]}</span>
        {value}
        {action}
      </div>
      {children}
      {hasNested ? <div className="nb-person-nest">{nested}</div> : null}
    </div>
  );
}

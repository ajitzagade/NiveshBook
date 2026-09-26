import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface RowCardField {
  label: string;
  value: ReactNode;
}

export interface RowCardProps {
  title: ReactNode;
  /** Small trailing marker next to the title -- typically a `StatusChip` (e.g. "Cancelled"/"Reversed"). */
  badge?: ReactNode;
  /** Reuses `AdjustPersonCard`'s established `label`/`value` field shape (spec-mobile-responsive-phase2, Decision #1) -- every field visible in a table row's own columns, stacked. */
  fields: RowCardField[];
  /**
   * Inline action(s) carried over verbatim from the table row's own action
   * cell (Decision #3/#4) -- rendered in a `flex flex-wrap` row so a wide
   * action set (e.g. Projects' 5 buttons) wraps inside the card instead of
   * being trimmed, hidden, or overflowing (mirrors `PersonCard`'s own
   * wrap-safe header pattern).
   */
  action?: ReactNode;
  /**
   * Row-click-to-trace-mode (Money History) and similar whole-row
   * navigation carries over onto the card verbatim (Decision #3) -- a
   * mobile user loses no capability a desktop user has. An action's own
   * `onClick` is expected to call `event.stopPropagation()` when it must
   * not also trigger this (mirrors `TableRow`'s identical convention).
   */
  onClick?: () => void;
  /**
   * Hover/hint text AND accessible name for a clickable card (review fix)
   * -- rendered as both the native `title` attribute and `aria-label`, so a
   * caller can pass the exact same hint the desktop table row uses (e.g.
   * Money History's `"View this entry's money trail"`). Named `hint`, not
   * `title`, to avoid colliding with this component's own `title` prop
   * (the card's headline). Ignored when `onClick` is omitted.
   */
  hint?: string;
  /** Merged onto the root element so callers/tests can target instances without fragile text-content lookups (mirrors `PersonCard`'s own `className` convention). */
  className?: string;
}

/**
 * The below-860px row equivalent of a dense `Table` row (spec-mobile-
 * responsive-phase2-table-cards): title + optional badge, stacked
 * label/value fields (generalizing `AdjustPersonCard`'s `lines` shape,
 * Decision #1), and an optional action row. Every screen renders both this
 * stack AND its existing `Table` simultaneously in the DOM, switched purely
 * by the CSS `max-[860px]:`/`min-[861px]:` convention Phase 1 established
 * for the nav drawer -- no JS breakpoint detection here.
 */
export function RowCard({ title, badge, fields, action, onClick, hint, className }: RowCardProps) {
  // Review fix: a clickable card is the primary mobile touch target for
  // row-click-to-trace-mode etc. (Decision #3) -- a plain `<div onClick>`
  // is invisible to keyboard/assistive tech. `role="button"` + `tabIndex`
  // + Enter/Space activation makes it a real, reachable control, mirroring
  // how a native `<button>`/link would behave.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <div
      className={cn(
        "mb-[11px] rounded-xl border border-border px-[15px] py-3.5 last:mb-0",
        onClick && "cursor-pointer hover:bg-surface-alt",
        className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      title={onClick ? hint : undefined}
      aria-label={onClick ? hint : undefined}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 text-[13.8px] font-bold">{title}</span>
        {badge}
      </div>
      {fields.map((field, index) => (
        <div key={`${field.label}-${index}`} className="flex justify-between gap-3 py-0.5 text-[12.8px] text-ink-soft">
          <span>{field.label}</span>
          <span className="num text-right font-semibold text-ink">{field.value}</span>
        </div>
      ))}
      {action ? <div className="mt-2 flex flex-wrap gap-1.5">{action}</div> : null}
    </div>
  );
}

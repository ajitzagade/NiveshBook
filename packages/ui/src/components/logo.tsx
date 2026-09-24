import type { CSSProperties } from "react";

export interface LogoProps {
  className?: string;
  style?: CSSProperties;
}

const SQUARE: CSSProperties = { width: 9, height: 9, borderRadius: 3 };

/**
 * The brand mark from the founder-approved mockup (`imports/founder-mockup.html`
 * `.brand-mark`): a 2x2 grid of 9px squares (2px gap, 3px radius each) in
 * accent/success/info/amber, in that exact order. Was never actually built
 * into the real app (only the "NiveshBook" wordmark was) -- added 2026-09-24
 * so the login screen and sidebar carry the real brand mark, not just text.
 *
 * Deliberately built with inline styles, not Tailwind grid utilities --
 * the first version (`grid-cols-2 grid-rows-2 gap-[2px]`) rendered
 * incorrectly in production (verified via screenshot, not assumed), most
 * likely a Tailwind-class-detection gap for this package. Fixed sizes on a
 * 4-square decorative mark don't benefit from utility classes enough to be
 * worth that risk -- inline styles can't be purged or mis-scanned.
 */
export function Logo({ className, style }: LogoProps) {
  return (
    <span
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: "9px 9px",
        gridTemplateRows: "9px 9px",
        gap: 2,
        flexShrink: 0,
        ...style,
      }}
      aria-hidden="true"
    >
      <span style={{ ...SQUARE, background: "var(--color-accent)" }} />
      <span style={{ ...SQUARE, background: "var(--color-success)" }} />
      <span style={{ ...SQUARE, background: "var(--color-info)" }} />
      <span style={{ ...SQUARE, background: "var(--color-amber)" }} />
    </span>
  );
}

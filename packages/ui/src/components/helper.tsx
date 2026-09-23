import type { ReactNode } from "react";

/**
 * Worked-example hint (PRD §6) -- always visible at point of use next to a
 * calculation-driven field, never a hover tooltip. Use the field's own live
 * numbers, not a generic example.
 */
export function Helper({ children }: { children: ReactNode }) {
  return <div className="nb-helper">{children}</div>;
}

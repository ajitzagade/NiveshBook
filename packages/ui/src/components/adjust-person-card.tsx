import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface AdjustLine {
  label: string;
  value: ReactNode;
}

export interface AdjustPersonCardProps {
  name: string;
  lines: AdjustLine[];
  resolution: ReactNode;
  /** Sub-partner card: 24px left inset, matching `ShareRow`'s `isSub`/`nb-sub-row` indent precedent (founder feedback 2026-09-26). */
  isSub?: boolean;
  /**
   * Role tint (spec-partner-hierarchy-cards, 2026-09-26; kept separate from
   * `isSub`, which is layout-only): `partner` = teal (`--color-info-soft`
   * background, info-tinted border), `sub_partner` = the violet
   * equivalents -- role identifiable from card styling alone. When set, the
   * tint class carries the border color (the plain `border-border` utility
   * would win over the component-layer tint otherwise).
   */
  role?: "partner" | "sub_partner";
}

/**
 * Investment and Withdrawal render as two separate columns of these cards,
 * never merged -- adjustments are independent, never netted (PRD).
 */
export function AdjustPersonCard({ name, lines, resolution, isSub, role }: AdjustPersonCardProps) {
  return (
    <div
      className={cn(
        "mb-[11px] rounded-xl border px-[15px] py-3.5 last:mb-0",
        role === "partner" && "nb-person-card-partner",
        role === "sub_partner" && "nb-person-card-sub",
        !role && "border-border",
        isSub && "ml-6",
      )}
    >
      <div className="mb-1.5 text-[13.8px] font-bold">{name}</div>
      {lines.map((line) => (
        <div key={line.label} className="flex justify-between py-0.5 text-[12.8px] text-ink-soft">
          <span>{line.label}</span>
          <strong className="num font-semibold text-ink">{line.value}</strong>
        </div>
      ))}
      <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-border pt-1.5 text-[12.9px]">
        {resolution}
      </div>
    </div>
  );
}

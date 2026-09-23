import type { ReactNode } from "react";

export interface AdjustLine {
  label: string;
  value: ReactNode;
}

export interface AdjustPersonCardProps {
  name: string;
  lines: AdjustLine[];
  resolution: ReactNode;
}

/**
 * Investment and Withdrawal render as two separate columns of these cards,
 * never merged -- adjustments are independent, never netted (PRD).
 */
export function AdjustPersonCard({ name, lines, resolution }: AdjustPersonCardProps) {
  return (
    <div className="mb-[11px] rounded-xl border border-border px-[15px] py-3.5 last:mb-0">
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

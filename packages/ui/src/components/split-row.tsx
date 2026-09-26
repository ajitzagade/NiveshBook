import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SplitRowProps {
  icon: ReactNode;
  iconColor: string;
  label: string;
  input: ReactNode;
  /** Sub-partner row: 24px left inset, matching `ShareRow`'s `isSub`/`nb-sub-row` indent precedent (founder feedback 2026-09-26). */
  isSub?: boolean;
}

/** Withdrawal Destination split line item (FR-27) -- one row per destination. */
export function SplitRow({ icon, iconColor, label, input, isSub }: SplitRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_130px] items-center gap-2.5 border-b border-border py-2.5 text-[13.4px] last:border-b-0",
        isSub && "ml-6",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-el text-[13px] text-white"
          style={{ background: iconColor }}
        >
          {icon}
        </span>
        {label}
      </div>
      {input}
    </div>
  );
}

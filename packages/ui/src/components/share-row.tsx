import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ShareRowProps {
  name: string;
  input: ReactNode;
  action?: ReactNode;
  /**
   * Sub-partner row: insets the whole row one hierarchy level (24px,
   * matching `nb-sub-row`'s indent precedent in tokens.css) so the
   * partner -> sub-partner tree is visible, not just the caller's "↳"
   * glyph (founder feedback 2026-09-26).
   */
  isSub?: boolean;
}

export function ShareRow({ name, input, action, isSub }: ShareRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_110px_70px] items-center gap-2.5 rounded-[10px] border border-border px-3 py-2.5",
        isSub && "ml-6",
      )}
    >
      <span className="font-semibold text-[13.4px]">{name}</span>
      {input}
      {action}
    </div>
  );
}

export function ShareList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2.5">{children}</div>;
}

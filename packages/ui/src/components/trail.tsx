import type { ReactNode } from "react";
import { Amount } from "./amount";

export interface TrailItemProps {
  dotColor: string;
  what: string;
  meta: string;
  amount: string | number;
}

export function Trail({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

/** One node in the vertical money-trail timeline (DESIGN.md). */
export function TrailItem({ dotColor, what, meta, amount }: TrailItemProps) {
  return (
    <div className="nb-trail-item">
      <span className="nb-trail-dot" style={{ background: dotColor }} />
      <div className="flex w-full items-start justify-between gap-2.5">
        <div>
          <div className="text-[13.4px] font-bold">{what}</div>
          <div className="mt-0.5 text-[11.8px] text-ink-faint">{meta}</div>
        </div>
        <Amount value={amount} size="sm" className="whitespace-nowrap font-bold" />
      </div>
    </div>
  );
}

export interface TraceBannerProps {
  children: ReactNode;
  action?: ReactNode;
}

/** Sits above a Trail when viewing a specific traced chain (FR-28, FR-30). */
export function TraceBanner({ children, action }: TraceBannerProps) {
  return (
    <div className="nb-trace-banner">
      <span>{children}</span>
      {action}
    </div>
  );
}

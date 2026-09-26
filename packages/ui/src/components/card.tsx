import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Opt-in dashboard-card elevation (founder feedback 2026-09-26):
   * `nb-card-elevated` (tokens.css) adds the hover lift + shadow-deepen
   * transition on top of `.nb-card`'s resting soft shadow. Default false --
   * every existing Card stays byte-for-byte unchanged.
   */
  elevated?: boolean;
}

export function Card({ elevated, className, ...props }: CardProps) {
  return <div className={cn("nb-card p-5", elevated && "nb-card-elevated", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-2.5 mb-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-[15.5px]", className)} {...props} />;
}

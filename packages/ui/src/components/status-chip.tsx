import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type StatusChipVariant = "success" | "danger" | "info" | "violet" | "neutral";

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant: StatusChipVariant;
}

/**
 * DESIGN.md: variant maps to transaction/adjustment meaning, not a generic
 * "state" -- always pair with a text label, never color alone (accessibility floor).
 */
export function StatusChip({ variant, className, children, ...props }: StatusChipProps) {
  return (
    <span className={cn("nb-chip", `nb-chip-${variant}`, className)} {...props}>
      {children}
    </span>
  );
}

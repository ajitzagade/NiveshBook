import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Boolean toggle input, styled consistently with `Input`'s border/focus
 * treatment (there's no dedicated `.checkbox` pattern in DESIGN.md yet).
 * Pair with a `<label>` wrapping both the checkbox and its text for a larger
 * click target. First consumer: the Add/Edit Partner dialog's Sub-partner
 * visibility grant toggle (Story 2.6).
 */
export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-4 w-4 rounded border border-border accent-accent",
        "focus:outline focus:outline-2 focus:outline-accent-soft",
        className,
      )}
      {...props}
      type="checkbox"
    />
  );
}

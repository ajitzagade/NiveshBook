import type { HTMLAttributes, LabelHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/** Field label matching the mockup's `.field-label` pattern (DESIGN.md). */
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[12px] font-bold text-ink-soft", className)}
      {...props}
    />
  );
}

/** Wraps one Label + Input(/Textarea) pair, matching the mockup's `.field` (16px bottom margin). */
export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4", className)} {...props} />;
}

/** Hint text under a field, matching the mockup's `.field-hint`. */
export function FieldHint({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1.5 text-[11.8px] text-ink-faint", className)} {...props} />;
}

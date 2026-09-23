import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Form text input matching the mockup's `.field .amt-input` pattern
 * (DESIGN.md): full-width, `radius-el`, `10px 12px` padding, tabular-nums
 * so any numeric value doesn't jitter. Pair with `Label` inside a form
 * field.
 */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink tabular-nums",
        "focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

/** Same visual treatment as `Input`, for a multi-line field (e.g. a Project's description). */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink",
        "focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

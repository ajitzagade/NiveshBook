import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Per-action tint for ghost buttons (founder feedback 2026-09-26) --
 * DESIGN.md's canonical nav-badge map: Add Money -> "success", Withdraw ->
 * "danger", Shares -> "info", Edit/default -> "accent", Structure/Available
 * Balance -> "violet"; destructive Cancel -> "danger". Omit the prop for
 * neutral actions (Cancel/Back/Close), which keep the plain ghost look.
 */
export type ButtonTone = "accent" | "success" | "danger" | "info" | "violet";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  /**
   * Appends `nb-btn-tone-*` (tokens.css) -- ghost variant only: a `tone`
   * passed alongside `variant="primary"` emits nothing (and the CSS rules
   * are additionally scoped to `.nb-btn-ghost`, so primary buttons never
   * change appearance even if the class leaked in via `className`).
   */
  tone?: ButtonTone;
  asChild?: boolean;
  /** Leading icon (lucide-react, 14px) -- see DESIGN.md.Components' `button` icon convention. */
  icon?: ReactNode;
}

export function Button({ variant = "primary", tone, asChild, icon, className, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const buttonClassName = cn(
    "nb-btn",
    variant === "primary" ? "nb-btn-primary" : "nb-btn-ghost",
    variant === "ghost" && tone ? `nb-btn-tone-${tone}` : undefined,
    icon ? "inline-flex items-center gap-1.5" : undefined,
    className,
  );

  // `Slot` (asChild) clones props onto its single child and keeps that
  // child's own children -- it can't also render our `icon` alongside them,
  // so `icon` only applies in normal (non-asChild) mode. Compose the icon
  // into the child element's own children at the call site instead.
  if (asChild) {
    return (
      <Comp className={buttonClassName} {...props}>
        {children}
      </Comp>
    );
  }

  return (
    <Comp className={buttonClassName} {...props}>
      {icon}
      {children}
    </Comp>
  );
}

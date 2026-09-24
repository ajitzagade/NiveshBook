import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  asChild?: boolean;
  /** Leading icon (lucide-react, 14px) -- see DESIGN.md.Components' `button` icon convention. */
  icon?: ReactNode;
}

export function Button({ variant = "primary", asChild, icon, className, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const buttonClassName = cn(
    "nb-btn",
    variant === "primary" ? "nb-btn-primary" : "nb-btn-ghost",
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

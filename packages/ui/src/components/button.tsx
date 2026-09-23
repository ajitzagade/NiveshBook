import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  asChild?: boolean;
}

export function Button({ variant = "primary", asChild, className, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "nb-btn",
        variant === "primary" ? "nb-btn-primary" : "nb-btn-ghost",
        className,
      )}
      {...props}
    />
  );
}

import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";
import { formatAmount } from "../lib/format-amount";

export type AmountTone = "default" | "success" | "danger" | "violet";

export interface AmountProps extends HTMLAttributes<HTMLSpanElement> {
  value: string | number;
  tone?: AmountTone;
  size?: "sm" | "md" | "lg" | "hero";
}

export const toneClass: Record<AmountTone, string> = {
  default: "",
  success: "text-success",
  danger: "text-danger",
  violet: "text-violet",
};

const sizeClass: Record<NonNullable<AmountProps["size"]>, string> = {
  sm: "text-[13.3px] font-semibold",
  md: "text-[13.3px]",
  lg: "text-[19px] font-bold",
  hero: "text-[27px] font-bold",
};

/**
 * The one shared formatter for every monetary value in the app (DESIGN.md
 * amount-display). Never interpolate a raw number into a template directly --
 * always route it through this component.
 */
export function Amount({ value, tone = "default", size = "md", className, ...props }: AmountProps) {
  return (
    // eslint-disable-next-line security/detect-object-injection -- size/tone are TS union types, not arbitrary strings
    <span className={cn("num", sizeClass[size], toneClass[tone], className)} {...props}>
      {formatAmount(value)}
    </span>
  );
}

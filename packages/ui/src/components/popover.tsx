import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  // Defensive viewport-edge hardening (spec-mobile-responsive-phase1-nav-
  // foundation, Decision #5): 16px matches the shell's own mobile content
  // padding (`layout.tsx`'s `max-[860px]:px-4`), so a collision-shifted
  // popover never sits flush against the screen edge. `avoidCollisions`
  // itself is left untouched -- Radix's own default (`true`) already
  // applies here, never explicitly disabled.
  collisionPadding = 16,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 rounded-el border border-border bg-surface p-2 shadow-card",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  // Defensive viewport-edge hardening (spec-mobile-responsive-phase1-nav-
  // foundation, Decision #5) -- see `popover.tsx`'s identical rationale:
  // 16px matches the shell's own mobile content padding, `avoidCollisions`
  // is left at Radix's own default (`true`), never disabled.
  collisionPadding = 16,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 min-w-[10rem] rounded-el border border-border bg-surface p-1 shadow-card",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "cursor-pointer rounded-[6px] px-2.5 py-1.5 text-[13px] text-ink outline-none data-[highlighted]:bg-surface-alt",
        className,
      )}
      {...props}
    />
  );
}

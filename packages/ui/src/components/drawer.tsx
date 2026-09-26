"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * Off-canvas navigation drawer (spec-mobile-responsive-phase1-nav-foundation)
 * -- the below-860px replacement for the in-flow stacked sidebar. Built on
 * Radix Dialog, the same primitive `Dialog`/`Popover`/`DropdownMenu`
 * (this folder) already build on, rather than a hand-rolled focus trap:
 * `Escape`-to-close, a focus trap while open, focus-restore to the trigger
 * on close, body scroll lock, and `role="dialog"`/`aria-modal` semantics
 * all come from Radix for free. The only genuinely new work here is
 * visual -- pinned to the left edge, full height, slides in on open.
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /**
   * Accessible name for the drawer -- Radix requires a `Dialog.Title` for
   * screen readers (`role="dialog"`/`aria-modal` semantics). Rendered
   * visually hidden (`sr-only`) since the panel's own content (logo + nav)
   * already makes its purpose obvious sighted.
   */
  title: string;
}

export function DrawerContent({ className, children, title, ...props }: DrawerContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
      <DialogPrimitive.Content
        // No `Dialog.Description` -- this panel's content is a nav list,
        // not prose that needs describing. Explicit `undefined` suppresses
        // Radix's dev-mode "missing aria-describedby" warning rather than
        // rendering an empty/meaningless description.
        aria-describedby={undefined}
        className={cn(
          "nb-drawer-panel fixed inset-y-0 left-0 z-50 flex h-full w-[248px] max-w-[80vw] flex-col gap-5 overflow-y-auto border-r border-border bg-surface p-4 shadow-card outline-none",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * spec-quick-add-user-share-dialog: Radix's `Dialog.Content` dismisses on
 * any "outside" pointerdown -- but a `Popover`/`DropdownMenu`/`Select`'s own
 * content is portaled to `document.body` as a *sibling* of the Dialog's
 * content, not a descendant, so Radix's own outside-click detection can't
 * tell it's logically still "inside" this Dialog. Without this guard, using
 * a `Combobox` (built on `Popover`) inside any `Dialog` would silently
 * close the whole Dialog the instant its popover's inline content is
 * clicked -- e.g. typing into the quick-add form or clicking its own
 * buttons. Every `Popper`-based Radix primitive (`Popover`, `DropdownMenu`,
 * etc.) marks its portaled wrapper with `data-radix-popper-content-wrapper`
 * (a stable, documented Radix internal), so checking for that ancestor is
 * the standard fix for this exact "Popover nested inside Dialog" class of
 * bug. A caller can still override by passing its own `onPointerDownOutside`
 * via `...props` (spread after this default, so it wins).
 */
function ignorePopperContentPointerDownOutside(
  event: CustomEvent<{ originalEvent: PointerEvent | FocusEvent }>,
) {
  // Duck-typed (`target?.closest` exists) rather than `instanceof Element`
  // -- this package has no jsdom devDependency (deliberately, see
  // `combobox.tsx`'s own doc comment), so `dialog.test.tsx` exercises this
  // with a plain mock object; a real `Element` satisfies the same check.
  const target = event.detail.originalEvent.target as { closest?: (selector: string) => unknown } | null;
  if (target?.closest?.("[data-radix-popper-content-wrapper]")) {
    event.preventDefault();
  }
}

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-surface p-6 shadow-card",
          className,
        )}
        onPointerDownOutside={ignorePopperContentPointerDownOutside}
        onFocusOutside={ignorePopperContentPointerDownOutside}
        onInteractOutside={ignorePopperContentPointerDownOutside}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-[15.5px] font-bold", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn("mt-1.5 text-[13px] text-ink-soft", className)} {...props} />
  );
}

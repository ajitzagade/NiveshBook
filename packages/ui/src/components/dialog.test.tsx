import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { DialogContent } from "./dialog";

/** `DialogContent` is a plain function component -- calling it directly and inspecting the returned `Portal > [Overlay, Content]` tree needs no DOM, mirroring `popover.test.tsx`'s established pattern. */
function radixContentPropsOf(portal: ReactElement) {
  const children = (portal.props as { children: ReactElement[] }).children;
  const content = children[1] as ReactElement;
  return content.props as {
    onPointerDownOutside?: (event: unknown) => void;
    onFocusOutside?: (event: unknown) => void;
    onInteractOutside?: (event: unknown) => void;
  };
}

/** A minimal duck-typed stand-in for a DOM node -- this package has no jsdom devDependency (deliberately, see `combobox.tsx`'s own doc comment), so the guard under test is written to only need `.closest()`, not a real `Element`. */
function makeOutsideEvent(insidePopperWrapper: boolean) {
  const target = { closest: (selector: string) => (insidePopperWrapper && selector.includes("popper") ? {} : null) };
  const preventDefault = vi.fn();
  return { event: { detail: { originalEvent: { target } }, preventDefault }, preventDefault };
}

/**
 * spec-quick-add-user-share-dialog: a `Combobox`'s `Popover` portals its
 * content to `document.body` as a *sibling* of the Dialog's own content, so
 * Radix's default outside-click detection can't tell it's logically still
 * "inside" the Dialog -- without this guard, using a `Combobox` inside any
 * `Dialog` would silently close the whole Dialog the instant its popover's
 * content is clicked (found via `apps/web`'s own jsdom-backed
 * `shares/page.test.tsx`, which composes this for real).
 */
describe("DialogContent outside-interaction guard (spec-quick-add-user-share-dialog)", () => {
  it("ignores a pointerdown/focus/interact-outside event whose target is inside a Radix popper content wrapper", () => {
    const portal = DialogContent({ children: "x" }) as ReactElement;
    const props = radixContentPropsOf(portal);

    const { event, preventDefault } = makeOutsideEvent(true);
    props.onPointerDownOutside?.(event);
    props.onFocusOutside?.(event);
    props.onInteractOutside?.(event);

    expect(preventDefault).toHaveBeenCalledTimes(3);
  });

  it("does not interfere with a genuine outside click (e.g. the backdrop) -- never calls preventDefault", () => {
    const portal = DialogContent({ children: "x" }) as ReactElement;
    const props = radixContentPropsOf(portal);

    const { event, preventDefault } = makeOutsideEvent(false);
    props.onPointerDownOutside?.(event);

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("a caller-supplied onPointerDownOutside overrides the default (props spread after it)", () => {
    const override = vi.fn();
    const portal = DialogContent({ children: "x", onPointerDownOutside: override }) as ReactElement;
    const props = radixContentPropsOf(portal);
    expect(props.onPointerDownOutside).toBe(override);
  });
});

import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { PopoverContent } from "./popover";

/** `PopoverContent` is a plain function component -- calling it directly and inspecting the returned `Portal > Content` tree needs no DOM, mirroring `button.test.tsx`'s established pattern. */
function radixContentPropsOf(portal: ReactElement) {
  const contentEl = (portal.props as { children: ReactElement }).children;
  return contentEl.props as { collisionPadding?: number; sideOffset?: number; align?: string };
}

describe("PopoverContent collision handling (spec-mobile-responsive-phase1-nav-foundation, Decision #5)", () => {
  it("defaults collisionPadding to 16, matching the shell's mobile content padding", () => {
    const portal = PopoverContent({ children: "x" }) as ReactElement;
    expect(radixContentPropsOf(portal).collisionPadding).toBe(16);
  });

  it("an explicit collisionPadding overrides the 16px default", () => {
    const portal = PopoverContent({ children: "x", collisionPadding: 24 }) as ReactElement;
    expect(radixContentPropsOf(portal).collisionPadding).toBe(24);
  });

  it("keeps its existing sideOffset/align defaults untouched by the new prop", () => {
    const portal = PopoverContent({ children: "x" }) as ReactElement;
    const props = radixContentPropsOf(portal);
    expect(props.sideOffset).toBe(6);
    expect(props.align).toBe("start");
  });
});

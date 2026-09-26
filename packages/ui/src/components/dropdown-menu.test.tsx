import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { DropdownMenuContent } from "./dropdown-menu";

/** `DropdownMenuContent` is a plain function component -- same direct-call pattern as `popover.test.tsx`. */
function radixContentPropsOf(portal: ReactElement) {
  const contentEl = (portal.props as { children: ReactElement }).children;
  return contentEl.props as { collisionPadding?: number; sideOffset?: number };
}

describe("DropdownMenuContent collision handling (spec-mobile-responsive-phase1-nav-foundation, Decision #5)", () => {
  it("defaults collisionPadding to 16, matching the shell's mobile content padding", () => {
    const portal = DropdownMenuContent({ children: "x" }) as ReactElement;
    expect(radixContentPropsOf(portal).collisionPadding).toBe(16);
  });

  it("an explicit collisionPadding overrides the 16px default", () => {
    const portal = DropdownMenuContent({ children: "x", collisionPadding: 24 }) as ReactElement;
    expect(radixContentPropsOf(portal).collisionPadding).toBe(24);
  });

  it("keeps its existing sideOffset default untouched by the new prop", () => {
    const portal = DropdownMenuContent({ children: "x" }) as ReactElement;
    expect(radixContentPropsOf(portal).sideOffset).toBe(6);
  });
});

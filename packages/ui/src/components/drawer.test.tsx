import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { DrawerContent } from "./drawer";

/**
 * `DrawerContent` is a plain function component (no hooks of its own --
 * `Drawer`/`DrawerTrigger`/`DrawerClose` are bare Radix re-exports) so it
 * can be called directly and its returned element tree walked without a
 * DOM, mirroring `button.test.tsx`/`card.test.tsx`'s established pattern
 * in this package (no `@testing-library`/jsdom dependency here).
 */
function childrenOf(element: ReactElement): ReactElement[] {
  const children = (element.props as { children: ReactNode | ReactNode[] }).children;
  return (Array.isArray(children) ? children : [children]) as ReactElement[];
}

describe("DrawerContent (spec-mobile-responsive-phase1-nav-foundation)", () => {
  it("renders a full-screen Overlay behind a left-pinned, full-height panel", () => {
    const portal = DrawerContent({ title: "Navigation", children: "nav" }) as ReactElement;
    const [overlay, content] = childrenOf(portal);

    expect((overlay.props as { className: string }).className).toContain("fixed inset-0");

    const contentClassName = (content.props as { className: string }).className;
    expect(contentClassName).toContain("fixed");
    expect(contentClassName).toContain("inset-y-0");
    expect(contentClassName).toContain("left-0");
    expect(contentClassName).toContain("h-full");
    // The 2026-09-24 Tailwind/packages-ui gotcha (AGENTS.md): a slide-in
    // animation defined ONLY as a class name (`nb-drawer-panel`, tokens.css)
    // is easy to silently drop -- pin that the class is actually emitted.
    expect(contentClassName).toContain("nb-drawer-panel");
  });

  it("carries an accessible, visually-hidden title for screen readers (role=dialog semantics)", () => {
    const portal = DrawerContent({ title: "Navigation", children: "nav" }) as ReactElement;
    const [, content] = childrenOf(portal);
    const [titleEl] = childrenOf(content);

    expect((titleEl.props as { className: string }).className).toContain("sr-only");
    expect((titleEl.props as { children: string }).children).toBe("Navigation");
  });

  it("suppresses the aria-describedby dev warning by default (no meaningful Description to give)", () => {
    const portal = DrawerContent({ title: "Navigation", children: "nav" }) as ReactElement;
    const [, content] = childrenOf(portal);

    expect((content.props as { "aria-describedby"?: unknown })["aria-describedby"]).toBeUndefined();
  });

  it("renders the given children inside the panel, after the hidden title", () => {
    const portal = DrawerContent({ title: "Navigation", children: <span>nav-body</span> }) as ReactElement;
    const [, content] = childrenOf(portal);
    const [, bodyEl] = childrenOf(content);

    expect(bodyEl.type).toBe("span");
    expect((bodyEl.props as { children: string }).children).toBe("nav-body");
  });
});

import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { PersonCard } from "./person-card";

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

function childrenOf(element: ReactElement): ReactNode[] {
  const children = (element.props as { children: ReactNode | ReactNode[] }).children;
  return Array.isArray(children) ? children : [children];
}

/** The `.nb-person-nest` wrapper element among the card's children, if any. */
function nestOf(element: ReactElement): ReactElement | undefined {
  return childrenOf(element).find(
    (child): child is ReactElement =>
      typeof child === "object" &&
      child !== null &&
      "props" in child &&
      typeof (child.props as { className?: unknown }).className === "string" &&
      ((child.props as { className: string }).className.includes("nb-person-nest")),
  );
}

describe("PersonCard role tint (spec-partner-hierarchy-cards, 2026-09-26)", () => {
  it("a partner card emits the teal tint classes", () => {
    const el = PersonCard({ role: "partner", name: "A" }) as ReactElement;
    expect(classNameOf(el)).toContain("nb-person-card");
    expect(classNameOf(el)).toContain("nb-person-card-partner");
    expect(classNameOf(el)).not.toContain("nb-person-card-sub");
  });

  it("a sub-partner card emits the violet tint classes", () => {
    const el = PersonCard({ role: "sub_partner", name: "S" }) as ReactElement;
    expect(classNameOf(el)).toContain("nb-person-card");
    expect(classNameOf(el)).toContain("nb-person-card-sub");
    expect(classNameOf(el)).not.toContain("nb-person-card-partner");
  });
});

describe("PersonCard nested rail section", () => {
  it("renders `nested` content inside the .nb-person-nest rail wrapper", () => {
    const el = PersonCard({ role: "partner", name: "A", nested: "subs" }) as ReactElement;
    const nest = nestOf(el);
    expect(nest).toBeDefined();
    expect((nest?.props as { children: ReactNode }).children).toBe("subs");
  });

  it("a partner without subs emits NO empty nested section (frozen I/O matrix row 2)", () => {
    for (const nested of [undefined, null, false as const]) {
      const el = PersonCard({ role: "partner", name: "A", nested }) as ReactElement;
      expect(nestOf(el)).toBeUndefined();
    }
  });

  // Review fix (2026-09-26): `partner.subPartners.map(...)` resolving to an
  // empty array is truthy but has nothing to render -- must be treated the
  // same as null/undefined/false, not render an empty rail.
  it("an empty array `nested` (e.g. zero-length .map() result) emits NO empty nested section", () => {
    const el = PersonCard({ role: "partner", name: "A", nested: [] }) as ReactElement;
    expect(nestOf(el)).toBeUndefined();
  });

  it("a non-empty array `nested` still renders the rail", () => {
    const el = PersonCard({ role: "partner", name: "A", nested: ["sub-one"] }) as ReactElement;
    expect(nestOf(el)).toBeDefined();
  });

  it("header wraps (flex-wrap) so wide action sets can never paint past the card edge", () => {
    const el = PersonCard({ role: "partner", name: "A", action: "buttons" }) as ReactElement;
    const header = childrenOf(el)[0] as ReactElement;
    expect(classNameOf(header)).toContain("flex-wrap");
  });
});

describe("PersonCard accessibility (review fix, 2026-09-26)", () => {
  /**
   * The sr-only label is a SIBLING of the name span, not nested inside it
   * (review-fix-of-the-review-fix): nesting it merges into the name span's
   * own text, breaking every exact-text lookup keyed on the plain name --
   * this only surfaces against a real browser (Playwright's text engine
   * reads the full descendant subtree), not jsdom/RTL's default
   * direct-text-node-only matcher, so it's asserted explicitly here.
   */
  it("a partner card carries an sr-only 'Partner' label as a SIBLING of the (unmodified) visible name span", () => {
    const el = PersonCard({ role: "partner", name: "Asha" }) as ReactElement;
    const header = childrenOf(el)[0] as ReactElement;
    const headerChildren = childrenOf(header);
    const nameSpan = headerChildren[0] as ReactElement;
    const srLabel = headerChildren.find(
      (child): child is ReactElement =>
        typeof child === "object" &&
        child !== null &&
        "props" in child &&
        (child.props as { className?: unknown }).className === "sr-only",
    );
    // The name span's own children are untouched -- just `{name}`, nothing appended.
    expect(childrenOf(nameSpan)).toEqual(["Asha"]);
    expect(srLabel).toBeDefined();
    expect(srLabel).not.toBe(nameSpan);
    expect((srLabel?.props as { children: ReactNode }).children).toBe("Partner");
  });

  it("a sub-partner card carries an sr-only 'Sub-partner' label", () => {
    const el = PersonCard({ role: "sub_partner", name: "Bala" }) as ReactElement;
    const header = childrenOf(el)[0] as ReactElement;
    const srLabel = childrenOf(header).find(
      (child): child is ReactElement =>
        typeof child === "object" &&
        child !== null &&
        "props" in child &&
        (child.props as { className?: unknown }).className === "sr-only",
    );
    expect((srLabel?.props as { children: ReactNode }).children).toBe("Sub-partner");
  });
});

describe("PersonCard className (review fix, 2026-09-26)", () => {
  it("merges a caller-supplied className onto the root element, alongside the tint classes", () => {
    const el = PersonCard({ role: "partner", name: "A", className: "my-marker" }) as ReactElement;
    expect(classNameOf(el)).toContain("my-marker");
    expect(classNameOf(el)).toContain("nb-person-card-partner");
  });
});

import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { Button } from "./button";

/**
 * Pins the founder-feedback tone-class emission (2026-09-26) without a DOM:
 * `Button` is a plain function component, so calling it returns the element
 * whose `className` these tests inspect directly -- matching this package's
 * existing pure-function vitest setup (`format-amount.test.ts`), no jsdom.
 */
function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

describe("Button tone (founder feedback 2026-09-26)", () => {
  it('tone="success" on the ghost variant emits nb-btn-tone-success', () => {
    const el = Button({ variant: "ghost", tone: "success", children: "x" });
    expect(classNameOf(el)).toContain("nb-btn-ghost");
    expect(classNameOf(el)).toContain("nb-btn-tone-success");
  });

  it("every tone maps to its own nb-btn-tone-* class on ghost", () => {
    for (const tone of ["accent", "success", "danger", "info", "violet"] as const) {
      const el = Button({ variant: "ghost", tone, children: "x" });
      expect(classNameOf(el)).toContain(`nb-btn-tone-${tone}`);
    }
  });

  it("a tone alongside the primary variant emits NO tone class -- primary buttons never change", () => {
    const el = Button({ variant: "primary", tone: "success", children: "x" });
    expect(classNameOf(el)).toContain("nb-btn-primary");
    expect(classNameOf(el)).not.toContain("nb-btn-tone-");
  });

  it("no tone emits no tone class on either variant", () => {
    expect(classNameOf(Button({ variant: "ghost", children: "x" }))).not.toContain("nb-btn-tone-");
    expect(classNameOf(Button({ children: "x" }))).not.toContain("nb-btn-tone-");
  });
});

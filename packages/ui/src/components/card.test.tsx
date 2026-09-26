import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { Card } from "./card";

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

describe("Card elevated (founder feedback 2026-09-26, Decision 8)", () => {
  it("elevated emits nb-card-elevated on top of the base card classes", () => {
    const el = Card({ elevated: true }) as ReactElement;
    expect(classNameOf(el)).toContain("nb-card");
    expect(classNameOf(el)).toContain("nb-card-elevated");
    // The 2026-09-24 padding gotcha: elevation must never drop the p-5.
    expect(classNameOf(el)).toContain("p-5");
  });

  it("default Card stays byte-for-byte un-elevated", () => {
    const el = Card({}) as ReactElement;
    expect(classNameOf(el)).toContain("nb-card");
    expect(classNameOf(el)).not.toContain("nb-card-elevated");
  });
});

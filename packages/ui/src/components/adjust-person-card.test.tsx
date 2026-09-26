import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { AdjustPersonCard } from "./adjust-person-card";

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

describe("AdjustPersonCard isSub (founder feedback 2026-09-26)", () => {
  it("isSub emits the one-hierarchy-level ml-6 (24px) inset", () => {
    const el = AdjustPersonCard({ name: "Sub", lines: [], resolution: null, isSub: true }) as ReactElement;
    expect(classNameOf(el)).toContain("ml-6");
  });

  it("a partner-level card emits no inset", () => {
    const el = AdjustPersonCard({ name: "Partner", lines: [], resolution: null }) as ReactElement;
    expect(classNameOf(el)).not.toContain("ml-6");
  });
});

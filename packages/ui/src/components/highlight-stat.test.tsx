import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { HighlightStat } from "./highlight-stat";

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

describe("HighlightStat", () => {
  it("carries the tone's border and soft-background classes on the root element", () => {
    const el = HighlightStat({ icon: "icon", label: "Pending to Pay", value: "0", tone: "amber" }) as ReactElement;
    expect(classNameOf(el)).toContain("border-amber");
    expect(classNameOf(el)).toContain("bg-amber-soft");
  });

  it("renders a distinct tone for a different card without mixing classes", () => {
    const el = HighlightStat({ icon: "icon", label: "Extra Paid", value: "325000", tone: "success" }) as ReactElement;
    expect(classNameOf(el)).toContain("border-success");
    expect(classNameOf(el)).toContain("bg-success-soft");
    expect(classNameOf(el)).not.toContain("border-amber");
  });

  it("merges a caller-supplied className onto the root element", () => {
    const el = HighlightStat({
      icon: "icon",
      label: "Keep for Later",
      value: "312500",
      tone: "accent",
      className: "my-marker",
    }) as ReactElement;
    expect(classNameOf(el)).toContain("my-marker");
  });
});

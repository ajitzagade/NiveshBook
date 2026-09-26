import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { ShareRow } from "./share-row";

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

describe("ShareRow isSub (founder feedback 2026-09-26)", () => {
  it("isSub emits the one-hierarchy-level ml-6 (24px) inset", () => {
    const el = ShareRow({ name: "↳ Sub", input: null, isSub: true }) as ReactElement;
    expect(classNameOf(el)).toContain("ml-6");
  });

  it("a partner-level row emits no inset", () => {
    const el = ShareRow({ name: "Partner", input: null }) as ReactElement;
    expect(classNameOf(el)).not.toContain("ml-6");
  });
});

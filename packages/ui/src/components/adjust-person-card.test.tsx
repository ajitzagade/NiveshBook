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

describe("AdjustPersonCard role tint (spec-partner-hierarchy-cards, 2026-09-26)", () => {
  it("role=partner emits the teal tint class and drops the plain border-border (the tint carries the border color)", () => {
    const el = AdjustPersonCard({ name: "P", lines: [], resolution: null, role: "partner" }) as ReactElement;
    expect(classNameOf(el)).toContain("nb-person-card-partner");
    expect(classNameOf(el)).not.toContain("border-border");
  });

  it("role=sub_partner emits the violet tint class, composable with isSub (kept separate concerns)", () => {
    const el = AdjustPersonCard({
      name: "S",
      lines: [],
      resolution: null,
      role: "sub_partner",
      isSub: true,
    }) as ReactElement;
    expect(classNameOf(el)).toContain("nb-person-card-sub");
    expect(classNameOf(el)).toContain("ml-6");
  });

  it("no role keeps the exact plain border-border className, unchanged by the new role/tint machinery", () => {
    const el = AdjustPersonCard({ name: "N", lines: [], resolution: null }) as ReactElement;
    // Exact string, not just `.toContain` -- proves the role/tint additions
    // never leak an extra/reordered class into the no-role case (review fix,
    // 2026-09-26: the original "byte-for-byte" claim here wasn't actually
    // checked).
    expect(classNameOf(el)).toBe("mb-[11px] rounded-xl border px-[15px] py-3.5 last:mb-0 border-border");
  });
});

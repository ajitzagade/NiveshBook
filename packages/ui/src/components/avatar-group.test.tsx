import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { AvatarGroup } from "./avatar-group";

function childrenOf(element: ReactElement): ReactNode[] {
  const children = (element.props as { children: ReactNode | ReactNode[] }).children;
  return Array.isArray(children) ? children : [children];
}

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

describe("AvatarGroup", () => {
  it("renders one circle per item, showing its initials", () => {
    const el = AvatarGroup({ items: [{ id: "1", initials: "PA" }] }) as ReactElement;
    const [visible] = childrenOf(el) as [ReactElement[], ReactNode];
    expect(visible).toHaveLength(1);
    expect((visible[0].props as { children: ReactNode }).children).toBe("PA");
  });

  it("offsets every circle after the first (overlapping stack)", () => {
    const el = AvatarGroup({
      items: [
        { id: "1", initials: "PA" },
        { id: "2", initials: "PB" },
      ],
    }) as ReactElement;
    const [visible] = childrenOf(el) as [ReactElement[], ReactNode];
    expect(classNameOf(visible[0])).not.toContain("-ml-2");
    expect(classNameOf(visible[1])).toContain("-ml-2");
  });

  it("collapses items beyond max into a +N circle", () => {
    const el = AvatarGroup({
      items: [
        { id: "1", initials: "PA" },
        { id: "2", initials: "PB" },
        { id: "3", initials: "PC" },
      ],
      max: 2,
    }) as ReactElement;
    const [visible, overflow] = childrenOf(el) as [ReactElement[], ReactElement];
    expect(visible).toHaveLength(2);
    expect((overflow.props as { children: ReactNode }).children).toEqual(["+", 1]);
  });

  it("renders no +N circle when items fit within max", () => {
    const el = AvatarGroup({ items: [{ id: "1", initials: "PA" }], max: 4 }) as ReactElement;
    const [, overflow] = childrenOf(el);
    expect(overflow).toBeNull();
  });
});

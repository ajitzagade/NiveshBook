import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { StatCard } from "./stat-card";

function childrenOf(element: ReactElement): ReactNode[] {
  const children = (element.props as { children: ReactNode | ReactNode[] }).children;
  return Array.isArray(children) ? children : [children];
}

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

describe("StatCard icon prop (additive)", () => {
  it("renders no icon wrapper when icon is omitted, byte-for-byte the pre-existing layout", () => {
    const el = StatCard({ label: "Money Added", value: "1500000" }) as ReactElement;
    const [iconSlot, labelDiv] = childrenOf(el) as [ReactNode, ReactElement];
    expect(iconSlot).toBeNull();
    expect((labelDiv.props as { children: ReactNode }).children).toBe("Money Added");
  });

  it("renders the icon in a tinted circle above the label when set", () => {
    const el = StatCard({ label: "Projects", value: 3, format: "count", icon: "icon", iconTone: "accent" }) as ReactElement;
    const [iconWrapper, labelDiv] = childrenOf(el) as ReactElement[];
    expect(classNameOf(iconWrapper)).toContain("bg-accent-soft");
    expect((labelDiv.props as { children: ReactNode }).children).toBe("Projects");
  });

  it("defaults iconTone to neutral when an icon is given without one", () => {
    const el = StatCard({ label: "Projects", value: 3, format: "count", icon: "icon" }) as ReactElement;
    const [iconWrapper] = childrenOf(el) as ReactElement[];
    expect(classNameOf(iconWrapper)).toContain("bg-surface-alt");
  });
});

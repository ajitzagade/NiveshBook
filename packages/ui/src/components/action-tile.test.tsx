import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { ActionTile } from "./action-tile";

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

function childrenOf(element: ReactElement): ReactNode[] {
  const children = (element.props as { children: ReactNode | ReactNode[] }).children;
  return Array.isArray(children) ? children : [children];
}

describe("ActionTile", () => {
  it("renders a static (non-link) tile when href is omitted", () => {
    const el = ActionTile({ icon: "icon", label: "Available Balance", tone: "amber" }) as ReactElement;
    expect(el.type).toBe("div");
    expect(classNameOf(el)).toContain("nb-card");
  });

  it("renders an <a> tile when href is set", () => {
    const el = ActionTile({ icon: "icon", label: "Add Money", tone: "success", href: "/projects" }) as ReactElement;
    expect(el.type).toBe("a");
    expect((el.props as { href: string }).href).toBe("/projects");
  });

  it("applies the tone's icon-circle classes to the icon wrapper, not the label", () => {
    const el = ActionTile({ icon: "icon", label: "Withdraw Money", tone: "accent" }) as ReactElement;
    const [content] = childrenOf(el) as [ReactElement];
    const [iconWrapper, labelSpan] = childrenOf(content) as ReactElement[];
    expect(classNameOf(iconWrapper)).toContain("bg-accent-soft");
    expect(classNameOf(iconWrapper)).toContain("text-accent");
    expect(classNameOf(labelSpan)).not.toContain("bg-accent-soft");
  });

  it("renders the label text", () => {
    const el = ActionTile({ icon: "icon", label: "New Project", tone: "neutral" }) as ReactElement;
    const [content] = childrenOf(el) as [ReactElement];
    const [, labelSpan] = childrenOf(content) as ReactElement[];
    expect((labelSpan.props as { children: ReactNode }).children).toBe("New Project");
  });
});

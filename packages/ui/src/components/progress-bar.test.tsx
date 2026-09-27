import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { ProgressBar } from "./progress-bar";

function childrenOf(element: ReactElement): ReactNode[] {
  const children = (element.props as { children: ReactNode | ReactNode[] }).children;
  return Array.isArray(children) ? children : [children];
}

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

describe("ProgressBar", () => {
  it("sets the fill width and trailing label to the given percent", () => {
    const el = ProgressBar({ percent: 50 }) as ReactElement;
    const [track, label] = childrenOf(el) as [ReactElement, ReactElement];
    const [fill] = childrenOf(track) as [ReactElement];
    expect((fill.props as { style: { width: string } }).style.width).toBe("50%");
    expect((label.props as { children: ReactNode }).children).toEqual([50, "%"]);
  });

  it("clamps a percent above 100 down to 100", () => {
    const el = ProgressBar({ percent: 250 }) as ReactElement;
    const [track] = childrenOf(el) as [ReactElement];
    expect((track.props as { "aria-valuenow": number })["aria-valuenow"]).toBe(100);
  });

  it("clamps a negative percent up to 0", () => {
    const el = ProgressBar({ percent: -10 }) as ReactElement;
    const [track] = childrenOf(el) as [ReactElement];
    expect((track.props as { "aria-valuenow": number })["aria-valuenow"]).toBe(0);
  });

  it("uses the success fill class by default, and the given tone otherwise", () => {
    const defaultEl = ProgressBar({ percent: 100 }) as ReactElement;
    const [defaultTrack] = childrenOf(defaultEl) as [ReactElement];
    const [defaultFill] = childrenOf(defaultTrack) as [ReactElement];
    expect(classNameOf(defaultFill)).toContain("bg-success");

    const amberEl = ProgressBar({ percent: 100, tone: "amber" }) as ReactElement;
    const [amberTrack] = childrenOf(amberEl) as [ReactElement];
    const [amberFill] = childrenOf(amberTrack) as [ReactElement];
    expect(classNameOf(amberFill)).toContain("bg-amber");
  });
});

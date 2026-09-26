import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { RowCard } from "./row-card";

function classNameOf(element: ReactElement): string {
  return (element.props as { className: string }).className;
}

function childrenOf(element: ReactElement): ReactNode[] {
  const children = (element.props as { children: ReactNode | ReactNode[] }).children;
  return Array.isArray(children) ? children : [children];
}

describe("RowCard (spec-mobile-responsive-phase2-table-cards, Decision #1)", () => {
  it("renders the title in the header row, alongside an optional badge", () => {
    const el = RowCard({ title: "Sunrise Towers", badge: "Cancelled", fields: [] }) as ReactElement;
    const header = childrenOf(el)[0] as ReactElement;
    const headerChildren = childrenOf(header);
    expect((headerChildren[0] as ReactElement).props).toMatchObject({ children: "Sunrise Towers" });
    expect(headerChildren[1]).toBe("Cancelled");
  });

  it("renders no badge slot content when omitted", () => {
    const el = RowCard({ title: "A", fields: [] }) as ReactElement;
    const header = childrenOf(el)[0] as ReactElement;
    expect(childrenOf(header)[1]).toBeUndefined();
  });

  it("renders one label/value row per field, in order, preserving every field passed in (no silent data loss)", () => {
    const el = RowCard({
      title: "A",
      fields: [
        { label: "Description", value: "A residential project" },
        { label: "Status", value: "Active" },
      ],
    }) as ReactElement;
    // children: [header, fields.map(...) result (an array), action-or-null]
    const rows = childrenOf(el)[1] as ReactElement[];
    expect(rows).toHaveLength(2);
    const firstRowChildren = childrenOf(rows[0]);
    const firstLabel = firstRowChildren[0] as ReactElement;
    expect((firstLabel.props as { children: ReactNode }).children).toBe("Description");
    const firstValue = firstRowChildren[1] as ReactElement;
    expect((firstValue.props as { children: ReactNode }).children).toBe("A residential project");
    const secondRowChildren = childrenOf(rows[1]);
    const secondLabel = secondRowChildren[0] as ReactElement;
    expect((secondLabel.props as { children: ReactNode }).children).toBe("Status");
    const secondValue = secondRowChildren[1] as ReactElement;
    expect((secondValue.props as { children: ReactNode }).children).toBe("Active");
  });

  it("renders no action row when action is omitted", () => {
    const el = RowCard({ title: "A", fields: [] }) as ReactElement;
    // children: [header, [] (zero field rows), null (no action)].
    const children = childrenOf(el);
    expect(children).toHaveLength(3);
    expect(children[1]).toEqual([]);
    expect(children[2]).toBeNull();
  });

  it("renders the action row in a flex-wrap container (Decision #4: a wide action set wraps rather than being clipped or hidden)", () => {
    const el = RowCard({ title: "A", fields: [], action: "buttons" }) as ReactElement;
    const actionRow = childrenOf(el)[2] as ReactElement;
    expect(classNameOf(actionRow)).toContain("flex-wrap");
    expect((actionRow.props as { children: ReactNode }).children).toBe("buttons");
  });

  it("merges onClick onto the root element and adds the interactive/hover affordance classes", () => {
    let clicked = false;
    const onClick = () => {
      clicked = true;
    };
    const el = RowCard({ title: "A", fields: [], onClick }) as ReactElement;
    expect(classNameOf(el)).toContain("cursor-pointer");
    expect((el.props as { onClick?: () => void }).onClick).toBe(onClick);
    (el.props as { onClick: () => void }).onClick();
    expect(clicked).toBe(true);
  });

  it("emits no interactive classes when onClick is omitted (non-interactive card, e.g. Audit History)", () => {
    const el = RowCard({ title: "A", fields: [] }) as ReactElement;
    expect(classNameOf(el)).not.toContain("cursor-pointer");
    expect((el.props as { onClick?: () => void }).onClick).toBeUndefined();
  });

  it("merges a caller-supplied className onto the root element", () => {
    const el = RowCard({ title: "A", fields: [], className: "my-marker" }) as ReactElement;
    expect(classNameOf(el)).toContain("my-marker");
  });

  it("keys field rows by label+index, not label alone, so two fields sharing a label don't collide (review fix)", () => {
    const el = RowCard({
      title: "A",
      fields: [
        { label: "Amount", value: "1" },
        { label: "Amount", value: "2" },
      ],
    }) as ReactElement;
    const rows = childrenOf(el)[1] as ReactElement[];
    expect(rows.map((row) => row.key)).toEqual(["Amount-0", "Amount-1"]);
  });
});

describe("RowCard keyboard/assistive-tech reachability (review fix: a clickable card is the primary mobile touch target)", () => {
  it("adds role=button, tabIndex=0, and an onKeyDown handler when onClick is set", () => {
    const el = RowCard({ title: "A", fields: [], onClick: () => {} }) as ReactElement;
    const props = el.props as { role?: string; tabIndex?: number; onKeyDown?: unknown };
    expect(props.role).toBe("button");
    expect(props.tabIndex).toBe(0);
    expect(typeof props.onKeyDown).toBe("function");
  });

  it("Enter and Space both trigger onClick via onKeyDown; other keys don't", () => {
    let calls = 0;
    const onClick = () => {
      calls += 1;
    };
    const el = RowCard({ title: "A", fields: [], onClick }) as ReactElement;
    const onKeyDown = (el.props as { onKeyDown: (event: { key: string; preventDefault: () => void }) => void })
      .onKeyDown;

    onKeyDown({ key: "Enter", preventDefault: () => {} });
    onKeyDown({ key: " ", preventDefault: () => {} });
    onKeyDown({ key: "Tab", preventDefault: () => {} });

    expect(calls).toBe(2);
  });

  it("emits no role/tabIndex/onKeyDown when onClick is omitted (non-interactive card)", () => {
    const el = RowCard({ title: "A", fields: [] }) as ReactElement;
    const props = el.props as { role?: string; tabIndex?: number; onKeyDown?: unknown };
    expect(props.role).toBeUndefined();
    expect(props.tabIndex).toBeUndefined();
    expect(props.onKeyDown).toBeUndefined();
  });

  it("threads `hint` through as both the title attribute and aria-label when the card is clickable", () => {
    const el = RowCard({
      title: "A",
      fields: [],
      onClick: () => {},
      hint: "View this entry's money trail",
    }) as ReactElement;
    const props = el.props as { title?: string; ["aria-label"]?: string };
    expect(props.title).toBe("View this entry's money trail");
    expect(props["aria-label"]).toBe("View this entry's money trail");
  });

  it("ignores `hint` when onClick is omitted (non-interactive card)", () => {
    const el = RowCard({ title: "A", fields: [], hint: "should be ignored" }) as ReactElement;
    const props = el.props as { title?: string; ["aria-label"]?: string };
    expect(props.title).toBeUndefined();
    expect(props["aria-label"]).toBeUndefined();
  });
});

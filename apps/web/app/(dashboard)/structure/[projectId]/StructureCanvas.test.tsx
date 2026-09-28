// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MoneyFlowEdge, OwnershipStructureTree } from "@niveshbook/core";
import type { Money } from "@niveshbook/types";
import { StructureCanvas } from "./StructureCanvas";

/**
 * Mocks the heavy pieces of `@xyflow/react` (`ReactFlow`/`Background`/
 * `Controls`) rather than mounting the real diagram -- mirrors `page.test.tsx`'s
 * own documented rationale one level up (this codebase has no established
 * pattern for `<ReactFlow>` under jsdom; it needs `ResizeObserver`/layout-
 * measurement APIs jsdom doesn't provide). `Handle`/`Position` are left as
 * the real exports (via `importActual`) since `StructureNodeCard` still
 * references them, but this stub `ReactFlow` never actually invokes
 * `nodeTypes` against `nodes`, so they're never exercised at runtime here.
 * `structure-layout.test.ts` covers the real node/edge transform this
 * component feeds into `<ReactFlow>`.
 */
let lastReactFlowProps: Record<string, unknown> | null = null;
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@xyflow/react");
  return {
    ...actual,
    ReactFlow: (props: { children?: ReactNode } & Record<string, unknown>) => {
      lastReactFlowProps = props;
      return <div data-testid="react-flow-stub">{props.children}</div>;
    },
    Background: () => <div data-testid="background" />,
    Controls: () => <div data-testid="controls" />,
  };
});

function makeTree(overrides: Partial<OwnershipStructureTree> = {}): OwnershipStructureTree {
  return {
    scope: { type: "project" },
    partners: [],
    soloSubPartner: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  lastReactFlowProps = null;
});

describe("StructureCanvas narrow-viewport tuning (spec-mobile-responsive-phase1-nav-foundation, Decision #4)", () => {
  it("the container collapses to 380px tall below 600px, on top of the existing 520px default", () => {
    const { container } = render(
      <StructureCanvas
        tree={makeTree()}
        viewMode="percentage"
        projectName="Project A"
        onSelectPartner={() => {}}
        moneyFlowEdges={[]}
      />,
    );

    const canvasContainer = container.firstElementChild as HTMLElement;
    expect(canvasContainer.className).toContain("h-[520px]");
    expect(canvasContainer.className).toContain("max-[600px]:h-[380px]");
  });

  it("caps minZoom (and fitViewOptions.minZoom) low enough that the initial fit never crops on a phone viewport", () => {
    render(
      <StructureCanvas
        tree={makeTree()}
        viewMode="percentage"
        projectName="Project A"
        onSelectPartner={() => {}}
        moneyFlowEdges={[]}
      />,
    );

    expect(lastReactFlowProps).not.toBeNull();
    expect(lastReactFlowProps?.fitView).toBe(true);
    expect(lastReactFlowProps?.minZoom).toBeLessThan(1);
    expect((lastReactFlowProps?.fitViewOptions as { minZoom?: number } | undefined)?.minZoom).toBeLessThan(1);
  });
});

describe("StructureCanvas Money Flow edges (founder feedback 2026-09-28)", () => {
  it("passes an external counterparty node and a flow edge through to ReactFlow when moneyFlowEdges is set in Money Flow mode", () => {
    const tree = makeTree({
      partners: [
        {
          type: "partner",
          partnerId: "a",
          name: "Partner A",
          sharePercent: "60" as OwnershipStructureTree["partners"][number]["sharePercent"],
          actualAmount: "0" as OwnershipStructureTree["partners"][number]["actualAmount"],
          totalIn: "0" as OwnershipStructureTree["partners"][number]["totalIn"],
          totalOut: "0" as OwnershipStructureTree["partners"][number]["totalOut"],
          subPartners: [],
        },
      ],
    });

    render(
      <StructureCanvas
        tree={tree}
        viewMode="money_flow"
        projectName="Project A"
        onSelectPartner={() => {}}
        moneyFlowEdges={[
          {
            id: "flow-1",
            partyType: "partner",
            shareId: "a",
            direction: "out",
            counterpartyKind: "project",
            counterpartyLabel: "Project B",
            amount: "10000" as Money,
          } satisfies MoneyFlowEdge,
        ]}
      />,
    );

    const nodes = lastReactFlowProps?.nodes as { id: string; data: { kind: string } }[] | undefined;
    const edges = lastReactFlowProps?.edges as { id: string }[] | undefined;
    expect(nodes?.some((n) => n.data.kind === "external")).toBe(true);
    expect(edges?.some((e) => e.id === "flow:flow-1")).toBe(true);
  });
});

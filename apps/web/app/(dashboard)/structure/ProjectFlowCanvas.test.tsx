// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProjectFlowCanvas } from "./ProjectFlowCanvas";

/**
 * Mocks the heavy pieces of `@xyflow/react` -- mirrors `structure/
 * [projectId]/StructureCanvas.test.tsx`'s identical rationale (no
 * established pattern for `<ReactFlow>` under jsdom).
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

afterEach(() => {
  cleanup();
  lastReactFlowProps = null;
});

describe("ProjectFlowCanvas draggability parity (2026-09-28 fix)", () => {
  it("no longer passes nodesDraggable={false} to ReactFlow -- founder-reported gap vs. the per-Project canvas, which was already draggable", () => {
    render(
      <ProjectFlowCanvas
        projects={[{ id: "p1", name: "Project A", availableBalance: null }]}
        movements={[]}
        onSelectProject={() => {}}
      />,
    );

    expect(lastReactFlowProps).not.toBeNull();
    expect(lastReactFlowProps?.nodesDraggable).not.toBe(false);
  });

  it("passes an onNodesChange handler, mirroring StructureCanvas.tsx's identical drag-to-reposition wiring", () => {
    render(
      <ProjectFlowCanvas
        projects={[{ id: "p1", name: "Project A", availableBalance: null }]}
        movements={[]}
        onSelectProject={() => {}}
      />,
    );

    expect(typeof lastReactFlowProps?.onNodesChange).toBe("function");
  });

  it("a dragged position survives, and 'Reset layout' clears it, mirroring StructureCanvas.tsx's identical UX", () => {
    const { getByRole, queryByRole } = render(
      <ProjectFlowCanvas
        projects={[{ id: "p1", name: "Project A", availableBalance: null }]}
        movements={[]}
        onSelectProject={() => {}}
      />,
    );

    expect(queryByRole("button", { name: /reset layout/i })).not.toBeInTheDocument();

    const onNodesChange = lastReactFlowProps?.onNodesChange as (changes: unknown[]) => void;
    act(() => {
      onNodesChange([{ type: "position", id: "p1", position: { x: 42, y: 99 } }]);
    });

    expect(getByRole("button", { name: /reset layout/i })).toBeInTheDocument();
    const nodes = lastReactFlowProps?.nodes as Array<{ id: string; position: { x: number; y: number } }>;
    const draggedNode = nodes.find((node) => node.id === "p1");
    expect(draggedNode?.position).toEqual({ x: 42, y: 99 });
  });
});

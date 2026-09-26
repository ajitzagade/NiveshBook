"use client";

import { useMemo } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Amount } from "@niveshbook/ui";
import { buildNodesAndEdges, type NodeDisplay, type StructureNode, type StructureNodeData, type ViewMode } from "./structure-layout";
import type { OwnershipStructureTree } from "@niveshbook/core";

/**
 * Story 5.10: the `@xyflow/react` wrapper -- the ONLY file in this story
 * that imports `@xyflow/react`'s runtime (everything else works with the
 * pure `structure-layout.ts` transform). Custom-styled nodes match this
 * codebase's existing token/Card visual language rather than the library's
 * default look (this story's Decision #1) -- see `StructureNodeCard` below.
 *
 * Node positions are entirely deterministic (`buildNodesAndEdges`) -- pan/
 * zoom stay enabled (the library's own free default, this story's Decision
 * #1 leaves this to the implementer), but dragging is disabled per node
 * (`draggable: false`, set in `structure-layout.ts`) since there is no
 * persisted custom layout to drag into.
 *
 * Review finding (High): every field this component renders arrives via
 * `data.display` -- an already-resolved `NodeDisplay` from
 * `structure-layout.ts`'s `computeDisplay()` (which view-mode figure to show,
 * and for Percentage mode, whether that figure is a Partner's retained % or
 * their own share %). This component itself performs NO selection logic of
 * its own anymore -- `ModeFigure` below only pattern-matches `display.mode`
 * to pick which (already-decided) JSX/formatting to render, mirroring
 * `structure-layout.test.ts`'s own unit coverage of that decision. This is
 * the deliberately narrow, genuinely-`@xyflow/react`-only surface this
 * story's testing boundary describes.
 */

const HANDLE_STYLE = { opacity: 0, width: 1, height: 1 } as const;

function StructureNodeCard({ data }: NodeProps<StructureNode>) {
  return (
    <div className="nb-card w-[190px] rounded-el border border-border bg-surface p-3 text-center shadow-sm">
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <StructureNodeContent data={data} />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} isConnectable={false} />
    </div>
  );
}

function StructureNodeContent({ data }: { data: StructureNodeData }) {
  if (data.kind === "project") {
    return <p className="text-[13.4px] font-bold text-ink">{data.label}</p>;
  }

  if (data.kind === "partner") {
    return (
      <button
        type="button"
        onClick={data.onSelect}
        className="flex w-full flex-col items-center gap-1 text-center"
        title={`View ${data.name}'s own scoped structure`}
      >
        <p className="text-[13px] font-semibold text-ink">{data.name}</p>
        <ModeFigure display={data.display} />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-[12.6px] font-semibold text-ink-soft">↳ {data.name}</p>
      <ModeFigure display={data.display} />
    </div>
  );
}

function ModeFigure({ display }: { display: NodeDisplay }) {
  if (display.mode === "percentage") {
    return (
      <p className="font-mono text-[13.4px] tabular-nums text-ink-soft">
        {display.label}: {display.value}%
      </p>
    );
  }
  if (display.mode === "actual") {
    return <Amount value={display.value} size="sm" />;
  }
  return (
    <div className="flex flex-col items-center gap-0.5 text-[12px]">
      <span className="flex items-center gap-1 text-success">
        In <Amount value={display.totalIn} size="sm" tone="success" />
      </span>
      <span className="flex items-center gap-1 text-danger">
        Out <Amount value={display.totalOut} size="sm" tone="danger" />
      </span>
    </div>
  );
}

const NODE_TYPES = { structureNode: StructureNodeCard };

export interface StructureCanvasProps {
  tree: OwnershipStructureTree;
  viewMode: ViewMode;
  projectName: string;
  onSelectPartner: (partnerId: string) => void;
}

/** Renders one already-scoped `OwnershipStructureTree` as a diagram -- `nodes`/`edges` are recomputed only when `tree`/`viewMode`/`projectName` change (Decision #7: a view-mode switch never re-fetches, and this `useMemo` means it never even re-runs the layout math for a change that only affects `onSelectPartner`'s closure identity). */
export function StructureCanvas({ tree, viewMode, projectName, onSelectPartner }: StructureCanvasProps) {
  const { nodes, edges } = useMemo(
    () => buildNodesAndEdges(tree, viewMode, projectName, onSelectPartner),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onSelectPartner` is recreated by the parent every render but is stable in behavior; including it would defeat this memo's "view-mode switch never recomputes layout for an unrelated reason" purpose.
    [tree, viewMode, projectName],
  );

  return (
    <div className="h-[520px] w-full overflow-hidden rounded-el border border-border bg-surface-alt">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

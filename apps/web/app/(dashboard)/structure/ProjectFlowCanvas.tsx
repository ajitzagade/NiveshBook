"use client";

import { useMemo } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FolderKanban } from "lucide-react";
import { Amount } from "@niveshbook/ui";
import {
  buildProjectFlowNodesAndEdges,
  type ProjectFlowNode,
  type ProjectFlowNodeInput,
  type ProjectFlowMovementInput,
} from "./project-flow-layout";

/**
 * All-Projects Money Flow view's `@xyflow/react` wrapper -- mirrors
 * `structure/[projectId]/StructureCanvas.tsx`'s exact shape one level up
 * (the ONLY file here that imports `@xyflow/react`'s runtime; the pure
 * `project-flow-layout.ts` transform stays independently unit-testable).
 * Deliberately no drag-to-reposition here (unlike the per-project canvas) --
 * a project-count grid rarely needs it, and this view is meant to stay a
 * lightweight entry point into each Project's own already-full-featured
 * `/structure/[projectId]` diagram, not a second place to fine-tune layout.
 */

const HANDLE_STYLE = { opacity: 0, width: 1, height: 1 } as const;

function ProjectFlowNodeCard({ data }: NodeProps<ProjectFlowNode>) {
  return (
    <div className="nb-card w-[190px] rounded-el border border-border bg-surface p-3 text-center shadow-sm">
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <button type="button" onClick={data.onSelect} className="flex w-full flex-col items-center gap-1.5 text-center">
        <FolderKanban size={16} className="text-ink-faint" />
        <p className="text-[13.4px] font-bold text-ink">{data.name}</p>
        {data.availableBalance !== null ? (
          <p className="text-[11.6px] text-ink-soft">
            <Amount value={data.availableBalance} size="sm" /> available
          </p>
        ) : null}
      </button>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { projectFlowNode: ProjectFlowNodeCard };

export interface ProjectFlowCanvasProps {
  projects: readonly ProjectFlowNodeInput[];
  movements: readonly ProjectFlowMovementInput[];
  onSelectProject: (projectId: string) => void;
}

export function ProjectFlowCanvas({ projects, movements, onSelectProject }: ProjectFlowCanvasProps) {
  const { nodes, edges } = useMemo(
    () => buildProjectFlowNodesAndEdges(projects, movements, onSelectProject),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onSelectProject` is recreated by the parent every render but stable in behavior, mirroring `StructureCanvas.tsx`'s identical `onSelectPartner` precedent.
    [projects, movements],
  );

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-el border border-border bg-surface-alt max-[600px]:h-[380px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ minZoom: 0.2, padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

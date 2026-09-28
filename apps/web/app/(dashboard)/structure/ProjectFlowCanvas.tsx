"use client";

import { useCallback, useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FolderKanban, RotateCcw } from "lucide-react";
import { Amount, Button } from "@niveshbook/ui";
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
 *
 * Drag-to-reposition (2026-09-28 fix): brought to parity with the
 * per-Project canvas, which already had it -- the computed grid layout can
 * converge edges/labels the same way the per-Project Money Flow view can,
 * and a founder-reported "not draggable" gap here was otherwise a real,
 * confirmed inconsistency between the two canvases with no reason behind
 * it. `positionOverrides` mirrors `StructureCanvas.tsx`'s identical
 * "manually-dragged positions, keyed by node id, merged over the computed
 * position on every render" shape -- session-only, resets on a fresh
 * `projects`/`movements` identity (a real data change), never persisted.
 *
 * `key={nodeIdsKey}` on `<ReactFlow>` (2026-09-28, same day): `fitView`
 * only ever runs on `<ReactFlow>`'s own initial mount, never again on a
 * later `nodes` change -- mirrors `StructureCanvas.tsx`'s identical,
 * already-documented gotcha one level up. That was invisible here before
 * the Project-name search filter existed (the node set was set once after
 * the initial fetch and never changed again), but a search that narrows 50
 * Projects down to 6 now changes the node set without remounting
 * `<ReactFlow>` -- the viewport stayed fit to the ORIGINAL full set, so the
 * new, smaller set rendered outside the visible pan/zoom (a blank canvas,
 * confirmed live: nodes existed in the DOM, none of them on-screen). Keying
 * on the sorted, joined node ids forces a fresh instance (and therefore a
 * fresh `fitView`) exactly when the visible node set changes, never on an
 * unrelated re-render.
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

  // Manually-dragged positions, keyed by node id -- mirrors
  // `StructureCanvas.tsx`'s identical state shape/rationale.
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>({});

  const onNodesChange = useCallback((changes: NodeChange<ProjectFlowNode>[]) => {
    const positionChanges = changes.filter(
      (change): change is Extract<NodeChange<ProjectFlowNode>, { type: "position" }> =>
        change.type === "position" && change.position !== undefined,
    );
    if (positionChanges.length === 0) {
      return;
    }
    setPositionOverrides((prev) => {
      const next = { ...prev };
      for (const change of positionChanges) {
        next[change.id] = change.position as { x: number; y: number };
      }
      return next;
    });
  }, []);

  const positionedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const override = positionOverrides[node.id];
        return override ? { ...node, position: override } : node;
      }),
    [nodes, positionOverrides],
  );

  // A real `projects`/`movements` change (not just `onSelectProject`'s
  // closure identity) is a different graph -- clear any dragged positions
  // rather than carry them over, mirroring `StructureCanvas.tsx`'s
  // identical "adjusting state during render" pattern for its own
  // `scopeKey` change (deliberately not a `useEffect`, which would fire the
  // reset one render late).
  const [lastNodesRef, setLastNodesRef] = useState(nodes);
  if (nodes !== lastNodesRef) {
    setLastNodesRef(nodes);
    setPositionOverrides({});
  }

  const nodeIdsKey = useMemo(
    () =>
      nodes
        .map((node) => node.id)
        .sort()
        .join(","),
    [nodes],
  );

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-el border border-border bg-surface-alt max-[600px]:h-[380px]">
      {Object.keys(positionOverrides).length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<RotateCcw size={13} />}
          onClick={() => setPositionOverrides({})}
          className="absolute right-2 top-2 z-10 bg-surface shadow-sm"
        >
          Reset layout
        </Button>
      ) : null}
      <ReactFlow
        key={nodeIdsKey}
        nodes={positionedNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ minZoom: 0.2, padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

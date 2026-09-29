"use client";

import { useCallback, useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FolderKanban, HelpCircle, RotateCcw, User, Wallet } from "lucide-react";
import type { MoneyFlowEdge } from "@niveshbook/core";
import { Amount, Button, formatAmount } from "@niveshbook/ui";
import {
  buildFullFlowNodesAndEdges,
  type FullFlowNode,
  type FullFlowNodeData,
  type FullFlowProjectInput,
} from "./full-flow-layout";

/**
 * Full Flow tab's `@xyflow/react` wrapper (2026-09-29) -- the ONLY file for
 * this tab that imports the library's runtime; the pure `full-flow-layout.ts`
 * transform stays independently unit-testable, mirroring
 * `ProjectFlowCanvas.tsx` / `structure/[projectId]/StructureCanvas.tsx`'s
 * identical shape. Drag-to-reposition (`positionOverrides`), the
 * clear-on-real-data-change reset, and the `key={nodeIdsKey}` fitView
 * remount gotcha are all carried over verbatim from `ProjectFlowCanvas.tsx`
 * -- same rationale, same session-only semantics.
 *
 * Node cards render DESIGN.md's `{components.flow-tree-card}`: white card,
 * 3px left border colored by node kind (accent Project / info Partner /
 * ink-faint Sub-partner / violet dashed external), kicker line (role +
 * share %), name, ₹ In · ₹ Out figures. Handles are Left/Right (the
 * founder's reference layout reads left-to-right), unlike the per-Project
 * canvas's Top/Bottom.
 */

const HANDLE_STYLE = { opacity: 0, width: 1, height: 1 } as const;

const COUNTERPARTY_ICON: Record<MoneyFlowEdge["counterpartyKind"], typeof FolderKanban> = {
  project: FolderKanban,
  person: User,
  available_balance: Wallet,
  other: HelpCircle,
};

function cardClassName(kind: FullFlowNodeData["kind"]): string {
  if (kind === "external") {
    return "w-[210px] rounded-card border border-dashed border-border border-l-[3px] border-l-violet bg-surface-alt p-3";
  }
  const leftBorder = kind === "project" ? "border-l-accent" : kind === "partner" ? "border-l-info" : "border-l-ink-faint";
  return `nb-card w-[210px] rounded-card border border-border border-l-[3px] ${leftBorder} bg-surface p-3 shadow-sm`;
}

function FullFlowNodeCard({ data }: NodeProps<FullFlowNode>) {
  return (
    <div className={cardClassName(data.kind)}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable={false} />
      <FullFlowNodeContent data={data} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable={false} />
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">{children}</p>;
}

function InOutFigures({ totalIn, totalOut }: { totalIn: string; totalOut: string }) {
  return (
    <p className="mt-0.5 text-[12px] text-ink-soft">
      In <Amount value={totalIn} size="sm" tone="success" className="font-semibold" /> · Out{" "}
      <Amount value={totalOut} size="sm" tone="danger" className="font-semibold" />
    </p>
  );
}

function FullFlowNodeContent({ data }: { data: FullFlowNodeData }) {
  if (data.kind === "project") {
    return (
      <button type="button" onClick={data.onSelect} className="flex w-full flex-col items-start gap-0.5 text-left" title={`View ${data.name}'s own Money Flow`}>
        <Kicker>Project</Kicker>
        <p className="flex items-center gap-1.5 text-[13.4px] font-bold text-ink">
          <FolderKanban size={14} className="text-ink-faint" /> {data.name}
        </p>
        {data.availableBalance !== null ? (
          <p className="text-[12px] text-ink-soft">
            <Amount value={data.availableBalance} size="sm" /> available
          </p>
        ) : null}
        {/* The cross-Project link stated in words -- never reliant on tracing
            an arrow (or on color) alone, per EXPERIENCE.md's Full Flow tree
            no-disconnection rule. */}
        {data.inFrom.map((entry, index) => (
          <span
            key={`${entry.label}:${index}`}
            className="mt-1 rounded-chip bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info"
          >
            {formatAmount(entry.amount)} in from {entry.label}
          </span>
        ))}
      </button>
    );
  }

  if (data.kind === "partner") {
    return (
      <div className="flex flex-col gap-0.5">
        <Kicker>
          Partner · {data.percentValue}% {data.percentLabel === "Own, after sub-split" ? "own, after sub-split" : ""}
        </Kicker>
        <p className="text-[13.4px] font-bold text-ink">{data.name}</p>
        <InOutFigures totalIn={data.totalIn} totalOut={data.totalOut} />
      </div>
    );
  }

  if (data.kind === "sub_partner") {
    return (
      <div className="flex flex-col gap-0.5">
        <Kicker>Sub-partner · {data.percentValue}% of Project</Kicker>
        <p className="text-[13.4px] font-bold text-ink">{data.name}</p>
        <InOutFigures totalIn={data.totalIn} totalOut={data.totalOut} />
      </div>
    );
  }

  // "external" -- a money-flow counterparty outside this canvas's visible
  // set. Plain and non-interactive, mirroring `StructureCanvas.tsx`'s
  // identical boundary: a labeled reference, never a link into data the
  // viewer can't otherwise see.
  const Icon = COUNTERPARTY_ICON[data.counterpartyKind];
  return (
    <div className="flex flex-col gap-0.5 text-ink-faint">
      <Kicker>{data.counterpartyKind === "available_balance" ? "Available Balance" : data.counterpartyKind === "project" ? "Project" : data.counterpartyKind === "person" ? "Person" : "Other"}</Kicker>
      <p className="flex items-center gap-1.5 text-[12.6px] font-semibold">
        <Icon size={13} /> {data.label}
      </p>
    </div>
  );
}

const NODE_TYPES = { fullFlowNode: FullFlowNodeCard };

export interface FullFlowCanvasProps {
  projects: FullFlowProjectInput[];
  onSelectProject: (projectId: string) => void;
}

export function FullFlowCanvas({ projects, onSelectProject }: FullFlowCanvasProps) {
  const { nodes, edges } = useMemo(
    () => buildFullFlowNodesAndEdges(projects, onSelectProject),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onSelectProject` is recreated by the parent every render but stable in behavior; mirrors both sibling canvases' identical memo rationale.
    [projects],
  );

  // Manually-dragged positions, keyed by node id -- mirrors
  // `ProjectFlowCanvas.tsx`'s identical state shape/rationale.
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>({});

  const onNodesChange = useCallback((changes: NodeChange<FullFlowNode>[]) => {
    const positionChanges = changes.filter(
      (change): change is Extract<NodeChange<FullFlowNode>, { type: "position" }> =>
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

  // A real `projects` change is a different graph -- clear any dragged
  // positions rather than carry them over ("adjusting state during render",
  // mirroring both sibling canvases).
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
    <div className="relative h-[560px] w-full overflow-hidden rounded-el border border-border bg-surface-alt max-[600px]:h-[380px]">
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
        fitViewOptions={{ minZoom: 0.2, padding: 0.15 }}
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

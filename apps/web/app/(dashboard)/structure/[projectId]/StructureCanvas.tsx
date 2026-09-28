"use client";

import { useMemo } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FolderKanban, HelpCircle, User, Wallet } from "lucide-react";
import { Amount } from "@niveshbook/ui";
import { buildNodesAndEdges, type NodeDisplay, type StructureNode, type StructureNodeData, type ViewMode } from "./structure-layout";
import type { MoneyFlowEdge, OwnershipStructureTree } from "@niveshbook/core";

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
    <div
      className={
        data.kind === "external"
          ? "w-[190px] rounded-el border border-dashed border-border bg-surface-alt p-3 text-center"
          : "nb-card w-[190px] rounded-el border border-border bg-surface p-3 text-center shadow-sm"
      }
    >
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
        title={`View ${data.name}'s own structure`}
      >
        <p className="text-[13px] font-semibold text-ink">{data.name}</p>
        <ModeFigure display={data.display} />
      </button>
    );
  }

  if (data.kind === "sub_partner") {
    return (
      <div className="flex flex-col items-center gap-1">
        <p className="text-[12.6px] font-semibold text-ink-soft">↳ {data.name}</p>
        <ModeFigure display={data.display} />
      </div>
    );
  }

  // "external" -- a real money-flow counterparty (Money Flow view mode
  // only): another Project, a Person, "Other", or the Available Balance
  // pool. Deliberately plain and non-interactive -- no `onClick`/`title`
  // navigation hint, mirroring `structure-layout.ts`'s own doc comment: this
  // is a labeled reference, never a link into that Project's own tree/
  // shares (the same boundary `GET /api/money-history` already ships).
  const Icon = COUNTERPARTY_ICON[data.counterpartyKind];
  return (
    <div className="flex flex-col items-center gap-1 text-ink-faint">
      <Icon size={14} />
      <p className="text-[12.6px] font-semibold">{data.label}</p>
    </div>
  );
}

const COUNTERPARTY_ICON: Record<MoneyFlowEdge["counterpartyKind"], typeof FolderKanban> = {
  project: FolderKanban,
  person: User,
  available_balance: Wallet,
  other: HelpCircle,
};

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
  /** Real money-flow edges (founder feedback 2026-09-28) -- only ever rendered in Money Flow view mode; see `buildNodesAndEdges`'s own doc comment. */
  moneyFlowEdges: MoneyFlowEdge[];
}

/** Renders one already-scoped `OwnershipStructureTree` as a diagram -- `nodes`/`edges` are recomputed only when `tree`/`viewMode`/`projectName`/`moneyFlowEdges` change (Decision #7: a view-mode switch never re-fetches, and this `useMemo` means it never even re-runs the layout math for a change that only affects `onSelectPartner`'s closure identity). */
export function StructureCanvas({ tree, viewMode, projectName, onSelectPartner, moneyFlowEdges }: StructureCanvasProps) {
  const { nodes, edges } = useMemo(
    () => buildNodesAndEdges(tree, viewMode, projectName, onSelectPartner, moneyFlowEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onSelectPartner` is recreated by the parent every render but is stable in behavior; including it would defeat this memo's "view-mode switch never recomputes layout for an unrelated reason" purpose.
    [tree, viewMode, projectName, moneyFlowEdges],
  );

  // `fitView` (below) only ever runs on `<ReactFlow>`'s OWN initial mount,
  // never again on a later `nodes` change -- founder feedback 2026-09-28:
  // switching into Money Flow mode adds a whole new row of external nodes
  // below the existing tree, and without a remount here that new row landed
  // outside the already-fitted viewport (edges ran off the bottom of the
  // canvas). Keying on the scope + view mode forces a fresh `<ReactFlow>`
  // instance (and therefore a fresh `fitView`) exactly when the node set's
  // own bounding box can change -- a view-mode switch or a drill-down --
  // never on an unrelated re-render (e.g. `onSelectPartner`'s closure
  // identity changing).
  const scopeKey =
    tree.scope.type === "partner"
      ? `partner:${tree.scope.partnerId}`
      : tree.scope.type === "sub_partner"
        ? `sub_partner:${tree.scope.subPartnerId}`
        : "project";
  const canvasKey = `${scopeKey}:${viewMode}`;

  return (
    // spec-mobile-responsive-phase1-nav-foundation (Decision #4): a fixed
    // 520px container went off the bottom of a 375px-tall phone viewport
    // (minus the browser chrome/top bar/page header above it) -- 380px
    // below 600px keeps the whole diagram, plus its Controls, on-screen at
    // first paint. Node width (190px) stays as-is; pan/zoom (below) already
    // handles any horizontal overflow that causes.
    <div className="h-[520px] w-full overflow-hidden rounded-el border border-border bg-surface-alt max-[600px]:h-[380px]">
      <ReactFlow
        key={canvasKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        // `fitView` alone can still crop on a narrow phone viewport if the
        // computed fit would need to zoom in past 1x to fill it -- capping
        // `minZoom` well below 1 (and `fitViewOptions.minZoom` to match)
        // guarantees the initial fit can always shrink the whole tree to
        // fit rather than crop it.
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

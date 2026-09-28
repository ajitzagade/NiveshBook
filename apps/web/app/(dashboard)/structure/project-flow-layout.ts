import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { formatAmount } from "@niveshbook/ui";

/**
 * All-Projects Money Flow view (item 3's redesign) -- a pure
 * project-to-project transform, separated from `ProjectFlowCanvas.tsx` (the
 * `"use client"` component that mounts `@xyflow/react`) so it stays
 * unit-testable under jsdom, mirroring `structure/[projectId]/
 * structure-layout.ts`'s identical testing-boundary rationale one level up:
 * each node here is a whole Project (not a Partner/Sub-partner within one),
 * and each edge is a real cross-project money movement (Story 4.8's
 * `MoneyMovement`, aggregated per source/destination pair since several
 * individual movements can share the same two Projects). The per-project
 * Partner/Sub-partner breakdown stays on the existing
 * `/structure/[projectId]` page, reached by clicking a node here -- this
 * view deliberately never re-renders that tree inline (this feature's own
 * "avoid unnecessary complexity" constraint, plus `/structure/[projectId]`
 * already does that job well).
 */

export interface ProjectFlowNodeInput {
  id: string;
  name: string;
  /** `null` when this session isn't authorized to see it (`available_balances:view` is `owner_admin`-only) -- rendered as a dash, never a fabricated zero. */
  availableBalance: string | null;
}

export interface ProjectFlowMovementInput {
  sourceProjectId: string;
  destinationProjectId: string;
  amount: string;
}

export interface ProjectFlowNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  availableBalance: string | null;
  onSelect: () => void;
}

export type ProjectFlowNode = Node<ProjectFlowNodeData, "projectFlowNode">;

const NODE_X_GAP = 220;
const NODE_Y_GAP = 160;
const GRID_COLUMNS = 4;

/**
 * A simple grid layout -- unlike the per-project ownership tree, there's no
 * inherent hierarchy across Projects to arrange around, so nodes are placed
 * in reading order (this list's own order, e.g. `listMyProjects()`'s).
 */
function projectPosition(index: number): { x: number; y: number } {
  return { x: (index % GRID_COLUMNS) * NODE_X_GAP, y: Math.floor(index / GRID_COLUMNS) * NODE_Y_GAP };
}

/**
 * Sums every movement sharing the same (source, destination) pair into one
 * edge -- plain `Number()` arithmetic (display-only, matching `shares/
 * page.tsx`'s established "never itself stored" precedent), so two Partners
 * both moving money from the same Project A into the same Project B on
 * different days still draw as a single labeled arrow, not overlapping
 * duplicates.
 */
function aggregateMovements(
  movements: readonly ProjectFlowMovementInput[],
): { sourceProjectId: string; destinationProjectId: string; total: number }[] {
  const totals = new Map<string, { sourceProjectId: string; destinationProjectId: string; total: number }>();
  for (const movement of movements) {
    const key = `${movement.sourceProjectId}:${movement.destinationProjectId}`;
    const existing = totals.get(key);
    const amount = Number(movement.amount);
    if (existing) {
      existing.total += amount;
    } else {
      totals.set(key, {
        sourceProjectId: movement.sourceProjectId,
        destinationProjectId: movement.destinationProjectId,
        total: amount,
      });
    }
  }
  return [...totals.values()];
}

export function buildProjectFlowNodesAndEdges(
  projects: readonly ProjectFlowNodeInput[],
  movements: readonly ProjectFlowMovementInput[],
  onSelectProject: (projectId: string) => void,
): { nodes: ProjectFlowNode[]; edges: Edge[] } {
  const nodes: ProjectFlowNode[] = projects.map((project, index) => ({
    id: project.id,
    type: "projectFlowNode",
    position: projectPosition(index),
    data: {
      id: project.id,
      name: project.name,
      availableBalance: project.availableBalance,
      onSelect: () => onSelectProject(project.id),
    },
  }));

  const projectIds = new Set(projects.map((project) => project.id));
  const edges: Edge[] = aggregateMovements(movements)
    // Defensive -- a movement whose source/destination isn't in this same
    // (identically role-scoped) project list is silently skipped rather
    // than drawing a dangling edge, mirroring `structure-layout.ts`'s
    // identical guard for a flow edge whose owning node isn't in its tree.
    .filter((entry) => projectIds.has(entry.sourceProjectId) && projectIds.has(entry.destinationProjectId))
    .map((entry) => ({
      id: `movement:${entry.sourceProjectId}:${entry.destinationProjectId}`,
      source: entry.sourceProjectId,
      target: entry.destinationProjectId,
      label: formatAmount(entry.total.toFixed(2)),
      labelStyle: { fill: "var(--color-info)", fontWeight: 700, fontSize: 13 },
      labelBgStyle: { fill: "var(--color-surface)", fillOpacity: 0.92 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      style: { stroke: "var(--color-info)", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-info)" },
    }));

  return { nodes, edges };
}

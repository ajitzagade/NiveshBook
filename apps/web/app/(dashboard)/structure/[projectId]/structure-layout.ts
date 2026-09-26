import type { Edge, Node } from "@xyflow/react";
import type { OwnershipStructurePartnerNode, OwnershipStructureSubPartnerNode, OwnershipStructureTree } from "@niveshbook/core";

/**
 * Story 5.10's pure tree-to-diagram transform -- deliberately separated from
 * `StructureCanvas.tsx` (the `"use client"` component that actually mounts
 * `@xyflow/react`) so this logic can be unit-tested directly, without
 * mounting `<ReactFlow>` itself (which needs `ResizeObserver`/layout
 * measurement APIs jsdom doesn't provide -- see this story's Implementation
 * Notes for the full testing-boundary rationale). `Node`/`Edge` are
 * type-only imports -- no runtime `@xyflow/react` code loads just from
 * importing this module.
 */

export type ViewMode = "percentage" | "actual" | "money_flow";

export const VIEW_MODES: readonly { value: ViewMode; label: string }[] = [
  { value: "percentage", label: "Percentage" },
  { value: "actual", label: "Actual Amount" },
  { value: "money_flow", label: "Money Flow" },
];

/**
 * Postgres's `numeric(7,4)` `sharePercent` column round-trips padded
 * (`"33.33"` reads back `"33.3300"`) -- trims trailing fractional zeros for
 * display only, mirroring `shares/page.tsx`'s own `formatSharePercent`
 * (duplicated locally per this codebase's established per-module
 * local-helper convention for this exact function).
 */
export function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Rounds to 4 decimal places and trims trailing zeros/decimal point, so a
 * display-only difference never shows binary-float noise -- byte-for-byte
 * duplicated from `shares/page.tsx`'s own `formatDifference` (this story's
 * Decision #2: the exact same formula, duplicated per this codebase's
 * established per-module convention, never centralized).
 */
export function formatDifference(value: number): string {
  return (Math.round(value * 10000) / 10000).toString();
}

/**
 * A Partner's retained % label for Percentage mode (I/O matrix row 3) --
 * `sharePercent - sum(current Sub-partner sharePercent)`, exactly mirroring
 * `shares/page.tsx`'s `retainedMessage` formula: plain `Number()` arithmetic
 * (display-only, never stored), deliberately never clamped -- a Partner who
 * over-allocated their Sub-partners shows a NEGATIVE retained % here too,
 * matching that page's own documented behavior (property 4 of this story).
 * A Partner with zero current Sub-partners simply gets back their own
 * `sharePercent` unchanged (subtracting a sum of `[]`, i.e. 0).
 */
export function computeRetainedPercent(partner: OwnershipStructurePartnerNode): string {
  const subTotal = partner.subPartners.reduce((sum, sub) => sum + Number(sub.sharePercent), 0);
  return formatDifference(Number(partner.sharePercent) - subTotal);
}

/**
 * Review finding (High, post-implementation review): the ORIGINAL shape here
 * handed `StructureCanvas.tsx` every raw field (`sharePercent`,
 * `retainedPercent`, `hasSubPartners`, `actualAmount`, `totalIn`, `totalOut`,
 * `viewMode`) and left it to pick which one to render via two ternaries --
 * `hasSubPartners ? retainedPercent : sharePercent` (matrix row 3's literal
 * acceptance criterion: a Partner WITH Sub-partners shows retained %, one
 * WITHOUT shows their own share) and a 3-way `viewMode` branch (matrix row
 * 2: "every node relabels per the new mode"). Both were real, untested
 * selection logic living inside the one file this story's own testing
 * boundary said was `@xyflow/react`-only and therefore untestable under
 * jsdom -- a flipped ternary there would have passed every automated test.
 *
 * `NodeDisplay` moves that selection HERE instead: `computeDisplay()` is
 * given the already-resolved percent label/value (itself derived from
 * `hasSubPartners`, computed once in `partnerNodeData`/`subPartnerNodeData`
 * below) and the requested `viewMode`, and returns the one figure that
 * mode actually renders -- fully unit-testable with zero `@xyflow/react`
 * dependency. `StructureCanvas.tsx` now only pattern-matches `display.mode`
 * to pick which (already-decided) JSX to render -- a trivial render switch,
 * not a business-logic selection, narrowing that file's genuinely-untestable
 * surface down to the bare `<ReactFlow>` mount itself, matching this story's
 * own testing-boundary claim for real this time.
 */
export type NodeDisplay =
  | { mode: "percentage"; label: "Retained" | "Share"; value: string }
  | { mode: "actual"; value: string }
  | { mode: "money_flow"; totalIn: string; totalOut: string };

function computeDisplay(
  viewMode: ViewMode,
  percentLabel: "Retained" | "Share",
  percentValue: string,
  actualAmount: string,
  totalIn: string,
  totalOut: string,
): NodeDisplay {
  if (viewMode === "percentage") {
    return { mode: "percentage", label: percentLabel, value: percentValue };
  }
  if (viewMode === "actual") {
    return { mode: "actual", value: actualAmount };
  }
  return { mode: "money_flow", totalIn, totalOut };
}

export type StructureNodeData =
  | { kind: "project"; label: string }
  | {
      kind: "partner";
      partnerId: string;
      name: string;
      display: NodeDisplay;
      onSelect: () => void;
    }
  | {
      kind: "sub_partner";
      subPartnerId: string;
      name: string;
      display: NodeDisplay;
    };

export type StructureNode = Node<StructureNodeData>;

const NODE_X_GAP = 200;
const PARTNER_Y = 150;
const SUB_PARTNER_Y = 320;
const PARTNER_GROUP_GAP = 60;

/**
 * Deterministic left-to-right layout (this story's Decision #1: no user
 * dragging/persisted layout) -- one column per Partner, wide enough to fit
 * that Partner's own current Sub-partners underneath it, side by side;
 * Partners are laid out left to right in the order the tree already lists
 * them (the route's own `Array.map` order over `currentPartnerShares`, no
 * further sort applied here). A Partner with zero Sub-partners still
 * reserves one column's width, so it renders as a plain leaf under the
 * Project root (I/O matrix row 9), never overlapping its neighbor.
 */
export function buildNodesAndEdges(
  tree: OwnershipStructureTree,
  viewMode: ViewMode,
  projectName: string,
  onSelectPartner: (partnerId: string) => void,
): { nodes: StructureNode[]; edges: Edge[] } {
  const nodes: StructureNode[] = [];
  const edges: Edge[] = [];

  const projectNodeId = "project-root";

  if (tree.soloSubPartner) {
    const sub = tree.soloSubPartner;
    nodes.push({
      id: projectNodeId,
      type: "structureNode",
      position: { x: 0, y: 0 },
      data: { kind: "project", label: projectName },
      draggable: false,
    });
    const subNodeId = `sub:${sub.subPartnerId}`;
    nodes.push({
      id: subNodeId,
      type: "structureNode",
      position: { x: 0, y: PARTNER_Y },
      data: subPartnerNodeData(sub, viewMode),
      draggable: false,
    });
    edges.push({ id: `${projectNodeId}->${subNodeId}`, source: projectNodeId, target: subNodeId });
    return { nodes, edges };
  }

  let cursorX = 0;
  const partnerCenters: number[] = [];

  for (const partner of tree.partners) {
    const childCount = Math.max(partner.subPartners.length, 1);
    const groupWidth = childCount * NODE_X_GAP;
    const groupStart = cursorX;

    partner.subPartners.forEach((sub, index) => {
      const subNodeId = `sub:${sub.subPartnerId}`;
      nodes.push({
        id: subNodeId,
        type: "structureNode",
        position: { x: groupStart + index * NODE_X_GAP, y: SUB_PARTNER_Y },
        data: subPartnerNodeData(sub, viewMode),
        draggable: false,
      });
      edges.push({
        id: `partner:${partner.partnerId}->${subNodeId}`,
        source: `partner:${partner.partnerId}`,
        target: subNodeId,
      });
    });

    const partnerCenter = groupStart + groupWidth / 2 - NODE_X_GAP / 2;
    partnerCenters.push(partnerCenter);

    nodes.push({
      id: `partner:${partner.partnerId}`,
      type: "structureNode",
      position: { x: partnerCenter, y: PARTNER_Y },
      data: partnerNodeData(partner, viewMode, onSelectPartner),
      draggable: false,
    });
    edges.push({
      id: `${projectNodeId}->partner:${partner.partnerId}`,
      source: projectNodeId,
      target: `partner:${partner.partnerId}`,
    });

    cursorX = groupStart + groupWidth + PARTNER_GROUP_GAP;
  }

  const totalWidth = partnerCenters.length > 0 ? cursorX - PARTNER_GROUP_GAP : 0;
  nodes.unshift({
    id: projectNodeId,
    type: "structureNode",
    position: { x: totalWidth / 2, y: 0 },
    data: { kind: "project", label: projectName },
    draggable: false,
  });

  return { nodes, edges };
}

function partnerNodeData(
  partner: OwnershipStructurePartnerNode,
  viewMode: ViewMode,
  onSelectPartner: (partnerId: string) => void,
): StructureNodeData {
  // Matrix row 3's literal acceptance criterion: a Partner WITH current
  // Sub-partners shows their retained % (sharePercent minus the sum of
  // those Sub-partners' own %); a Partner with none shows their own
  // sharePercent unchanged -- decided HERE (testable), not in the render layer.
  const hasSubPartners = partner.subPartners.length > 0;
  const percentLabel: "Retained" | "Share" = hasSubPartners ? "Retained" : "Share";
  const percentValue = hasSubPartners ? computeRetainedPercent(partner) : formatSharePercent(partner.sharePercent);

  return {
    kind: "partner",
    partnerId: partner.partnerId,
    name: partner.name,
    display: computeDisplay(viewMode, percentLabel, percentValue, partner.actualAmount, partner.totalIn, partner.totalOut),
    onSelect: () => onSelectPartner(partner.partnerId),
  };
}

function subPartnerNodeData(sub: OwnershipStructureSubPartnerNode, viewMode: ViewMode): StructureNodeData {
  // A Sub-partner's own node always shows their own % of the whole Project
  // (I/O matrix row 3) -- never a retained figure (Sub-partners have no
  // Sub-partners of their own to subtract).
  return {
    kind: "sub_partner",
    subPartnerId: sub.subPartnerId,
    name: sub.name,
    display: computeDisplay(viewMode, "Share", formatSharePercent(sub.sharePercent), sub.actualAmount, sub.totalIn, sub.totalOut),
  };
}

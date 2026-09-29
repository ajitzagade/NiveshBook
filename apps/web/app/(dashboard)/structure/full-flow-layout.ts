import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { formatAmount } from "@niveshbook/ui";
import type { MoneyFlowEdge, OwnershipStructurePartnerNode, OwnershipStructureTree } from "@niveshbook/core";

/**
 * Full Flow tab's pure transform (2026-09-29, founder request: the
 * all-Projects Money Flow screen gains a second tab rendering every visible
 * Project's own Partner/Sub-partner tree, with cross-Project
 * withdrawal→reinvestment links drawn as one continuous connector -- UX spec:
 * EXPERIENCE.md "Full Flow tree" + DESIGN.md `{components.flow-tree-card}`/
 * `{components.flow-edge}`, mockup `mockups/money-flow-full-tab.html`).
 * Separated from `FullFlowCanvas.tsx` (the `"use client"` component that
 * mounts `@xyflow/react`) so it stays unit-testable under jsdom, mirroring
 * `project-flow-layout.ts` / `structure/[projectId]/structure-layout.ts`'s
 * identical testing-boundary rationale.
 *
 * Layout is left-to-right (the founder's reference screenshots' direction,
 * unlike the per-Project canvas's top-down tree): per Project block --
 * Project card, then its Partners one column right, their Sub-partners one
 * further, external money-flow destinations rightmost; blocks stack
 * vertically. `FullFlowCanvas.tsx`'s node card renders Left/Right handles
 * to match.
 *
 * The no-disconnection rule (EXPERIENCE.md, Full Flow tree): an
 * `out`/`"project"` flow edge whose `counterpartyLabel` names a Project in
 * this same visible set terminates on that Project's OWN node -- one
 * continuous drawn line from source Share to destination Project, never a
 * dead-end reference card. The destination Project's node additionally
 * carries the link in words (`inFrom`, rendered as an info chip: "₹X in
 * from Project A") built from its own inbound edges, so the connection
 * never depends on tracing an arrow. A resolvable inbound `"project"` edge
 * deliberately draws NO line of its own -- the sending Project's outbound
 * edge is the same movement seen from the other side, and drawing both
 * would double-draw one movement (mirrors `page.tsx`'s documented
 * outbound-only fallback convention for exactly this reason).
 */

export interface FullFlowProjectInput {
  projectId: string;
  projectName: string;
  /** `null` when this session isn't authorized to see it -- rendered as no balance line, never a fabricated zero (mirrors `ProjectFlowNodeInput`). */
  availableBalance: string | null;
  tree: OwnershipStructureTree;
  moneyFlowEdges: MoneyFlowEdge[];
}

export type FullFlowNodeData =
  | {
      kind: "project";
      projectId: string;
      name: string;
      availableBalance: string | null;
      /** Inbound cross-Project money, stated in words on the card ("₹X in from Project A") -- see this module's own doc comment. */
      inFrom: { label: string; amount: string }[];
      onSelect: () => void;
    }
  | {
      kind: "partner";
      name: string;
      /** "Own, after sub-split" for a Partner WITH current Sub-partners (their retained %), "Share" otherwise -- decided here (testable), mirroring `structure-layout.ts`'s identical selection-lives-in-the-pure-module rationale. */
      percentLabel: "Own, after sub-split" | "Share";
      percentValue: string;
      totalIn: string;
      totalOut: string;
    }
  | { kind: "sub_partner"; name: string; percentValue: string; totalIn: string; totalOut: string }
  | { kind: "external"; label: string; counterpartyKind: MoneyFlowEdge["counterpartyKind"] };

export type FullFlowNode = Node<FullFlowNodeData, "fullFlowNode">;

const PROJECT_X = 0;
const PARTNER_X = 300;
const SUB_PARTNER_X = 600;
const EXTERNAL_X = 900;
const ROW_HEIGHT = 120;
const BLOCK_GAP = 100;

/** Byte-for-byte the trailing-zero trim `structure-layout.ts`/`shares/page.tsx` already carry -- duplicated per this codebase's established per-module local-helper convention. */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

/** `sharePercent - sum(current Sub-partner %)`, display-only `Number()` math, never clamped -- the same formula as `structure-layout.ts`'s `computeRetainedPercent`, duplicated per the same local-helper convention. */
function computeRetainedPercent(partner: OwnershipStructurePartnerNode): string {
  const subTotal = partner.subPartners.reduce((sum, sub) => sum + Number(sub.sharePercent), 0);
  const value = Number(partner.sharePercent) - subTotal;
  return (Math.round(value * 10000) / 10000).toString();
}

function moneyEdgeStyle(edge: Edge, colorVar: string): Edge {
  return {
    ...edge,
    labelStyle: { fill: colorVar, fontWeight: 700, fontSize: 13 },
    labelBgStyle: { fill: "var(--color-surface)", fillOpacity: 0.92 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
    style: { stroke: colorVar, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: colorVar },
  };
}

/** Grey, unlabeled ownership connector -- `{components.flow-edge.ownership}`. */
function ownershipEdge(sourceId: string, targetId: string): Edge {
  return {
    id: `${sourceId}->${targetId}`,
    source: sourceId,
    target: targetId,
    style: { stroke: "var(--color-ink-faint)", strokeWidth: 1, opacity: 0.6 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-ink-faint)" },
  };
}

export function buildFullFlowNodesAndEdges(
  projects: readonly FullFlowProjectInput[],
  onSelectProject: (projectId: string) => void,
): { nodes: FullFlowNode[]; edges: Edge[] } {
  const nodes: FullFlowNode[] = [];
  const edges: Edge[] = [];

  const projectIdByName = new Map(projects.map((project) => [project.projectName, project.projectId]));
  const inFromByProjectId = new Map<string, { label: string; amount: string }[]>();
  const shareNodeIds = new Set<string>();

  let blockTop = 0;

  for (const project of projects) {
    const projectNodeId = `project:${project.projectId}`;
    const { tree } = project;

    // --- the ownership tree, left to right ---------------------------------
    let row = 0;
    if (tree.soloSubPartner) {
      // A Sub-partner session's own scoped slice: just their node beside the
      // Project card (no parent-Partner data is ever surfaced -- Story 5.6
      // precedent carried through `OwnershipStructureTree` itself).
      const sub = tree.soloSubPartner;
      const subNodeId = `sub:${project.projectId}:${sub.subPartnerId}`;
      shareNodeIds.add(subNodeId);
      nodes.push({
        id: subNodeId,
        type: "fullFlowNode",
        position: { x: PARTNER_X, y: blockTop },
        data: {
          kind: "sub_partner",
          name: sub.name,
          percentValue: formatSharePercent(sub.sharePercent),
          totalIn: sub.totalIn,
          totalOut: sub.totalOut,
        },
      });
      edges.push(ownershipEdge(projectNodeId, subNodeId));
      row = 1;
    } else {
      for (const partner of tree.partners) {
        const groupRows = Math.max(partner.subPartners.length, 1);
        const partnerNodeId = `partner:${project.projectId}:${partner.partnerId}`;
        shareNodeIds.add(partnerNodeId);

        partner.subPartners.forEach((sub, index) => {
          const subNodeId = `sub:${project.projectId}:${sub.subPartnerId}`;
          shareNodeIds.add(subNodeId);
          nodes.push({
            id: subNodeId,
            type: "fullFlowNode",
            position: { x: SUB_PARTNER_X, y: blockTop + (row + index) * ROW_HEIGHT },
            data: {
              kind: "sub_partner",
              name: sub.name,
              percentValue: formatSharePercent(sub.sharePercent),
              totalIn: sub.totalIn,
              totalOut: sub.totalOut,
            },
          });
          edges.push(ownershipEdge(partnerNodeId, subNodeId));
        });

        const hasSubPartners = partner.subPartners.length > 0;
        nodes.push({
          id: partnerNodeId,
          type: "fullFlowNode",
          position: { x: PARTNER_X, y: blockTop + (row + (groupRows - 1) / 2) * ROW_HEIGHT },
          data: {
            kind: "partner",
            name: partner.name,
            percentLabel: hasSubPartners ? "Own, after sub-split" : "Share",
            percentValue: hasSubPartners ? computeRetainedPercent(partner) : formatSharePercent(partner.sharePercent),
            totalIn: partner.totalIn,
            totalOut: partner.totalOut,
          },
        });
        edges.push(ownershipEdge(projectNodeId, partnerNodeId));
        row += groupRows;
      }
    }

    const treeRows = Math.max(row, 1);

    // --- money-flow edges: cross-Project links + external destinations -----
    const externalsById = new Map<string, { label: string; counterpartyKind: MoneyFlowEdge["counterpartyKind"] }>();
    let externalRow = 0;

    for (const flowEdge of project.moneyFlowEdges) {
      const ownerId =
        flowEdge.partyType === "partner"
          ? `partner:${project.projectId}:${flowEdge.shareId}`
          : `sub:${project.projectId}:${flowEdge.shareId}`;
      if (!shareNodeIds.has(ownerId)) {
        // Defensive dangling-edge guard, mirroring `structure-layout.ts`'s
        // identical skip -- the route scopes `moneyFlowEdges` and `tree`
        // identically, so this shouldn't fire in practice.
        continue;
      }

      const destinationProjectId =
        flowEdge.counterpartyKind === "project" ? projectIdByName.get(flowEdge.counterpartyLabel) : undefined;

      if (flowEdge.direction === "in") {
        if (flowEdge.counterpartyKind === "project") {
          // Stated in words on this Project's own card; a resolvable source
          // draws no second line (the sender's outbound edge is this same
          // movement) -- see this module's doc comment.
          const chips = inFromByProjectId.get(project.projectId) ?? [];
          chips.push({ label: flowEdge.counterpartyLabel, amount: flowEdge.amount });
          inFromByProjectId.set(project.projectId, chips);
          if (destinationProjectId !== undefined) {
            continue;
          }
        }
        // Inbound from something not on this canvas (a Project the viewer
        // can't see, a person) -- a dashed external source card, money-in
        // colored per the per-Project canvas's inbound convention.
        const externalId = `external:${project.projectId}:${flowEdge.counterpartyKind}:${flowEdge.counterpartyLabel}`;
        if (!externalsById.has(externalId)) {
          externalsById.set(externalId, { label: flowEdge.counterpartyLabel, counterpartyKind: flowEdge.counterpartyKind });
        }
        edges.push(
          moneyEdgeStyle(
            {
              id: `flow:${project.projectId}:${flowEdge.id}`,
              source: externalId,
              target: ownerId,
              label: formatAmount(flowEdge.amount),
            },
            "var(--color-success)",
          ),
        );
        continue;
      }

      if (destinationProjectId !== undefined) {
        // The no-disconnection rule: terminate on the visible destination
        // Project's OWN node -- one continuous line from source Share to
        // the Project the withdrawal was reinvested into.
        edges.push(
          moneyEdgeStyle(
            {
              id: `flow:${project.projectId}:${flowEdge.id}`,
              source: ownerId,
              target: `project:${destinationProjectId}`,
              label: formatAmount(flowEdge.amount),
            },
            "var(--color-info)",
          ),
        );
        continue;
      }

      const externalId = `external:${project.projectId}:${flowEdge.counterpartyKind}:${flowEdge.counterpartyLabel}`;
      if (!externalsById.has(externalId)) {
        externalsById.set(externalId, { label: flowEdge.counterpartyLabel, counterpartyKind: flowEdge.counterpartyKind });
      }
      edges.push(
        moneyEdgeStyle(
          {
            id: `flow:${project.projectId}:${flowEdge.id}`,
            source: ownerId,
            target: externalId,
            label: formatAmount(flowEdge.amount),
          },
          // `{components.flow-edge}`: an unresolvable Project destination
          // still reads as "moved to another Project" (info/teal); a person/
          // Available Balance/Other destination reads violet.
          flowEdge.counterpartyKind === "project" ? "var(--color-info)" : "var(--color-violet)",
        ),
      );
    }

    for (const [externalId, info] of externalsById) {
      nodes.push({
        id: externalId,
        type: "fullFlowNode",
        position: { x: EXTERNAL_X, y: blockTop + externalRow * ROW_HEIGHT },
        data: { kind: "external", label: info.label, counterpartyKind: info.counterpartyKind },
      });
      externalRow += 1;
    }

    // Project card centered on its own tree rows. `inFrom` is complete by
    // now -- a Project's inbound edges live in its OWN `moneyFlowEdges`
    // entry, all visited just above.
    nodes.push({
      id: projectNodeId,
      type: "fullFlowNode",
      position: { x: PROJECT_X, y: blockTop + ((treeRows - 1) / 2) * ROW_HEIGHT },
      data: {
        kind: "project",
        projectId: project.projectId,
        name: project.projectName,
        availableBalance: project.availableBalance,
        inFrom: inFromByProjectId.get(project.projectId) ?? [],
        onSelect: () => onSelectProject(project.projectId),
      },
    });

    blockTop += Math.max(treeRows, externalRow) * ROW_HEIGHT + BLOCK_GAP;
  }

  return { nodes, edges };
}

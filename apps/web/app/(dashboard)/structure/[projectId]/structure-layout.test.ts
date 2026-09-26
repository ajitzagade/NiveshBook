import { describe, it, expect, vi } from "vitest";
import type { OwnershipStructurePartnerNode, OwnershipStructureSubPartnerNode, OwnershipStructureTree } from "@niveshbook/core";
import { buildNodesAndEdges, computeRetainedPercent, formatSharePercent } from "./structure-layout";

function makeSubPartner(overrides: Partial<OwnershipStructureSubPartnerNode> = {}): OwnershipStructureSubPartnerNode {
  return {
    type: "sub_partner",
    subPartnerId: "sub-1",
    name: "Sub 1",
    sharePercent: "12.5" as OwnershipStructureSubPartnerNode["sharePercent"],
    actualAmount: "0" as OwnershipStructureSubPartnerNode["actualAmount"],
    totalIn: "0" as OwnershipStructureSubPartnerNode["totalIn"],
    totalOut: "0" as OwnershipStructureSubPartnerNode["totalOut"],
    ...overrides,
  };
}

function makePartner(overrides: Partial<OwnershipStructurePartnerNode> = {}): OwnershipStructurePartnerNode {
  return {
    type: "partner",
    partnerId: "a",
    name: "Partner A",
    sharePercent: "60" as OwnershipStructurePartnerNode["sharePercent"],
    actualAmount: "0" as OwnershipStructurePartnerNode["actualAmount"],
    totalIn: "0" as OwnershipStructurePartnerNode["totalIn"],
    totalOut: "0" as OwnershipStructurePartnerNode["totalOut"],
    subPartners: [],
    ...overrides,
  };
}

describe("formatSharePercent", () => {
  it("trims trailing fractional zeros", () => {
    expect(formatSharePercent("33.3300")).toBe("33.33");
    expect(formatSharePercent("60.0000")).toBe("60");
    expect(formatSharePercent("60")).toBe("60");
  });
});

describe("computeRetainedPercent", () => {
  it("Partner sharePercent 60, two Sub-partners summing 25 -> retained 35 (I/O matrix row 3)", () => {
    const partner = makePartner({
      sharePercent: "60" as OwnershipStructurePartnerNode["sharePercent"],
      subPartners: [
        makeSubPartner({ subPartnerId: "s1", sharePercent: "15" as OwnershipStructureSubPartnerNode["sharePercent"] }),
        makeSubPartner({ subPartnerId: "s2", sharePercent: "10" as OwnershipStructureSubPartnerNode["sharePercent"] }),
      ],
    });

    expect(computeRetainedPercent(partner)).toBe("35");
  });

  it("a Partner with zero Sub-partners retains their own full sharePercent", () => {
    const partner = makePartner({ sharePercent: "60" as OwnershipStructurePartnerNode["sharePercent"], subPartners: [] });
    expect(computeRetainedPercent(partner)).toBe("60");
  });

  it("goes negative when over-allocated -- no clamping (property 4, mirrors shares/page.tsx's retainedMessage)", () => {
    const partner = makePartner({
      sharePercent: "50" as OwnershipStructurePartnerNode["sharePercent"],
      subPartners: [
        makeSubPartner({ subPartnerId: "s1", sharePercent: "40" as OwnershipStructureSubPartnerNode["sharePercent"] }),
        makeSubPartner({ subPartnerId: "s2", sharePercent: "30" as OwnershipStructureSubPartnerNode["sharePercent"] }),
      ],
    });

    expect(computeRetainedPercent(partner)).toBe("-20");
  });
});

describe("buildNodesAndEdges", () => {
  function makeTree(overrides: Partial<OwnershipStructureTree> = {}): OwnershipStructureTree {
    return { scope: { type: "project" }, partners: [], soloSubPartner: null, ...overrides };
  }

  it("project scope: one node per Partner, plus one edge each from the Project root, plus Sub-partner nodes/edges", () => {
    const tree = makeTree({
      partners: [
        makePartner({
          partnerId: "a",
          subPartners: [makeSubPartner({ subPartnerId: "sub-a1" }), makeSubPartner({ subPartnerId: "sub-a2" })],
        }),
        makePartner({ partnerId: "b", subPartners: [] }),
      ],
    });

    const { nodes, edges } = buildNodesAndEdges(tree, "percentage", "My Project", vi.fn());

    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds).toContain("project-root");
    expect(nodeIds).toContain("partner:a");
    expect(nodeIds).toContain("partner:b");
    expect(nodeIds).toContain("sub:sub-a1");
    expect(nodeIds).toContain("sub:sub-a2");
    expect(nodes).toHaveLength(5);

    expect(edges).toHaveLength(4); // root->a, root->b, a->sub-a1, a->sub-a2
    expect(edges.some((e) => e.source === "project-root" && e.target === "partner:a")).toBe(true);
    expect(edges.some((e) => e.source === "partner:a" && e.target === "sub:sub-a1")).toBe(true);
  });

  it("a Partner with zero Sub-partners still reserves its own column (no overlap) -- no sub nodes/edges for it", () => {
    const tree = makeTree({
      partners: [makePartner({ partnerId: "a", subPartners: [] }), makePartner({ partnerId: "b", subPartners: [] })],
    });

    const { nodes } = buildNodesAndEdges(tree, "percentage", "My Project", vi.fn());

    const a = nodes.find((n) => n.id === "partner:a")!;
    const b = nodes.find((n) => n.id === "partner:b")!;
    expect(a.position.x).not.toBe(b.position.x);
  });

  it("a Project with zero Partners still renders just the root node, no crash (I/O matrix row 10)", () => {
    const { nodes, edges } = buildNodesAndEdges(makeTree({ partners: [] }), "percentage", "My Project", vi.fn());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("project-root");
    expect(edges).toEqual([]);
  });

  it("sub_partner scope: renders exactly Project root -> the one solo Sub-partner node", () => {
    const tree: OwnershipStructureTree = {
      scope: { type: "sub_partner", subPartnerId: "sub-1" },
      partners: [],
      soloSubPartner: makeSubPartner({ subPartnerId: "sub-1" }),
    };

    const { nodes, edges } = buildNodesAndEdges(tree, "percentage", "My Project", vi.fn());

    expect(nodes.map((n) => n.id)).toEqual(["project-root", "sub:sub-1"]);
    expect(edges).toEqual([{ id: "project-root->sub:sub-1", source: "project-root", target: "sub:sub-1" }]);
  });

  it("clicking a Partner node's data.onSelect calls the supplied callback with its partnerId", () => {
    const onSelectPartner = vi.fn();
    const tree = makeTree({ partners: [makePartner({ partnerId: "a" })] });

    const { nodes } = buildNodesAndEdges(tree, "percentage", "My Project", onSelectPartner);

    const partnerNode = nodes.find((n) => n.id === "partner:a")!;
    expect(partnerNode.data.kind).toBe("partner");
    if (partnerNode.data.kind === "partner") {
      partnerNode.data.onSelect();
    }
    expect(onSelectPartner).toHaveBeenCalledWith("a");
  });

  it("resolves the requested viewMode into every node's own display.mode", () => {
    const tree = makeTree({ partners: [makePartner({ partnerId: "a", subPartners: [makeSubPartner()] })] });
    const { nodes } = buildNodesAndEdges(tree, "money_flow", "My Project", vi.fn());
    for (const node of nodes) {
      if (node.data.kind !== "project") {
        expect(node.data.display.mode).toBe("money_flow");
      }
    }
  });
});

/**
 * Review finding (High): this is the selection logic that used to live,
 * untested, inside `StructureCanvas.tsx` -- `data.hasSubPartners ?
 * data.retainedPercent : data.sharePercent` (matrix row 3's literal
 * acceptance criterion) and the 3-way `viewMode` branch picking which figure
 * renders (matrix row 2, "every node relabels per the new mode"). Both are
 * now resolved by `partnerNodeData`/`subPartnerNodeData` (via
 * `computeDisplay`) before a node's data ever reaches `StructureCanvas.tsx`,
 * so they're covered here with zero `@xyflow/react` dependency.
 */
describe("node display selection (review finding: matrix rows 2 & 3, moved out of StructureCanvas.tsx)", () => {
  function buildPartnerDisplay(partner: OwnershipStructurePartnerNode, viewMode: Parameters<typeof buildNodesAndEdges>[1]) {
    const tree: OwnershipStructureTree = { scope: { type: "project" }, partners: [partner], soloSubPartner: null };
    const { nodes } = buildNodesAndEdges(tree, viewMode, "My Project", vi.fn());
    const node = nodes.find((n) => n.id === `partner:${partner.partnerId}`)!;
    if (node.data.kind !== "partner") throw new Error("expected a partner node");
    return node.data.display;
  }

  function buildSubPartnerDisplay(sub: OwnershipStructureSubPartnerNode, viewMode: Parameters<typeof buildNodesAndEdges>[1]) {
    const partner = makePartner({ partnerId: "a", subPartners: [sub] });
    const tree: OwnershipStructureTree = { scope: { type: "project" }, partners: [partner], soloSubPartner: null };
    const { nodes } = buildNodesAndEdges(tree, viewMode, "My Project", vi.fn());
    const node = nodes.find((n) => n.id === `sub:${sub.subPartnerId}`)!;
    if (node.data.kind !== "sub_partner") throw new Error("expected a sub_partner node");
    return node.data.display;
  }

  describe("Percentage mode: a Partner WITH current Sub-partners shows Retained, not Share", () => {
    const partner = makePartner({
      partnerId: "a",
      sharePercent: "60" as OwnershipStructurePartnerNode["sharePercent"],
      subPartners: [
        makeSubPartner({ subPartnerId: "s1", sharePercent: "15" as OwnershipStructureSubPartnerNode["sharePercent"] }),
        makeSubPartner({ subPartnerId: "s2", sharePercent: "10" as OwnershipStructureSubPartnerNode["sharePercent"] }),
      ],
    });

    it("label is 'Retained', value is the retained %, never the raw sharePercent", () => {
      const display = buildPartnerDisplay(partner, "percentage");
      expect(display).toEqual({ mode: "percentage", label: "Retained", value: "35" });
    });
  });

  describe("Percentage mode: a Partner with ZERO current Sub-partners shows Share, not Retained", () => {
    const partner = makePartner({
      partnerId: "b",
      sharePercent: "40" as OwnershipStructurePartnerNode["sharePercent"],
      subPartners: [],
    });

    it("label is 'Share', value is the Partner's own sharePercent unchanged", () => {
      const display = buildPartnerDisplay(partner, "percentage");
      expect(display).toEqual({ mode: "percentage", label: "Share", value: "40" });
    });
  });

  it("Percentage mode: a Sub-partner's own node always shows Share (their own % of the whole Project), never Retained", () => {
    const sub = makeSubPartner({ subPartnerId: "s1", sharePercent: "15" as OwnershipStructureSubPartnerNode["sharePercent"] });
    const display = buildSubPartnerDisplay(sub, "percentage");
    expect(display).toEqual({ mode: "percentage", label: "Share", value: "15" });
  });

  it("Actual Amount mode: every node's display carries its own actualAmount, regardless of Sub-partner count", () => {
    const partnerWithSubs = makePartner({
      partnerId: "a",
      actualAmount: "600000" as OwnershipStructurePartnerNode["actualAmount"],
      subPartners: [makeSubPartner()],
    });
    expect(buildPartnerDisplay(partnerWithSubs, "actual")).toEqual({ mode: "actual", value: "600000" });

    const partnerNoSubs = makePartner({
      partnerId: "b",
      actualAmount: "400000" as OwnershipStructurePartnerNode["actualAmount"],
      subPartners: [],
    });
    expect(buildPartnerDisplay(partnerNoSubs, "actual")).toEqual({ mode: "actual", value: "400000" });
  });

  it("Money Flow mode: every node's display carries its own totalIn/totalOut as two distinct figures", () => {
    const partner = makePartner({
      partnerId: "a",
      totalIn: "600000" as OwnershipStructurePartnerNode["totalIn"],
      totalOut: "100000" as OwnershipStructurePartnerNode["totalOut"],
      subPartners: [],
    });
    expect(buildPartnerDisplay(partner, "money_flow")).toEqual({ mode: "money_flow", totalIn: "600000", totalOut: "100000" });
  });
});

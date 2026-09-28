import { describe, it, expect, vi } from "vitest";
import { buildProjectFlowNodesAndEdges, type ProjectFlowNodeInput } from "./project-flow-layout";

function makeProject(overrides: Partial<ProjectFlowNodeInput> = {}): ProjectFlowNodeInput {
  return { id: "p1", name: "Project One", availableBalance: "5000.00", ...overrides };
}

describe("buildProjectFlowNodesAndEdges (item 3: All-Projects Money Flow)", () => {
  it("renders one node per Project, carrying its id/name/availableBalance through untouched", () => {
    const onSelect = vi.fn();
    const { nodes } = buildProjectFlowNodesAndEdges(
      [makeProject({ id: "p1", name: "Sunrise Towers", availableBalance: "12000.00" }), makeProject({ id: "p2", name: "Lakeview", availableBalance: null })],
      [],
      onSelect,
    );

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data).toMatchObject({ id: "p1", name: "Sunrise Towers", availableBalance: "12000.00" });
    expect(nodes[1]?.data).toMatchObject({ id: "p2", name: "Lakeview", availableBalance: null });
  });

  it("each node's onSelect calls back with its own Project id, not a shared closure", () => {
    const onSelect = vi.fn();
    const { nodes } = buildProjectFlowNodesAndEdges(
      [makeProject({ id: "p1" }), makeProject({ id: "p2" })],
      [],
      onSelect,
    );

    nodes[0]?.data.onSelect();
    nodes[1]?.data.onSelect();

    expect(onSelect).toHaveBeenNthCalledWith(1, "p1");
    expect(onSelect).toHaveBeenNthCalledWith(2, "p2");
  });

  it("draws one edge per distinct (source, destination) Project pair", () => {
    const { edges } = buildProjectFlowNodesAndEdges(
      [makeProject({ id: "p1" }), makeProject({ id: "p2" })],
      [{ sourceProjectId: "p1", destinationProjectId: "p2", amount: "10000" }],
      vi.fn(),
    );

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "p1", target: "p2" });
  });

  it("aggregates several movements sharing the same Project pair into one summed edge, never overlapping duplicates", () => {
    const { edges } = buildProjectFlowNodesAndEdges(
      [makeProject({ id: "p1" }), makeProject({ id: "p2" })],
      [
        { sourceProjectId: "p1", destinationProjectId: "p2", amount: "10000" },
        { sourceProjectId: "p1", destinationProjectId: "p2", amount: "25000" },
      ],
      vi.fn(),
    );

    expect(edges).toHaveLength(1);
    // formatAmount renders as a currency string -- assert on the underlying total via the label containing both digit groups summed (35000).
    expect(edges[0]?.label).toContain("35,000");
  });

  it("keeps opposite-direction transfers between the same two Projects as two separate edges", () => {
    const { edges } = buildProjectFlowNodesAndEdges(
      [makeProject({ id: "p1" }), makeProject({ id: "p2" })],
      [
        { sourceProjectId: "p1", destinationProjectId: "p2", amount: "10000" },
        { sourceProjectId: "p2", destinationProjectId: "p1", amount: "4000" },
      ],
      vi.fn(),
    );

    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => `${edge.source}->${edge.target}`).sort()).toEqual(["p1->p2", "p2->p1"]);
  });

  it("silently drops a movement whose source or destination isn't in this (identically role-scoped) Project list, rather than drawing a dangling edge", () => {
    const { edges } = buildProjectFlowNodesAndEdges(
      [makeProject({ id: "p1" })],
      [{ sourceProjectId: "p1", destinationProjectId: "p-not-visible", amount: "10000" }],
      vi.fn(),
    );

    expect(edges).toEqual([]);
  });

  it("lays out nodes in a simple grid, in the given order, with no two nodes sharing a position", () => {
    const { nodes } = buildProjectFlowNodesAndEdges(
      [makeProject({ id: "p1" }), makeProject({ id: "p2" }), makeProject({ id: "p3" })],
      [],
      vi.fn(),
    );

    const positions = nodes.map((node) => `${node.position.x}:${node.position.y}`);
    expect(new Set(positions).size).toBe(3);
  });
});

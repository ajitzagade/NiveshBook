import { describe, it, expect, vi } from "vitest";
import { formatAmount } from "@niveshbook/ui";
import type { MoneyFlowEdge, OwnershipStructurePartnerNode, OwnershipStructureSubPartnerNode } from "@niveshbook/core";
import { buildFullFlowNodesAndEdges, type FullFlowProjectInput } from "./full-flow-layout";

function makeSub(overrides: Partial<OwnershipStructureSubPartnerNode> = {}): OwnershipStructureSubPartnerNode {
  return {
    type: "sub_partner",
    subPartnerId: "s1",
    name: "Sub One",
    sharePercent: "10.0000" as OwnershipStructureSubPartnerNode["sharePercent"],
    actualAmount: "100000.00" as OwnershipStructureSubPartnerNode["actualAmount"],
    totalIn: "100000.00" as OwnershipStructureSubPartnerNode["totalIn"],
    totalOut: "0.00" as OwnershipStructureSubPartnerNode["totalOut"],
    ...overrides,
  };
}

function makePartner(overrides: Partial<OwnershipStructurePartnerNode> = {}): OwnershipStructurePartnerNode {
  return {
    type: "partner",
    partnerId: "a",
    name: "Partner A",
    sharePercent: "50.0000" as OwnershipStructurePartnerNode["sharePercent"],
    actualAmount: "500000.00" as OwnershipStructurePartnerNode["actualAmount"],
    totalIn: "500000.00" as OwnershipStructurePartnerNode["totalIn"],
    totalOut: "250000.00" as OwnershipStructurePartnerNode["totalOut"],
    subPartners: [],
    ...overrides,
  };
}

function makeFlowEdge(overrides: Partial<MoneyFlowEdge> = {}): MoneyFlowEdge {
  return {
    id: "e1",
    partyType: "partner",
    shareId: "a",
    direction: "out",
    counterpartyKind: "project",
    counterpartyLabel: "Lakeview",
    amount: "150000.00" as MoneyFlowEdge["amount"],
    ...overrides,
  };
}

function makeProject(overrides: Partial<FullFlowProjectInput> = {}): FullFlowProjectInput {
  return {
    projectId: "p1",
    projectName: "Sunrise Towers",
    availableBalance: "100000.00",
    tree: { scope: { type: "project" }, partners: [makePartner()], soloSubPartner: null },
    moneyFlowEdges: [],
    ...overrides,
  };
}

function nodeById(nodes: ReturnType<typeof buildFullFlowNodesAndEdges>["nodes"], id: string) {
  return nodes.find((node) => node.id === id);
}

describe("buildFullFlowNodesAndEdges (Full Flow tab, 2026-09-29)", () => {
  it("renders each Project's tree left to right: Project, Partners, Sub-partners, joined by ownership edges", () => {
    const { nodes, edges } = buildFullFlowNodesAndEdges(
      [
        makeProject({
          tree: {
            scope: { type: "project" },
            partners: [makePartner({ partnerId: "a", subPartners: [makeSub({ subPartnerId: "s1" })] })],
            soloSubPartner: null,
          },
        }),
      ],
      vi.fn(),
    );

    const project = nodeById(nodes, "project:p1");
    const partner = nodeById(nodes, "partner:p1:a");
    const sub = nodeById(nodes, "sub:p1:s1");
    expect(project?.data).toMatchObject({ kind: "project", name: "Sunrise Towers", availableBalance: "100000.00" });
    expect(partner?.data).toMatchObject({ kind: "partner", name: "Partner A" });
    expect(sub?.data).toMatchObject({ kind: "sub_partner", name: "Sub One", percentValue: "10" });
    // Left-to-right columns.
    expect((project?.position.x ?? 0) < (partner?.position.x ?? 0)).toBe(true);
    expect((partner?.position.x ?? 0) < (sub?.position.x ?? 0)).toBe(true);
    expect(edges.map((edge) => edge.id)).toEqual(
      expect.arrayContaining(["project:p1->partner:p1:a", "partner:p1:a->sub:p1:s1"]),
    );
  });

  it("a Partner WITH current Sub-partners shows their retained % ('Own, after sub-split'); one without shows their own share", () => {
    const { nodes } = buildFullFlowNodesAndEdges(
      [
        makeProject({
          tree: {
            scope: { type: "project" },
            partners: [
              makePartner({
                partnerId: "a",
                sharePercent: "50.0000" as OwnershipStructurePartnerNode["sharePercent"],
                subPartners: [
                  makeSub({ subPartnerId: "s1", sharePercent: "10.0000" as OwnershipStructureSubPartnerNode["sharePercent"] }),
                  makeSub({ subPartnerId: "s2", sharePercent: "20.0000" as OwnershipStructureSubPartnerNode["sharePercent"] }),
                ],
              }),
              makePartner({ partnerId: "b", name: "Partner B", sharePercent: "30.0000" as OwnershipStructurePartnerNode["sharePercent"], subPartners: [] }),
            ],
            soloSubPartner: null,
          },
        }),
      ],
      vi.fn(),
    );

    expect(nodeById(nodes, "partner:p1:a")?.data).toMatchObject({
      percentLabel: "Own, after sub-split",
      percentValue: "20",
    });
    expect(nodeById(nodes, "partner:p1:b")?.data).toMatchObject({ percentLabel: "Share", percentValue: "30" });
  });

  it("no-disconnection rule: an out→project edge naming a visible Project terminates on that Project's OWN node (info-colored, ₹-labeled, no external card), and the destination card states the link in words", () => {
    const { nodes, edges } = buildFullFlowNodesAndEdges(
      [
        makeProject({
          projectId: "p1",
          projectName: "Sunrise Towers",
          moneyFlowEdges: [
            makeFlowEdge({ id: "e1", shareId: "a", direction: "out", counterpartyLabel: "Lakeview", amount: "150000.00" as MoneyFlowEdge["amount"] }),
          ],
        }),
        makeProject({
          projectId: "p2",
          projectName: "Lakeview",
          tree: { scope: { type: "project" }, partners: [makePartner({ partnerId: "b", name: "Partner B" })], soloSubPartner: null },
          moneyFlowEdges: [
            // The same movement seen from the receiving side -- must become
            // the card's in-words chip, never a second drawn line.
            makeFlowEdge({
              id: "e9",
              shareId: "b",
              direction: "in",
              counterpartyLabel: "Sunrise Towers",
              amount: "150000.00" as MoneyFlowEdge["amount"],
            }),
          ],
        }),
      ],
      vi.fn(),
    );

    const crossEdge = edges.find((edge) => edge.id === "flow:p1:e1");
    expect(crossEdge).toMatchObject({
      source: "partner:p1:a",
      target: "project:p2",
      label: formatAmount("150000.00"),
    });
    expect(crossEdge?.style?.stroke).toBe("var(--color-info)");
    // No external reference card for a destination that's on the canvas.
    expect(nodes.some((node) => node.data.kind === "external")).toBe(false);
    // The receiving Project's card states the link in words.
    expect(nodeById(nodes, "project:p2")?.data).toMatchObject({
      inFrom: [{ label: "Sunrise Towers", amount: "150000.00" }],
    });
    // ...and the resolvable inbound edge drew no line of its own.
    expect(edges.find((edge) => edge.id === "flow:p2:e9")).toBeUndefined();
  });

  it("an out→project edge whose destination is NOT visible falls back to a dashed external reference card, still info-colored", () => {
    const { nodes, edges } = buildFullFlowNodesAndEdges(
      [
        makeProject({
          moneyFlowEdges: [makeFlowEdge({ counterpartyLabel: "Somewhere Else", amount: "9000.00" as MoneyFlowEdge["amount"] })],
        }),
      ],
      vi.fn(),
    );

    const external = nodes.find((node) => node.data.kind === "external");
    expect(external?.data).toMatchObject({ label: "Somewhere Else", counterpartyKind: "project" });
    const edge = edges.find((edge) => edge.id === "flow:p1:e1");
    expect(edge?.target).toBe(external?.id);
    expect(edge?.style?.stroke).toBe("var(--color-info)");
  });

  it("person / Available Balance destinations render violet edges to per-destination external cards, deduped when several flows share one destination", () => {
    const { nodes, edges } = buildFullFlowNodesAndEdges(
      [
        makeProject({
          tree: {
            scope: { type: "project" },
            partners: [makePartner({ partnerId: "a", subPartners: [makeSub({ subPartnerId: "s1" })] })],
            soloSubPartner: null,
          },
          moneyFlowEdges: [
            makeFlowEdge({ id: "e1", shareId: "a", counterpartyKind: "person", counterpartyLabel: "Person X", amount: "50000.00" as MoneyFlowEdge["amount"] }),
            makeFlowEdge({
              id: "e2",
              partyType: "sub_partner",
              shareId: "s1",
              counterpartyKind: "person",
              counterpartyLabel: "Person X",
              amount: "10000.00" as MoneyFlowEdge["amount"],
            }),
            makeFlowEdge({
              id: "e3",
              shareId: "a",
              counterpartyKind: "available_balance",
              counterpartyLabel: "Available Balance",
              amount: "50000.00" as MoneyFlowEdge["amount"],
            }),
          ],
        }),
      ],
      vi.fn(),
    );

    const externals = nodes.filter((node) => node.data.kind === "external");
    expect(externals).toHaveLength(2); // Person X deduped across two flows + Available Balance
    const personEdges = edges.filter((edge) => edge.id === "flow:p1:e1" || edge.id === "flow:p1:e2");
    expect(personEdges).toHaveLength(2);
    for (const edge of personEdges) {
      expect(edge.style?.stroke).toBe("var(--color-violet)");
      expect(edge.target).toBe("external:p1:person:Person X");
    }
    expect(edges.find((edge) => edge.id === "flow:p1:e3")?.style?.stroke).toBe("var(--color-violet)");
  });

  it("a flow edge whose owning Share isn't in this same tree is silently skipped (defensive dangling-edge guard)", () => {
    const { edges } = buildFullFlowNodesAndEdges(
      [makeProject({ moneyFlowEdges: [makeFlowEdge({ shareId: "not-in-tree" })] })],
      vi.fn(),
    );

    expect(edges.some((edge) => edge.id.startsWith("flow:"))).toBe(false);
  });

  it("a Sub-partner session's solo scoped slice renders their own node beside the Project card, nothing else", () => {
    const { nodes, edges } = buildFullFlowNodesAndEdges(
      [
        makeProject({
          tree: { scope: { type: "sub_partner", subPartnerId: "s1" }, partners: [], soloSubPartner: makeSub() },
        }),
      ],
      vi.fn(),
    );

    expect(nodes.map((node) => node.id).sort()).toEqual(["project:p1", "sub:p1:s1"]);
    expect(edges.map((edge) => edge.id)).toEqual(["project:p1->sub:p1:s1"]);
  });

  it("stacks Project blocks vertically and calls back with each Project's own id", () => {
    const onSelect = vi.fn();
    const { nodes } = buildFullFlowNodesAndEdges(
      [makeProject({ projectId: "p1" }), makeProject({ projectId: "p2", projectName: "Lakeview", availableBalance: null })],
      onSelect,
    );

    const first = nodeById(nodes, "project:p1");
    const second = nodeById(nodes, "project:p2");
    expect((second?.position.y ?? 0) > (first?.position.y ?? 0)).toBe(true);
    expect(second?.data).toMatchObject({ availableBalance: null });
    if (first?.data.kind === "project") first.data.onSelect();
    if (second?.data.kind === "project") second.data.onSelect();
    expect(onSelect).toHaveBeenNthCalledWith(1, "p1");
    expect(onSelect).toHaveBeenNthCalledWith(2, "p2");
  });
});

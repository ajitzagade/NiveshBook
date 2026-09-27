import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { ProjectPreviewCard } from "./project-preview-card";
import { AvatarGroup } from "./avatar-group";

function childrenOf(element: ReactElement): ReactNode[] {
  const children = (element.props as { children: ReactNode | ReactNode[] }).children;
  return Array.isArray(children) ? children : [children];
}

describe("ProjectPreviewCard", () => {
  it("renders the project name and description", () => {
    const el = ProjectPreviewCard({
      name: "Project A",
      description: "Residential development at Pune",
      avatarInitials: "AK",
      sharePercentLabel: "50%",
      added: "57500",
      balance: "62500",
    }) as ReactElement;
    const [header] = childrenOf(el) as ReactElement[];
    const [nameDescBlock] = childrenOf(header) as ReactElement[];
    const [nameDiv, descDiv] = childrenOf(nameDescBlock) as ReactElement[];
    expect((nameDiv.props as { children: ReactNode }).children).toBe("Project A");
    expect((descDiv.props as { children: ReactNode }).children).toBe("Residential development at Pune");
  });

  it("omits the description block when null", () => {
    const el = ProjectPreviewCard({
      name: "Project C",
      description: null,
      avatarInitials: "AK",
      sharePercentLabel: "100%",
      added: "0",
      balance: "0",
    }) as ReactElement;
    const [header] = childrenOf(el) as ReactElement[];
    const [nameDescBlock] = childrenOf(header) as ReactElement[];
    const [, descDiv] = childrenOf(nameDescBlock);
    expect(descDiv).toBeNull();
  });

  it("renders no chevron link when href is omitted", () => {
    const el = ProjectPreviewCard({
      name: "Project A",
      avatarInitials: "AK",
      sharePercentLabel: "50%",
      added: "0",
      balance: "0",
    }) as ReactElement;
    const [header] = childrenOf(el) as ReactElement[];
    const [, chevron] = childrenOf(header);
    expect(chevron).toBeNull();
  });

  it("renders a chevron link to href when set", () => {
    const el = ProjectPreviewCard({
      name: "Project A",
      href: "/structure/p1?partnerId=pa1",
      avatarInitials: "AK",
      sharePercentLabel: "50%",
      added: "0",
      balance: "0",
    }) as ReactElement;
    const [header] = childrenOf(el) as ReactElement[];
    const [, chevron] = childrenOf(header) as ReactElement[];
    expect(chevron.type).toBe("a");
    expect((chevron.props as { href: string }).href).toBe("/structure/p1?partnerId=pa1");
  });

  it("passes only the actor's own initials to AvatarGroup, alongside their Share %", () => {
    const el = ProjectPreviewCard({
      name: "Project A",
      avatarInitials: "AK",
      sharePercentLabel: "50%",
      added: "0",
      balance: "0",
    }) as ReactElement;
    const [, avatarRow] = childrenOf(el) as ReactElement[];
    const [avatarGroup, shareSpan] = childrenOf(avatarRow) as ReactElement[];
    expect(avatarGroup.type).toBe(AvatarGroup);
    expect((avatarGroup.props as { items: { initials: string }[] }).items).toEqual([{ id: "Project A", initials: "AK" }]);
    expect((shareSpan.props as { children: ReactNode }).children).toBe("50%");
  });

  it("renders Added and Balance mini-stat blocks", () => {
    const el = ProjectPreviewCard({
      name: "Project A",
      avatarInitials: "AK",
      sharePercentLabel: "50%",
      added: "57500",
      balance: "62500",
    }) as ReactElement;
    const [, , statsGrid] = childrenOf(el) as ReactElement[];
    const [addedBlock, balanceBlock] = childrenOf(statsGrid) as ReactElement[];
    expect(JSON.stringify(addedBlock)).toContain("Added");
    expect(JSON.stringify(balanceBlock)).toContain("Balance");
  });
});

import { describe, it, expect } from "vitest";
import type { PartnerShare, Project, SubPartnerShare } from "@niveshbook/types";
import { assembleMyProjects } from "./my-projects";

const now = new Date().toISOString();

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-a",
    name: "Project A",
    description: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePartnerShare(overrides: Partial<PartnerShare> = {}): PartnerShare {
  return {
    id: "row-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Asha",
    sharePercent: "100" as PartnerShare["sharePercent"],
    userId: null,
    subPartnerVisibilityGrant: false,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

function makeSubPartnerShare(overrides: Partial<SubPartnerShare> = {}): SubPartnerShare {
  return {
    id: "sub-row-1",
    subPartnerId: "sub-1",
    partnerId: "partner-1",
    projectId: "project-a",
    name: "Bala",
    sharePercent: "40" as SubPartnerShare["sharePercent"],
    userId: null,
    effectiveFrom: now,
    createdAt: now,
    ...overrides,
  };
}

const PROJECT_A = makeProject({ id: "project-a", name: "Project A" });
const PROJECT_B = makeProject({ id: "project-b", name: "Project B" });
const PROJECT_C = makeProject({ id: "project-c", name: "Project C" });

describe("assembleMyProjects (spec-partner-project-list-self-access)", () => {
  it("Owner/Admin session: returns every Project -- same set the switcher shows today", () => {
    const result = assembleMyProjects(
      "owner_admin",
      "owner-1",
      [PROJECT_A, PROJECT_B, PROJECT_C],
      [makePartnerShare({ projectId: "project-a", userId: "someone-else" })],
      [],
    );

    expect(result).toEqual([
      { id: "project-a", name: "Project A" },
      { id: "project-b", name: "Project B" },
      { id: "project-c", name: "Project C" },
    ]);
  });

  it("Owner/Admin session with zero Projects: returns []", () => {
    const result = assembleMyProjects("owner_admin", "owner-1", [], [], []);
    expect(result).toEqual([]);
  });

  it("Partner with 2 current Partner Shares: returns exactly those 2 Projects", () => {
    const result = assembleMyProjects(
      "partner",
      "partner-user-a",
      [PROJECT_A, PROJECT_B, PROJECT_C],
      [
        makePartnerShare({ projectId: "project-a", userId: "partner-user-a" }),
        makePartnerShare({ projectId: "project-b", userId: "partner-user-a", partnerId: "partner-2" }),
        makePartnerShare({ projectId: "project-c", userId: "someone-else", partnerId: "partner-3" }),
      ],
      [],
    );

    expect(result.map((p) => p.id).sort()).toEqual(["project-a", "project-b"]);
  });

  it("Sub-partner with 1 current Sub-partner Share: returns exactly that 1 Project", () => {
    const result = assembleMyProjects(
      "sub_partner",
      "sub-user-a",
      [PROJECT_A, PROJECT_B],
      [],
      [
        makeSubPartnerShare({ projectId: "project-a", userId: "sub-user-a" }),
        makeSubPartnerShare({ projectId: "project-b", userId: "someone-else", subPartnerId: "sub-2" }),
      ],
    );

    expect(result).toEqual([{ id: "project-a", name: "Project A" }]);
  });

  it("Partner/Sub-partner with zero current shares: returns []", () => {
    const result = assembleMyProjects(
      "partner",
      "partner-user-a",
      [PROJECT_A, PROJECT_B],
      [makePartnerShare({ projectId: "project-a", userId: "someone-else" })],
      [makeSubPartnerShare({ projectId: "project-b", userId: "someone-else" })],
    );

    expect(result).toEqual([]);
  });

  it("a userId linked to both a Partner Share and a Sub-partner Share (different Projects) gets both Projects, no duplicates", () => {
    const result = assembleMyProjects(
      "partner",
      "multi-role-user",
      [PROJECT_A, PROJECT_B],
      [makePartnerShare({ projectId: "project-a", userId: "multi-role-user" })],
      [makeSubPartnerShare({ projectId: "project-b", userId: "multi-role-user" })],
    );

    expect(result.map((p) => p.id).sort()).toEqual(["project-a", "project-b"]);
  });

  it("the same Project matched via both a Partner Share and a Sub-partner Share is returned once, not twice", () => {
    const result = assembleMyProjects(
      "partner",
      "user-a",
      [PROJECT_A],
      [makePartnerShare({ projectId: "project-a", userId: "user-a" })],
      [makeSubPartnerShare({ projectId: "project-a", userId: "user-a" })],
    );

    expect(result).toEqual([{ id: "project-a", name: "Project A" }]);
  });

  it("userId match is case-insensitive, mirroring resolveMoneyHistoryScope's exact convention", () => {
    const result = assembleMyProjects(
      "partner",
      "Partner-User-A",
      [PROJECT_A],
      [makePartnerShare({ projectId: "project-a", userId: "partner-user-a" })],
      [],
    );

    expect(result).toEqual([{ id: "project-a", name: "Project A" }]);
  });

  it("a share with userId: null never matches (unlinked Partner/Sub-partner)", () => {
    const result = assembleMyProjects(
      "partner",
      "partner-user-a",
      [PROJECT_A],
      [makePartnerShare({ projectId: "project-a", userId: null })],
      [],
    );

    expect(result).toEqual([]);
  });
});

import type { PartnerShare, Project, SubPartnerShare, UserRole } from "@niveshbook/types";

/**
 * spec-partner-project-list-self-access: the self-scoped Project list behind
 * `GET /api/my-projects` -- lets the sidebar switcher and Money History's
 * Project filter show a Partner/Sub-partner their own Projects instead of
 * 403ing against the Owner/Admin-only `GET /api/projects` (this spec's
 * Intent). Deliberately narrow: `{ id, name }` only, mirroring `ProjectPort`'s
 * own read shape rather than `ProjectListItem`'s list-screen-specific
 * counts/allocation fields, which no caller of this endpoint needs
 * (Interface Segregation).
 */
export interface MyProjectSummary {
  id: string;
  name: string;
}

/**
 * Assembles the actor's own scoped Project list -- pure, no DB access
 * (AD-9). `owner_admin` gets every Project, byte-identical to today's
 * switcher (this spec's Approach). `partner`/`sub_partner` gets only
 * Projects where they hold a *current* Partner or Sub-partner Share --
 * `userId` matched case-insensitively, mirroring
 * `resolveMoneyHistoryScope`'s exact convention (`money-history.ts`, lines
 * ~68-85) byte-for-byte: BOTH share lists are checked regardless of the
 * actor's own role, since nothing prevents the same `userId` being linked to
 * a Partner Share on one Project and a Sub-partner Share on another.
 */
export function assembleMyProjects(
  actorRole: UserRole,
  actorUserId: string,
  allProjects: readonly Project[],
  currentPartnerShares: readonly PartnerShare[],
  currentSubPartnerShares: readonly SubPartnerShare[],
): MyProjectSummary[] {
  if (actorRole === "owner_admin") {
    return allProjects.map((project) => ({ id: project.id, name: project.name }));
  }

  const matches = (userId: string | null) =>
    userId !== null && userId.toLowerCase() === actorUserId.toLowerCase();

  const projectIds = new Set<string>();
  for (const share of currentPartnerShares) {
    if (matches(share.userId)) {
      projectIds.add(share.projectId);
    }
  }
  for (const share of currentSubPartnerShares) {
    if (matches(share.userId)) {
      projectIds.add(share.projectId);
    }
  }

  const projectsById = new Map(allProjects.map((project) => [project.id, project]));
  const result: MyProjectSummary[] = [];
  for (const projectId of projectIds) {
    const project = projectsById.get(projectId);
    if (project) {
      result.push({ id: project.id, name: project.name });
    }
  }
  return result;
}

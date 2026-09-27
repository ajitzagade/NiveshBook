import type { InvestmentRequirement, PartnerShare, Percent, SubPartnerShare } from "@niveshbook/types";
import { sumPercents } from "./decimal-math";

export interface ProjectSummaryRow {
  projectId: string;
  partnersCount: number;
  subPartnersCount: number;
  totalSharePercent: Percent;
  /** `totalSharePercent === "100"` -- the same allocation check `should-pay.ts`'s `computeShouldPay` already requires before Should Pay is even available. */
  isFullyAllocated: boolean;
  addMoneyRoundCount: number;
}

export interface ProjectSummaryRawData {
  currentPartnerShares: readonly PartnerShare[];
  currentSubPartnerShares: readonly SubPartnerShare[];
  investmentRequirements: readonly InvestmentRequirement[];
}

function groupByProjectId<T extends { projectId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.projectId);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(row.projectId, [row]);
    }
  }
  return map;
}

/**
 * The Projects list's per-project summary aggregate (founder feedback
 * 2026-09-27): Partners/Sub-partners counts, total Partner Share %, and the
 * funding-round count, one row per `projectId`. Takes three already-whole-
 * dataset reads (`listAllCurrentPartnerShares`/`listAllCurrentSubPartnerShares`/
 * `InvestmentRequirementPort.listAll()`) and groups them in memory -- never a
 * per-project fetch, so this stays O(1) queries regardless of how many
 * Projects are listed (NFR10).
 *
 * `totalSharePercent` sums only current PARTNER Shares -- a Sub-partner Share
 * is a carve-out of its parent Partner's own share, not additional
 * allocation on top of it, mirroring `computeShouldPay`'s (`should-pay.ts`)
 * identical partner-only 100%-sum check.
 */
export function assembleProjectSummaries(
  projectIds: readonly string[],
  raw: ProjectSummaryRawData,
): Record<string, ProjectSummaryRow> {
  const partnerSharesByProject = groupByProjectId(raw.currentPartnerShares);
  const subPartnerSharesByProject = groupByProjectId(raw.currentSubPartnerShares);
  const requirementsByProject = groupByProjectId(raw.investmentRequirements);

  const summaries: Record<string, ProjectSummaryRow> = {};
  for (const projectId of projectIds) {
    const partnerShares = partnerSharesByProject.get(projectId) ?? [];
    const subPartnerShares = subPartnerSharesByProject.get(projectId) ?? [];
    const requirements = requirementsByProject.get(projectId) ?? [];
    const totalSharePercent = sumPercents(partnerShares.map((share) => share.sharePercent));

    // eslint-disable-next-line security/detect-object-injection -- projectId comes from the caller's own already-fetched Project list, not user-controlled input
    summaries[projectId] = {
      projectId,
      partnersCount: partnerShares.length,
      subPartnersCount: subPartnerShares.length,
      totalSharePercent,
      isFullyAllocated: totalSharePercent === "100",
      addMoneyRoundCount: requirements.length,
    };
  }

  return summaries;
}

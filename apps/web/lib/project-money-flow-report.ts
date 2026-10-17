import type { InvestmentRequirement, Money, MoneyHistoryEntry } from "@niveshbook/types";
import type { MoneyFlowEdge, OwnershipStructureTree, PartnerCanTake, PartnerShouldPay } from "@niveshbook/core";

export type { PartnerShouldPay };

/**
 * Thin client-side fetch helper for `POST /api/reports/project-money-flow`
 * -- mirrors `apps/web/lib/ownership-structure.ts`'s identical pattern.
 * Every imported type is type-only, so this file has no runtime
 * `@niveshbook/core` import -- safe for the report page's `"use client"`
 * bundle (this codebase's documented client-bundle gotcha, AGENTS.md).
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** `PartnerCanTake` plus each leaf's effective Can Take (withdrawal-reallocation adjustments) -- mirrors `can-take/route.ts`'s identical `PartnerCanTakeWithEffective`, redefined here since that type lives in a route module, not a shared location. */
export interface PartnerCanTakeWithEffective extends PartnerCanTake {
  effectiveCanTake: string;
  subPartners: (PartnerCanTake["subPartners"][number] & { effectiveCanTake: string })[];
}

export type ProjectMoneyFlowStatus =
  | {
      available: true;
      shouldPayByRequirement: readonly { requirement: InvestmentRequirement; shouldPay: PartnerShouldPay[] }[];
      canTake: { availableToWithdraw: Money; partners: PartnerCanTakeWithEffective[] };
    }
  | { available: false; reason: string };

export interface ProjectMoneyFlowReportProject {
  projectId: string;
  projectName: string;
  entries: MoneyHistoryEntry[];
  moneyFlowEdges: MoneyFlowEdge[];
  tree: OwnershipStructureTree;
  status: ProjectMoneyFlowStatus;
}

export interface ProjectMoneyFlowReportResponse {
  projects: ProjectMoneyFlowReportProject[];
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Body wasn't JSON (or had no message) -- fall through to the generic one.
  }
  return GENERIC_ERROR_MESSAGE;
}

/**
 * Fetches the combined Project Money Flow Report data for one or more
 * Projects -- Owner/Admin only, enforced entirely by the route this calls
 * (never re-checked here). Throws on a non-2xx response (401/403/404/400);
 * callers render the message.
 */
export async function getProjectMoneyFlowReport(
  projectIds: readonly string[],
): Promise<ProjectMoneyFlowReportResponse> {
  const response = await fetch("/api/reports/project-money-flow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectIds }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as ProjectMoneyFlowReportResponse;
}

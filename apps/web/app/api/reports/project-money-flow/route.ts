import { NextResponse, type NextRequest } from "next/server";
import type {
  InvestmentRequirement,
  Money,
  MoneyHistoryEntry,
  SubPartnerShare,
  WithdrawalReallocation,
  WithdrawalReallocationAllocation,
} from "@niveshbook/types";
import {
  getSession,
  authorizeScope,
  listCurrentPartnerShares,
  listCurrentSubPartnerSharesForProject,
  computeShouldPay,
  computeCanTake,
  computeEffectiveCanTake,
  resolveAvailableToWithdraw,
  assembleOwnershipStructure,
  assembleMoneyHistory,
  deriveMoneyFlowEdges,
  moneyHistoryPersonNameKey,
  SharesNotFullyAllocatedError,
  SubPartnerSharesOverAllocatedError,
  PartnerSharesNotFullyAllocatedError,
  CanTakeSubPartnerSharesOverAllocatedError,
  type PartnerShouldPay,
  type PartnerCanTake,
  type MoneyFlowEdge,
  type OwnershipStructureTree,
} from "@niveshbook/core";
import {
  createSessionPort,
  createUserPort,
  createProjectPort,
  createPartnerSharePort,
  createSubPartnerSharePort,
  createInvestmentTransactionPort,
  createWithdrawalTransactionPort,
  createWithdrawalDestinationAllocationPort,
  createMoneyMovementPort,
  createAvailableBalanceSpendPort,
  createInvestmentRequirementPort,
  createWithdrawalReallocationPort,
} from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../projects/shared";
import { INVALID_REQUEST_MESSAGE, isValidProjectMoneyFlowReportBody } from "./shared";

/** Mirrors `can-take/route.ts`'s identical local helper -- duplicated per-route in this codebase, not shared (see that file's own doc comment). */
function groupByPartnerId(shares: readonly SubPartnerShare[]): Record<string, SubPartnerShare[]> {
  const byPartnerId: Record<string, SubPartnerShare[]> = {};
  for (const share of shares) {
    const bucket = byPartnerId[share.partnerId];
    if (bucket) {
      bucket.push(share);
    } else {
      byPartnerId[share.partnerId] = [share];
    }
  }
  return byPartnerId;
}

export interface PartnerCanTakeWithEffective extends PartnerCanTake {
  effectiveCanTake: string;
  subPartners: (PartnerCanTake["subPartners"][number] & { effectiveCanTake: string })[];
}

/** Mirrors `can-take/route.ts`'s identical local helper. */
function withEffectiveCanTake(
  partners: readonly PartnerCanTake[],
  activeReallocations: readonly WithdrawalReallocation[],
  activeAllocations: readonly WithdrawalReallocationAllocation[],
): PartnerCanTakeWithEffective[] {
  return partners.map((partner) => ({
    ...partner,
    effectiveCanTake: computeEffectiveCanTake(
      partner.canTake,
      "partner",
      partner.partnerId,
      activeReallocations,
      activeAllocations,
    ),
    subPartners: partner.subPartners.map((sub) => ({
      ...sub,
      effectiveCanTake: computeEffectiveCanTake(
        sub.canTake,
        "sub_partner",
        sub.subPartnerId,
        activeReallocations,
        activeAllocations,
      ),
    })),
  }));
}

export type ProjectMoneyFlowStatus =
  | {
      available: true;
      shouldPayByRequirement: Array<{ requirement: InvestmentRequirement; shouldPay: PartnerShouldPay[] }>;
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

/**
 * Project Money Flow Report: one or more Projects' complete picture --
 * itemized transactions, Should Pay/Can Take, cross-project links, and
 * ownership share breakdown -- combined into one response the client turns
 * into a downloadable PDF (`project-money-flow-pdf.ts`). Owner/Admin only
 * (`"reports:project_money_flow"`, `authorizeScope()`, no resourceRef needed
 * -- mirrors `can-take/route.ts`'s identical no-self-access shape, checked
 * immediately after the session check and before any data read, AD-1).
 *
 * A `POST` with a body, not `GET` with query params: the request carries an
 * array of Project ids, awkward and non-cacheable as a query string, mirrors
 * the split-payment batch routes' identical `POST`-for-a-multi-id-request
 * shape.
 *
 * If one selected Project's current Partner Shares don't total 100% (or a
 * Partner's Sub-partner Shares are over-allocated), `computeShouldPay`/
 * `computeCanTake` throw for that Project only -- caught per-project here so
 * one broken Project never fails the whole multi-project response; that
 * Project's `status` becomes `{available: false, reason}` and every other
 * selected Project still renders normally (this feature's own confirmed
 * Decisions, not a 409 for the whole request the way the single-project
 * `should-pay`/`can-take` routes return).
 *
 * Every `listAll()`-shaped port call (investment transactions, destination
 * allocations, available-balance spends) and the Project name-lookup list
 * are fetched ONCE and shared across every selected Project, mirroring
 * `ownership-structure/route.ts`'s identical `listAll()`-then-filter shape
 * extended to N projects instead of one -- never refetched per project.
 */
export async function POST(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "reports:project_money_flow", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (!isValidProjectMoneyFlowReportBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (body.projectIds.some((id) => !isValidProjectId(id))) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  const allProjects = await projectPort.listProjects();
  const projectsById = new Map(allProjects.map((project) => [project.id, project]));

  const selectedProjects = body.projectIds.map((id) => projectsById.get(id));
  if (selectedProjects.some((project) => !project)) {
    return projectNotFoundResponse();
  }

  const partnerSharePort = createPartnerSharePort();
  const subPartnerSharePort = createSubPartnerSharePort();
  const investmentTransactionPort = createInvestmentTransactionPort();
  const withdrawalTransactionPort = createWithdrawalTransactionPort();
  const withdrawalDestinationAllocationPort = createWithdrawalDestinationAllocationPort();
  const moneyMovementPort = createMoneyMovementPort();
  const availableBalanceSpendPort = createAvailableBalanceSpendPort();
  const investmentRequirementPort = createInvestmentRequirementPort();
  const reallocationPort = createWithdrawalReallocationPort();

  const [allInvestmentTransactions, allDestinationAllocations, allAvailableBalanceSpends] =
    await Promise.all([
      investmentTransactionPort.listAll(),
      withdrawalDestinationAllocationPort.listAll(),
      availableBalanceSpendPort.listAll(),
    ]);

  const projectNamesById = Object.fromEntries(allProjects.map((project) => [project.id, project.name]));

  const projects: ProjectMoneyFlowReportProject[] = await Promise.all(
    // Non-null: every entry already confirmed present above.
    (selectedProjects as NonNullable<(typeof selectedProjects)[number]>[]).map(async (project) => {
      const [
        currentPartnerShares,
        currentSubPartnerShares,
        withdrawalTransactions,
        moneyMovements,
        investmentRequirements,
        totalActiveInvested,
        totalActiveWithdrawn,
        activeReallocations,
        activeAllocations,
      ] = await Promise.all([
        listCurrentPartnerShares(project.id, { partnerShares: partnerSharePort }),
        listCurrentSubPartnerSharesForProject(project.id, { subPartnerShares: subPartnerSharePort }),
        withdrawalTransactionPort.listByProjectId(project.id),
        moneyMovementPort.listByDestinationProjectId(project.id),
        investmentRequirementPort.listByProjectId(project.id),
        investmentTransactionPort.sumActiveAmountByProjectId(project.id),
        withdrawalTransactionPort.sumActiveAmountByProjectId(project.id),
        reallocationPort.listActiveByProjectId(project.id),
        reallocationPort.listActiveAllocationsByProjectId(project.id),
      ]);

      const investmentTransactions = allInvestmentTransactions.filter(
        (tx) => tx.projectId === project.id,
      );

      const tree = assembleOwnershipStructure(
        { type: "project" },
        { currentPartnerShares, currentSubPartnerShares, investmentTransactions, withdrawalTransactions },
      );

      const partnerNamesById = Object.fromEntries(
        currentPartnerShares.map((share) => [
          moneyHistoryPersonNameKey(share.partnerId, share.projectId),
          share.name,
        ]),
      );
      const subPartnerNamesById = Object.fromEntries(
        currentSubPartnerShares.map((share) => [
          moneyHistoryPersonNameKey(share.subPartnerId, share.projectId),
          share.name,
        ]),
      );

      const entries = assembleMoneyHistory(
        {
          investmentTransactions,
          withdrawalTransactions,
          withdrawalDestinationAllocations: allDestinationAllocations,
          moneyMovements,
          availableBalanceSpends: allAvailableBalanceSpends,
          projectNamesById,
          partnerNamesById,
          subPartnerNamesById,
        },
        { unrestricted: true },
        { projectId: project.id },
      );
      const moneyFlowEdges = deriveMoneyFlowEdges(entries);

      const subPartnerSharesByPartnerId = groupByPartnerId(currentSubPartnerShares);

      let status: ProjectMoneyFlowStatus;
      try {
        const shouldPayByRequirement = investmentRequirements.map((requirement) => ({
          requirement,
          shouldPay: computeShouldPay(requirement, currentPartnerShares, subPartnerSharesByPartnerId),
        }));
        const availableToWithdraw = resolveAvailableToWithdraw(totalActiveInvested, totalActiveWithdrawn);
        const partners = computeCanTake(availableToWithdraw, currentPartnerShares, subPartnerSharesByPartnerId);
        const partnersWithEffective = withEffectiveCanTake(partners, activeReallocations, activeAllocations);
        status = {
          available: true,
          shouldPayByRequirement,
          canTake: { availableToWithdraw, partners: partnersWithEffective },
        };
      } catch (error) {
        if (
          error instanceof SharesNotFullyAllocatedError ||
          error instanceof SubPartnerSharesOverAllocatedError ||
          error instanceof PartnerSharesNotFullyAllocatedError ||
          error instanceof CanTakeSubPartnerSharesOverAllocatedError
        ) {
          status = { available: false, reason: error.message };
        } else {
          throw error;
        }
      }

      return { projectId: project.id, projectName: project.name, entries, moneyFlowEdges, tree, status };
    }),
  );

  return NextResponse.json({ projects });
}

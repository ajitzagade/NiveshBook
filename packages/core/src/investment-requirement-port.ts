import type { InvestmentRequirement, Money } from "@niveshbook/types";

export interface CreateInvestmentRequirementInput {
  projectId: string;
  amount: Money;
  /** Plain date, `YYYY-MM-DD` -- already validated by the domain layer before this port is called. */
  requirementDate: string;
}

/**
 * Port for reading/writing Investment Requirement rows (Story 3.1).
 * Implemented by `packages/db` against Postgres; `packages/core` never
 * imports a DB driver directly (AD-9). Mirrors `packages/core/src/project-port.ts`'s
 * shape. Unlike `PartnerSharePort`, there is no `findLatest*`/versioning
 * method -- a funding requirement is a discrete event, never edited, so
 * every row this port returns is already the "current" one.
 */
export interface InvestmentRequirementPort {
  /** Inserts a new Investment Requirement row. */
  createInvestmentRequirement(input: CreateInvestmentRequirementInput): Promise<InvestmentRequirement>;
  /** Every Investment Requirement row for a Project, most-recent `requirementDate` first (ties broken by `createdAt`) -- already ordered by the implementation, callers don't need to re-sort. */
  listByProjectId(projectId: string): Promise<InvestmentRequirement[]>;
  /** A single Investment Requirement row by its own `id`, or `null` if none exists (Story 3.2, `should-pay` route) -- callers additionally check `.projectId` themselves for the cross-project-mismatch 404 case. */
  findById(id: string): Promise<InvestmentRequirement | null>;
}

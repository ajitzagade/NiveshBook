import type { InvestmentRequirement, Money } from "@niveshbook/types";
import { toMoney, isZeroMoney, InvalidMoneyError } from "./decimal-math";
import type { InvestmentRequirementPort } from "./investment-requirement-port";

export interface InvestmentRequirementDeps {
  investmentRequirements: InvestmentRequirementPort;
}

export interface InvestmentRequirementInput {
  amount: string;
  requirementDate: string;
}

/**
 * Thrown when `amount` fails `decimal-math.ts`'s `toMoney` validation (not a
 * plain non-negative decimal string, or more than 2 decimal places), or
 * passes `toMoney` but is exactly zero. `Money` itself only enforces
 * "non-negative, <=2 decimal places" (this story's Decisions) -- the
 * stricter `> 0` a funding requirement needs is this domain function's own
 * check, wrapped under one error type mirroring `partner-share.ts`'s
 * `InvalidSharePercentError` pattern.
 */
export class InvalidRequirementAmountError extends Error {
  constructor() {
    super("Requirement amount must be greater than 0, with up to 2 decimal places.");
    this.name = "InvalidRequirementAmountError";
  }
}

/** Thrown when `requirementDate` isn't a well-formed `YYYY-MM-DD` calendar date. */
export class InvalidRequirementDateError extends Error {
  constructor() {
    super("Requirement date must be a valid date in YYYY-MM-DD format.");
    this.name = "InvalidRequirementDateError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeAmount(raw: string): Money {
  let amount: Money;
  try {
    amount = toMoney(raw);
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      throw new InvalidRequirementAmountError();
    }
    throw error;
  }
  if (isZeroMoney(amount)) {
    throw new InvalidRequirementAmountError();
  }
  return amount;
}

/**
 * Validates `raw` is a well-formed `YYYY-MM-DD` string representing a real
 * calendar date -- rejects both malformed strings (`"not-a-date"`) and
 * well-shaped-but-invalid dates (`"2026-02-30"`) by round-tripping through
 * `Date` and comparing the ISO date portion back against the input. Never
 * uses `Number()`/`parseInt` (AD-2's ban applies to this file too, not just
 * money) -- `Date` parsing and `Number.isNaN` (a static method call, not a
 * coercion of the value itself) are the only date primitives used.
 */
function normalizeRequirementDate(raw: string): string {
  const trimmed = raw.trim();
  if (!DATE_PATTERN.test(trimmed)) {
    throw new InvalidRequirementDateError();
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new InvalidRequirementDateError();
  }
  return trimmed;
}

/**
 * Creates a new funding requirement for a Project: validates `amount`
 * (`> 0`, via `toMoney`/`isZeroMoney`) and `requirementDate` (well-formed
 * `YYYY-MM-DD`), then calls the port. Unlike `addPartnerShare`, there is no
 * generated stable id threaded through -- a requirement is never versioned,
 * so the port's own row `id` is the only id this resource ever has. Callers
 * must run `authorizeScope()` for `"investment_requirements:create"` before
 * calling this -- it performs no permission check of its own (AD-1's gate
 * lives at the route layer).
 */
export async function createInvestmentRequirement(
  projectId: string,
  input: InvestmentRequirementInput,
  deps: InvestmentRequirementDeps,
): Promise<InvestmentRequirement> {
  const amount = normalizeAmount(input.amount);
  const requirementDate = normalizeRequirementDate(input.requirementDate);

  return deps.investmentRequirements.createInvestmentRequirement({
    projectId,
    amount,
    requirementDate,
  });
}

/**
 * Lists every funding requirement for a Project -- a thin pass-through to
 * the port, unlike Epic 2's share-history reads (no version-reduction
 * logic needed here, since `investment_requirements` is never versioned).
 * Callers must run `authorizeScope()` for `"investment_requirements:list"`
 * before calling this.
 */
export async function listInvestmentRequirements(
  projectId: string,
  deps: InvestmentRequirementDeps,
): Promise<InvestmentRequirement[]> {
  return deps.investmentRequirements.listByProjectId(projectId);
}

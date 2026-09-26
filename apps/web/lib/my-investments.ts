import type { Money, Percent } from "@niveshbook/types";

/**
 * Thin client-side fetch helper for `GET /api/my-investments` (founder
 * feedback 2026-09-26: the All Investments view) -- mirrors
 * `apps/web/lib/money-history.ts`'s pattern (not Project-scoped, no
 * params: the session's own identity/role is the only input). `import
 * type` only from `@niveshbook/types` (never a runtime import from
 * `@niveshbook/core`) -- this file is imported by a "use client" page, and
 * `@niveshbook/core` has no subpath exports; the response shapes below
 * mirror `packages/core/src/my-investments.ts`'s own exported types,
 * re-declared locally per `lib/adjust-next-time.ts`'s identical convention.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** Mirrors `MyInvestmentRequirementStatus` (`packages/core/src/my-investments.ts`). */
export interface MyInvestmentRequirementStatus {
  /** The person's OWN Should Pay for this requirement (a Partner's own-retained amount, never the pooled Partner+Sub-partners total). */
  shouldPay: Money;
  actualPaid: Money;
  adjustmentType: "pending" | "extra_paid" | "none";
  adjustmentAmount: Money;
  /** Present only when a Story 3.5 Recommended Amount snapshot exists AND differs from `shouldPay`. */
  recommendedAmount?: Money;
}

/** Mirrors `MyInvestmentRequirementEntry` -- `status: null` when the Project's shares aren't fully allocated yet (the per-Project screens' 409 case). */
export interface MyInvestmentRequirementEntry {
  requirementId: string;
  requirementDate: string;
  requirementAmount: Money;
  status: MyInvestmentRequirementStatus | null;
}

/** Mirrors `MyInvestmentEntry` -- one entry per (Project, current Share) the actor holds; owner_admin gets every project/party. */
export interface MyInvestmentEntry {
  projectId: string;
  projectName: string;
  role: "partner" | "sub_partner";
  shareId: string;
  name: string;
  sharePercent: Percent;
  requirements: MyInvestmentRequirementEntry[];
}

export interface MyInvestmentsResponse {
  entries: MyInvestmentEntry[];
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

/** The actor's own cross-project investments list, scoped server-side. */
export async function getMyInvestments(): Promise<MyInvestmentsResponse> {
  const response = await fetch("/api/my-investments");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as MyInvestmentsResponse;
}

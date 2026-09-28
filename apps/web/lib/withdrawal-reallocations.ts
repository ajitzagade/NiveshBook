import type { WithdrawalReallocation, WithdrawalReallocationAllocation } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Withdraw Money screen's flexible
 * pro-rata withdrawal reallocation ("Skip this round") feature -- mirrors
 * `apps/web/lib/withdrawal-transactions.ts`'s pattern one ledger over.
 * `GET` is scoped, not Owner/Admin-only (`withdrawal_reallocations:view` is
 * granted to all 3 roles) -- an Owner/Admin gets every row unfiltered
 * (`isOwnerAdminView: true`), a Partner/Sub-partner gets only reallocations
 * they declined or are a recipient of, and only their own allocation legs
 * (`isOwnerAdminView: false`). The page uses `isOwnerAdminView`, not "did the
 * GET succeed", to decide whether to show the Owner/Admin-only Skip/Undo/
 * Cancel UI and the oversight panel -- both roles' `GET` calls succeed now.
 * `POST`/cancel remain genuinely Owner/Admin-only server-side
 * (`withdrawal_reallocations:create`/`:cancel`).
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * Thrown by `listWithdrawalReallocations` on a 403 -- defense in depth only
 * now that `GET` is granted to all 3 roles (only an unrecognized role, e.g.
 * `project_admin`, or a since-deleted user, would ever actually hit this).
 * The page still handles it by hiding the feature area entirely, same as
 * any other unexpected failure of this fetch.
 */
export class WithdrawalReallocationsForbiddenError extends Error {
  constructor() {
    super("You don't have permission to view withdrawal reallocations.");
    this.name = "WithdrawalReallocationsForbiddenError";
  }
}

export interface WithdrawalReallocationsResponse {
  reallocations: WithdrawalReallocation[];
  allocations: WithdrawalReallocationAllocation[];
  /** `true` for an Owner/Admin's unfiltered, oversight view; `false` for a Partner's/Sub-partner's own row-scoped view. Drives which UI this page shows -- see this file's own doc comment. */
  isOwnerAdminView: boolean;
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

/** Every currently-active reallocation (and its allocation legs) relevant to the caller -- unfiltered for an Owner/Admin, row-scoped to their own stake for a Partner/Sub-partner. */
export async function listWithdrawalReallocations(
  projectId: string,
): Promise<WithdrawalReallocationsResponse> {
  const response = await fetch(`/api/projects/${projectId}/withdrawal-reallocations`);
  if (response.status === 403) {
    throw new WithdrawalReallocationsForbiddenError();
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as WithdrawalReallocationsResponse;
}

export interface PreviewWithdrawalReallocationAllocationLeg {
  partyType: "partner" | "sub_partner";
  shareId: string;
  allocatedAmount: string;
}

export interface PreviewWithdrawalReallocationResponse {
  effectiveCanTake: string;
  allocationLegs: PreviewWithdrawalReallocationAllocationLeg[];
}

/**
 * Read-only preview of the pro-rata split for the Skip dialog, before the
 * Owner/Admin confirms -- `GET .../withdrawal-reallocations/preview`, a
 * plain, safe, idempotent read (never writes anything), so this page can
 * show every other current Partner's/Sub-partner's recipient amount without
 * importing `packages/core`'s split-calculation into the client bundle
 * (this codebase's own established constraint) and without persisting a
 * throwaway reallocation just to see what it would produce.
 */
export async function previewWithdrawalReallocation(
  projectId: string,
  partyType: "partner" | "sub_partner",
  shareId: string,
  declinedAmount: string,
): Promise<PreviewWithdrawalReallocationResponse> {
  const query = new URLSearchParams({ partyType, shareId, declinedAmount }).toString();
  const response = await fetch(`/api/projects/${projectId}/withdrawal-reallocations/preview?${query}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as PreviewWithdrawalReallocationResponse;
}

export interface CreateWithdrawalReallocationInput {
  partyType: "partner" | "sub_partner";
  shareId: string;
  /** The amount this Partner/Sub-partner is declining, off their own currently-available Can Take. */
  declinedAmount: string;
  notes: string | null;
}

export interface CreateWithdrawalReallocationResult {
  reallocation: WithdrawalReallocation;
  allocations: WithdrawalReallocationAllocation[];
}

/**
 * Records a decline, automatically split pro-rata across every other
 * current Partner/Sub-partner (Owner/Admin-only). `idempotencyKey` mirrors
 * `recordWithdrawalTransaction`'s exact lifecycle contract: one fresh key
 * per *logical* submission attempt (minted when the Skip dialog opens),
 * reused across a retry of that same attempt.
 */
export async function createWithdrawalReallocation(
  projectId: string,
  input: CreateWithdrawalReallocationInput,
  idempotencyKey: string,
): Promise<CreateWithdrawalReallocationResult> {
  const response = await fetch(`/api/projects/${projectId}/withdrawal-reallocations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, idempotencyKey }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as CreateWithdrawalReallocationResult;
}

/** Cancels (reverses) a previously recorded decline -- only while every allocation leg is still fully unconsumed (Owner/Admin-only). */
export async function cancelWithdrawalReallocation(
  projectId: string,
  reallocationId: string,
): Promise<WithdrawalReallocation> {
  const response = await fetch(
    `/api/projects/${projectId}/withdrawal-reallocations/${reallocationId}/cancel`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const body = (await response.json()) as { reallocation: WithdrawalReallocation };
  return body.reallocation;
}

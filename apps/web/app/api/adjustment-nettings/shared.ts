import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared by `POST /api/adjustment-nettings` (Story 5.3, FR33/FR34, AD-4) --
 * the request-body shape guard, mirroring
 * `available-balance/spend/shared.ts`'s `isValidAvailableBalanceSpendBody`
 * pattern one story over, narrowed to this simpler, single-row write (no
 * `destinationType`-conditional fields -- every field is always required).
 */

const PARTY_TYPES: ReadonlySet<string> = new Set(["partner", "sub_partner"]);

export const INVALID_REQUEST_MESSAGE =
  'Request body must be valid JSON with a non-empty `projectId`, `partyType` ("partner" | "sub_partner"), a non-empty `shareId`, a non-empty `investmentRequirementId`, an `amount` string, and a non-empty `idempotencyKey`. `notes` is optional.';

export interface ValidAdjustmentNettingBody {
  projectId: string;
  partyType: "partner" | "sub_partner";
  shareId: string;
  investmentRequirementId: string;
  amount: string;
  notes: string | null;
  idempotencyKey: string;
}

export function isValidAdjustmentNettingBody(body: unknown): body is ValidAdjustmentNettingBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as {
    projectId?: unknown;
    partyType?: unknown;
    shareId?: unknown;
    investmentRequirementId?: unknown;
    amount?: unknown;
    notes?: unknown;
    idempotencyKey?: unknown;
  };

  if (typeof candidate.projectId !== "string" || candidate.projectId.trim().length === 0) {
    return false;
  }
  if (typeof candidate.partyType !== "string" || !PARTY_TYPES.has(candidate.partyType)) {
    return false;
  }
  if (typeof candidate.shareId !== "string" || candidate.shareId.trim().length === 0) {
    return false;
  }
  if (
    typeof candidate.investmentRequirementId !== "string" ||
    candidate.investmentRequirementId.trim().length === 0
  ) {
    return false;
  }
  if (typeof candidate.amount !== "string") {
    return false;
  }
  if (candidate.notes !== undefined && candidate.notes !== null && typeof candidate.notes !== "string") {
    return false;
  }
  if (typeof candidate.idempotencyKey !== "string" || candidate.idempotencyKey.trim().length === 0) {
    return false;
  }

  return true;
}

export const PROJECT_NOT_FOUND_MESSAGE = "`projectId` must be an existing Project.";

export const ADJUSTMENTS_NOT_FOUND_MESSAGE =
  "No Investment Adjustment row exists for that (partyType, shareId, investmentRequirementId) at this Project, or no Withdrawal Adjustment row exists for that (partyType, shareId) at this Project -- both must already exist before they can be netted.";

/** `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for this resource. */
export function isValidId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

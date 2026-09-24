import type { Money, UserRole } from "@niveshbook/types";
import { compareMoney } from "./decimal-math";

/**
 * Thrown by `assertExtraWithdrawalAuthorized` when the requested amount
 * exceeds the target's live Can Take and the acting user either isn't
 * `owner_admin`, or is `owner_admin` but doesn't currently hold the
 * `canApproveExtraWithdrawal` grant (e.g. a revoked approval authority,
 * Story 1.7). Deliberately uninformative (FR8) -- mirrors every other
 * role-based 403 in this codebase, no hint that a *different* authorization
 * step exists or would have helped. The route layer maps this to 403
 * `forbidden`, reusing the same generic `FORBIDDEN_MESSAGE` every other 403
 * in this codebase uses, not this error's own `.message` (this story's
 * Decisions: "two failure modes, two status codes").
 */
export class OwnerAdminRequiredForExtraWithdrawalError extends Error {
  constructor() {
    super("You don't have permission to perform this action.");
    this.name = "OwnerAdminRequiredForExtraWithdrawalError";
  }
}

/**
 * Thrown by `assertExtraWithdrawalAuthorized` when the requested amount
 * exceeds the target's live Can Take, the acting Owner/Admin *does* hold the
 * `canApproveExtraWithdrawal` grant, but `extraWithdrawalAuthorized` wasn't
 * sent `true` on this specific request -- the actor *can* authorize this,
 * they just haven't taken the distinct authorization action yet (FR25: "not
 * just a bigger number"). The route layer maps this to 400
 * `extra_withdrawal_authorization_required`, a specific, actionable message
 * deliberately distinct from the uninformative 403 above.
 */
export class ExtraWithdrawalAuthorizationRequiredError extends Error {
  constructor() {
    super(
      "This withdrawal exceeds Can Take -- confirm the Authorize Extra Withdrawal step to record it.",
    );
    this.name = "ExtraWithdrawalAuthorizationRequiredError";
  }
}

export interface AssertExtraWithdrawalAuthorizedInput {
  /** The Take Now amount being recorded, already normalized via `toMoney`. */
  requestedAmount: Money;
  /** The target Partner/Sub-partner's *live* Can Take, recomputed by the caller via `computeCanTake` -- never a stale/cached value. */
  canTake: Money;
  /** The *acting* user's current role -- never the target share's own role/party. */
  actorRole: UserRole;
  /** The acting user's current `canApproveExtraWithdrawal` grant (Story 1.7) -- only meaningful when `actorRole === "owner_admin"`, but always passed through as-is. */
  actorCanApproveExtraWithdrawal: boolean;
  /** Whether this specific request carried the distinct Authorize Extra Withdrawal confirmation (FR25) -- `false`/absent unless the caller explicitly set it `true`. */
  extraWithdrawalAuthorized: boolean;
}

/**
 * Story 4.5's server-side Extra Withdrawal gate (FR25) -- defense in depth,
 * not UI-trust; called independently of whatever the client sent or hid. A
 * new, additive check (Open/Closed) -- never folded into Story 4.2's
 * already-shipped `recordWithdrawalTransaction`, whose signature/contract
 * this story leaves untouched (this story's Boundaries).
 *
 * No-op (returns normally, throws nothing) whenever `requestedAmount`
 * doesn't exceed `canTake` -- decided via `compareMoney(requestedAmount,
 * canTake) <= 0` (AD-2, never a raw `>`/`parseFloat`/`Number()` comparison).
 * An *exact* match is "within Can Take", not "exceeds" (this story's I/O
 * matrix) -- `<= 0`, not `< 0`. `extraWithdrawalAuthorized` is never even
 * inspected for a normal (within-entitlement) withdrawal, matching this
 * story's Boundaries: "no behavior change for the common case."
 *
 * Once `requestedAmount` *does* exceed `canTake`, two distinct failure modes
 * in a fixed order (this story's Decisions):
 * 1. `actorRole !== "owner_admin"` or `!actorCanApproveExtraWithdrawal` --
 *    an actor who could never authorize this regardless of what they sent
 *    throws `OwnerAdminRequiredForExtraWithdrawalError`, checked *before*
 *    `extraWithdrawalAuthorized` so a non-eligible actor always gets the
 *    uninformative 403, never the actionable 400 -- covers both "not
 *    Owner/Admin" (AC4: a non-Owner/Admin self-authorizing) and "Owner/Admin
 *    with a revoked grant" in one branch.
 * 2. Otherwise (an eligible Owner/Admin), but `extraWithdrawalAuthorized`
 *    isn't `true` on *this* request -- throws
 *    `ExtraWithdrawalAuthorizationRequiredError`.
 *
 * Callers run this *after* the existing self-access `authorize()` call for
 * `"withdrawal_transactions:create"` and *before* `recordWithdrawalTransaction`
 * (this story's Boundaries) -- self-access alone never covers an amount
 * exceeding Can Take, regardless of who normally has self-access to that
 * share (this story's Decisions): the self-access check above admits the
 * request, then this gate independently re-confirms Owner/Admin authority
 * for the excess.
 */
export function assertExtraWithdrawalAuthorized(input: AssertExtraWithdrawalAuthorizedInput): void {
  if (compareMoney(input.requestedAmount, input.canTake) <= 0) {
    return;
  }

  if (input.actorRole !== "owner_admin" || !input.actorCanApproveExtraWithdrawal) {
    throw new OwnerAdminRequiredForExtraWithdrawalError();
  }

  if (!input.extraWithdrawalAuthorized) {
    throw new ExtraWithdrawalAuthorizationRequiredError();
  }
}

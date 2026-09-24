import { uuidv7 } from "uuidv7";
import type { SubPartnerShare, Percent } from "@niveshbook/types";
import { toPercent, sumPercents, InvalidPercentError } from "./decimal-math";
import type { SubPartnerSharePort } from "./subpartner-share-port";

export interface SubPartnerShareDeps {
  subPartnerShares: SubPartnerSharePort;
}

export interface SubPartnerShareInput {
  name: string;
  sharePercent: string;
  /**
   * The `users.id` this Sub-partner is linked to, or `null` -- already
   * resolved and role-validated by the route layer (Story 2.4's Decisions),
   * mirroring `PartnerShareInput.userId`. Always explicitly provided,
   * full-overwrite, no "carry forward" branch.
   */
  userId: string | null;
}

/**
 * Thrown when `name` is empty/whitespace-only, mirroring
 * `partner-share.ts`'s `InvalidPartnerNameError` pattern one level down.
 * Callers (the `POST`/`PATCH
 * /api/projects/[id]/partner-shares/[partnerId]/subpartner-shares/**` route
 * handlers) catch this and surface it as a 400 `validation_error` naming
 * the field -- no partial state is ever saved.
 */
export class InvalidSubPartnerNameError extends Error {
  constructor() {
    super("Sub-partner name is required.");
    this.name = "InvalidSubPartnerNameError";
  }
}

/**
 * Thrown when `sharePercent` fails `decimal-math.ts`'s `toPercent`
 * validation (not `0 < x <= 100`, more than 4 decimal places, or not a
 * plain decimal string at all). Wraps `decimal-math.ts`'s own
 * `InvalidPercentError` under this domain-specific name, mirroring
 * `partner-share.ts`'s `InvalidSharePercentError` pattern. A Sub-partner's
 * `sharePercent` is always validated as a percentage of the *full
 * Project* -- identically to a Partner's -- never as a fraction of the
 * parent Partner's own share (spec-2-3's Decisions).
 */
export class InvalidSubPartnerSharePercentError extends Error {
  constructor() {
    super("Share % must be greater than 0 and at most 100, with up to 4 decimal places.");
    this.name = "InvalidSubPartnerSharePercentError";
  }
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new InvalidSubPartnerNameError();
  }
  return trimmed;
}

function normalizeSharePercent(raw: string): Percent {
  try {
    return toPercent(raw);
  } catch (error) {
    if (error instanceof InvalidPercentError) {
      throw new InvalidSubPartnerSharePercentError();
    }
    throw error;
  }
}

/**
 * Adds a new Sub-partner under a Partner: validates `name`/`sharePercent`,
 * generates a fresh, stable `subPartnerId` (there is no separate
 * `subpartners` table -- a Sub-partner exists only as a row/row-history in
 * `subpartner_shares`), and creates its first version row. Callers must run
 * `authorizeScope()` for `"subpartner_shares:create"` before calling this --
 * it performs no permission check of its own (AD-1's gate lives at the
 * route layer), and it never validates that `partnerId` actually exists --
 * callers (the route handler) must do that first.
 *
 * `sharePercent` is never blocked from exceeding, or summing past, the
 * parent Partner's own `sharePercent` -- an allocation total under or over
 * the parent's share is informational only, never a hard block (spec-2-3's
 * Decisions; mirrors `addPartnerShare`'s own no-100%-block pattern).
 */
export async function addSubPartnerShare(
  partnerId: string,
  projectId: string,
  input: SubPartnerShareInput,
  deps: SubPartnerShareDeps,
): Promise<SubPartnerShare> {
  const name = normalizeName(input.name);
  const sharePercent = normalizeSharePercent(input.sharePercent);
  const subPartnerId = uuidv7();

  return deps.subPartnerShares.createSubPartnerShare({
    subPartnerId,
    partnerId,
    projectId,
    name,
    sharePercent,
    userId: input.userId,
  });
}

/**
 * Edits an existing Sub-partner's name/share. Per AD-3 (and spec-2-3's
 * Decisions, mirroring spec-2-2's), every edit **always** creates a new
 * versioned row -- a new `id` and `effectiveFrom`, the same stable
 * `subPartnerId` -- never a conditional "only if transactions exist" check
 * and never an in-place overwrite; the old row is left untouched.
 *
 * Resolves to `null` if `subPartnerId` doesn't match any existing row, so
 * callers can surface a 404 -- matches `updatePartnerShare`'s not-found
 * convention. Callers must run `authorizeScope()` for
 * `"subpartner_shares:update"` before calling this, and must independently
 * verify the existing row's `partnerId`/`projectId` match the URL's path
 * segments before calling this (the cross-scope ownership check belongs at
 * the route layer, mirroring Story 2.2's cross-project PATCH fix).
 */
export async function updateSubPartnerShare(
  subPartnerId: string,
  input: SubPartnerShareInput,
  deps: SubPartnerShareDeps,
): Promise<SubPartnerShare | null> {
  const name = normalizeName(input.name);
  const sharePercent = normalizeSharePercent(input.sharePercent);

  const existing = await deps.subPartnerShares.findLatestBySubPartnerId(subPartnerId);
  if (!existing) {
    return null;
  }

  return deps.subPartnerShares.createSubPartnerShare({
    subPartnerId,
    partnerId: existing.partnerId,
    projectId: existing.projectId,
    name,
    sharePercent,
    userId: input.userId,
  });
}

/** `true` if `candidate` is a strictly later version than `current` (by `effectiveFrom`, falling back to `id` -- both uuidv7, time-ordered -- for exact ties). */
function isNewerVersion(candidate: SubPartnerShare, current: SubPartnerShare): boolean {
  const candidateTime = new Date(candidate.effectiveFrom).getTime();
  const currentTime = new Date(current.effectiveFrom).getTime();
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  return candidate.id > current.id;
}

/** Reduces every version row down to the latest `effectiveFrom` per `subPartnerId`. Shared by `listCurrentSubPartnerShares` (Partner-scoped) and `listCurrentSubPartnerSharesForProject` (Story 3.2, Project-scoped) -- the reduction shape is identical, only the source of `allVersions` differs. Mirrors `partner-share.ts`'s `reduceToLatestPerPartnerId` one level down. */
function reduceToLatestPerSubPartnerId(allVersions: readonly SubPartnerShare[]): SubPartnerShare[] {
  const latestBySubPartnerId = new Map<string, SubPartnerShare>();
  for (const version of allVersions) {
    const current = latestBySubPartnerId.get(version.subPartnerId);
    if (!current || isNewerVersion(version, current)) {
      latestBySubPartnerId.set(version.subPartnerId, version);
    }
  }

  return [...latestBySubPartnerId.values()];
}

/**
 * Reduces every version row for a Partner's Sub-partners down to the latest
 * `effectiveFrom` per `subPartnerId` -- the *current* Sub-partner Shares.
 * Order of the returned array is not guaranteed to match
 * `deps.subPartnerShares.listByPartnerId`'s order. Mirrors
 * `listCurrentPartnerShares` one level down.
 */
export async function listCurrentSubPartnerShares(
  partnerId: string,
  deps: SubPartnerShareDeps,
): Promise<SubPartnerShare[]> {
  const allVersions = await deps.subPartnerShares.listByPartnerId(partnerId);
  return reduceToLatestPerSubPartnerId(allVersions);
}

/**
 * Reduces every version row *for a whole Project's Sub-partners, across
 * every Partner* down to the latest `effectiveFrom` per `subPartnerId` --
 * the *current* Sub-partner Shares, Project-wide (Story 3.2, `should-pay`
 * route). Sourced from `deps.subPartnerShares.listByProjectId(projectId)`
 * instead of `listByPartnerId(partnerId)` -- avoids an N+1 fan-out (one
 * `listCurrentSubPartnerShares` call per current Partner) that a
 * single server-side calculation endpoint shouldn't need. Callers group the
 * result by `partnerId` themselves (`computeShouldPay`'s expected shape) --
 * this function only reduces to current, mirroring `listCurrentSubPartnerShares`'s
 * per-Partner scope.
 */
export async function listCurrentSubPartnerSharesForProject(
  projectId: string,
  deps: SubPartnerShareDeps,
): Promise<SubPartnerShare[]> {
  const allVersions = await deps.subPartnerShares.listByProjectId(projectId);
  return reduceToLatestPerSubPartnerId(allVersions);
}

/**
 * The running total across a set of Sub-partner Shares (typically the
 * output of `listCurrentSubPartnerShares`) -- delegates entirely to
 * `decimal-math.ts`'s `sumPercents` (AD-2's fixed-point addition), never raw
 * `+` on the percent strings. Not range-checked against the parent
 * Partner's own `sharePercent` -- a Sub-partner allocation total can
 * legitimately sit under or over that mid-process (spec-2-3's Decisions);
 * over/under messaging against the parent's share is an `apps/web`-side
 * concern, mirroring `computeShareTotal`'s own not-range-checked note.
 */
export function computeSubAllocationTotal(subShares: readonly SubPartnerShare[]): Percent {
  return sumPercents(subShares.map((share) => share.sharePercent));
}

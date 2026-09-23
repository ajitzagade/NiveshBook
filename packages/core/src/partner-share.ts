import { uuidv7 } from "uuidv7";
import type { PartnerShare, Percent } from "@niveshbook/types";
import { toPercent, sumPercents, InvalidPercentError } from "./decimal-math";
import type { PartnerSharePort } from "./partner-share-port";

export interface PartnerShareDeps {
  partnerShares: PartnerSharePort;
}

export interface PartnerShareInput {
  name: string;
  sharePercent: string;
}

/**
 * Thrown when `name` is empty/whitespace-only, mirroring `project.ts`'s
 * `InvalidProjectNameError` pattern. Callers (the
 * `POST`/`PATCH /api/projects/[id]/partner-shares/**` route handlers) catch
 * this and surface it as a 400 `validation_error` naming the field -- no
 * partial state is ever saved.
 */
export class InvalidPartnerNameError extends Error {
  constructor() {
    super("Partner name is required.");
    this.name = "InvalidPartnerNameError";
  }
}

/**
 * Thrown when `sharePercent` fails `decimal-math.ts`'s `toPercent`
 * validation (not `0 < x <= 100`, more than 4 decimal places, or not a
 * plain decimal string at all). Wraps `decimal-math.ts`'s own
 * `InvalidPercentError` under this domain-specific name so route handlers
 * only need to know about `partner-share.ts`'s two error types, mirroring
 * `project.ts`'s `InvalidProjectNameError` pattern.
 */
export class InvalidSharePercentError extends Error {
  constructor() {
    super("Share % must be greater than 0 and at most 100, with up to 4 decimal places.");
    this.name = "InvalidSharePercentError";
  }
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new InvalidPartnerNameError();
  }
  return trimmed;
}

function normalizeSharePercent(raw: string): Percent {
  try {
    return toPercent(raw);
  } catch (error) {
    if (error instanceof InvalidPercentError) {
      throw new InvalidSharePercentError();
    }
    throw error;
  }
}

/**
 * Adds a new Partner to a Project: validates `name`/`sharePercent`,
 * generates a fresh, stable `partnerId` (there is no separate `partners`
 * table -- a Partner exists only as a row/row-history in `partner_shares`),
 * and creates its first version row. Callers must run `authorizeScope()`
 * for `"partner_shares:create"` before calling this -- it performs no
 * permission check of its own (AD-1's gate lives at the route layer).
 */
export async function addPartnerShare(
  projectId: string,
  input: PartnerShareInput,
  deps: PartnerShareDeps,
): Promise<PartnerShare> {
  const name = normalizeName(input.name);
  const sharePercent = normalizeSharePercent(input.sharePercent);
  const partnerId = uuidv7();

  return deps.partnerShares.createPartnerShare({ partnerId, projectId, name, sharePercent });
}

/**
 * Edits an existing Partner's name/share. Per AD-3 (and spec-2-2's
 * Decisions), every edit **always** creates a new versioned row -- a new
 * `id` and `effectiveFrom`, the same stable `partnerId` -- never a
 * conditional "only if transactions exist" check and never an in-place
 * overwrite; the old row is left untouched.
 *
 * Resolves to `null` if `partnerId` doesn't match any existing row, so
 * callers can surface a 404 -- matches `updateProject`'s not-found
 * convention. Callers must run `authorizeScope()` for
 * `"partner_shares:update"` before calling this.
 */
export async function updatePartnerShare(
  partnerId: string,
  input: PartnerShareInput,
  deps: PartnerShareDeps,
): Promise<PartnerShare | null> {
  const name = normalizeName(input.name);
  const sharePercent = normalizeSharePercent(input.sharePercent);

  const existing = await deps.partnerShares.findLatestByPartnerId(partnerId);
  if (!existing) {
    return null;
  }

  return deps.partnerShares.createPartnerShare({
    partnerId,
    projectId: existing.projectId,
    name,
    sharePercent,
  });
}

/** `true` if `candidate` is a strictly later version than `current` (by `effectiveFrom`, falling back to `id` -- both uuidv7, time-ordered -- for exact ties). */
function isNewerVersion(candidate: PartnerShare, current: PartnerShare): boolean {
  const candidateTime = new Date(candidate.effectiveFrom).getTime();
  const currentTime = new Date(current.effectiveFrom).getTime();
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  return candidate.id > current.id;
}

/**
 * Reduces every version row for a Project down to the latest `effectiveFrom`
 * per `partnerId` -- the *current* Partner Shares. Order of the returned
 * array is not guaranteed to match `deps.partnerShares.listByProjectId`'s
 * order.
 */
export async function listCurrentPartnerShares(
  projectId: string,
  deps: PartnerShareDeps,
): Promise<PartnerShare[]> {
  const allVersions = await deps.partnerShares.listByProjectId(projectId);

  const latestByPartnerId = new Map<string, PartnerShare>();
  for (const version of allVersions) {
    const current = latestByPartnerId.get(version.partnerId);
    if (!current || isNewerVersion(version, current)) {
      latestByPartnerId.set(version.partnerId, version);
    }
  }

  return [...latestByPartnerId.values()];
}

/**
 * The running total across a set of Partner Shares (typically the output
 * of `listCurrentPartnerShares`) -- delegates entirely to `decimal-math.ts`'s
 * `sumPercents` (AD-2's fixed-point addition), never raw `+` on the percent
 * strings. Not range-checked against 100% -- see `sumPercents`'s own note;
 * over/under-100% display messaging is an `apps/web`-side concern (spec-2-2's
 * Decisions).
 */
export function computeShareTotal(shares: readonly PartnerShare[]): Percent {
  return sumPercents(shares.map((share) => share.sharePercent));
}

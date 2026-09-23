import { NextResponse } from "next/server";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared between `POST .../subpartner-shares` and
 * `PATCH .../subpartner-shares/[subPartnerId]` -- both accept the same
 * `{ name, sharePercent, linkedUserEmail }` request-body shape, mirroring
 * `apps/web/app/api/projects/[id]/partner-shares/shared.ts`'s pattern one
 * level down (Story 2.3, extended by Story 2.4's `linkedUserEmail`).
 * `linkedUserEmail` is required -- an empty string means "no link", never
 * "leave unchanged" (AD-3's full-overwrite-per-save convention).
 */
export const INVALID_REQUEST_MESSAGE =
  "Request body must be valid JSON with a `name` string, a `sharePercent` string, and a `linkedUserEmail` string (empty for no link).";

export interface ValidSubPartnerShareBody {
  name: string;
  sharePercent: string;
  linkedUserEmail: string;
}

export function isValidSubPartnerShareBody(body: unknown): body is ValidSubPartnerShareBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { name?: unknown; sharePercent?: unknown; linkedUserEmail?: unknown };
  return (
    typeof candidate.name === "string" &&
    typeof candidate.sharePercent === "string" &&
    typeof candidate.linkedUserEmail === "string"
  );
}

export const SUBPARTNER_SHARE_NOT_FOUND_MESSAGE = "Sub-partner Share not found.";

/**
 * The uniform 404 body/status `PATCH
 * .../subpartner-shares/[subPartnerId]` returns for an unknown or malformed
 * `subPartnerId`, a malformed `id`/`partnerId`, or a `subPartnerId` that
 * belongs to a different `partnerId` than the URL's -- every "doesn't
 * belong" case is the same class of bug as Story 2.2's cross-project PATCH
 * fix, one level deeper, so none of them are distinguishable from the
 * response.
 */
export function subPartnerShareNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: SUBPARTNER_SHARE_NOT_FOUND_MESSAGE },
    { status: 404 },
  );
}

/** `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for this resource's `subPartnerId`. */
export function isValidSubPartnerId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

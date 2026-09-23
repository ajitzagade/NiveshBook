import { NextResponse } from "next/server";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared between `POST /api/projects/[id]/partner-shares` and
 * `PATCH /api/projects/[id]/partner-shares/[partnerId]` -- both accept the
 * same `{ name, sharePercent }` request-body shape, mirroring
 * `apps/web/app/api/projects/shared.ts`'s pattern for Story 2.1.
 */
export const INVALID_REQUEST_MESSAGE =
  "Request body must be valid JSON with a `name` string and a `sharePercent` string.";

export interface ValidPartnerShareBody {
  name: string;
  sharePercent: string;
}

export function isValidPartnerShareBody(body: unknown): body is ValidPartnerShareBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { name?: unknown; sharePercent?: unknown };
  return typeof candidate.name === "string" && typeof candidate.sharePercent === "string";
}

export const PARTNER_SHARE_NOT_FOUND_MESSAGE = "Partner Share not found.";

/** The uniform 404 body/status `PATCH /api/projects/[id]/partner-shares/[partnerId]` returns for an unknown or malformed `partnerId`. */
export function partnerShareNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: PARTNER_SHARE_NOT_FOUND_MESSAGE },
    { status: 404 },
  );
}

/** `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for this resource's `partnerId`. */
export function isValidPartnerId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

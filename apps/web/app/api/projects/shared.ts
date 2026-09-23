import { NextResponse } from "next/server";
import { UUID_PATTERN } from "@/lib/ids";

/**
 * Shared between `POST /api/projects` and `PATCH /api/projects/[id]` — both
 * accept the same `{ name, description? }` request-body shape, so the
 * validation lives in one place instead of being duplicated verbatim across
 * the two route files.
 */
export const INVALID_REQUEST_MESSAGE = "Request body must be valid JSON with a `name` string.";

export interface ValidProjectBody {
  name: string;
  description?: string | null;
}

export function isValidProjectBody(body: unknown): body is ValidProjectBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { name?: unknown; description?: unknown };
  if (typeof candidate.name !== "string") {
    return false;
  }
  if (
    candidate.description !== undefined &&
    candidate.description !== null &&
    typeof candidate.description !== "string"
  ) {
    return false;
  }
  return true;
}

export const PROJECT_NOT_FOUND_MESSAGE = "Project not found.";

/** The uniform 404 body/status `GET`/`PATCH /api/projects/[id]` both return for an unknown or malformed id. */
export function projectNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: PROJECT_NOT_FOUND_MESSAGE },
    { status: 404 },
  );
}

/**
 * `apps/web/lib/ids.ts`'s malformed-id-looks-like-404 convention, named for
 * this resource so both `GET` and `PATCH /api/projects/[id]` can share one
 * check instead of re-testing `UUID_PATTERN` inline.
 */
export function isValidProjectId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

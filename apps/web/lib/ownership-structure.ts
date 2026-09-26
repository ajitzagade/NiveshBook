import type { OwnershipStructureTree } from "@niveshbook/core";

/**
 * Thin client-side fetch helper for `GET /api/projects/[id]/ownership-structure`
 * (Story 5.10) -- mirrors `apps/web/lib/reports.ts`'s identical pattern.
 * `OwnershipStructureTree` type-only imported from `@niveshbook/core` -- this
 * file has no runtime `@niveshbook/core` import, so it's safe for
 * `structure/[projectId]/page.tsx`'s `"use client"` bundle (this codebase's
 * documented client-bundle gotcha, AGENTS.md).
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface OwnershipStructureScopeInput {
  partnerId?: string;
  subPartnerId?: string;
}

export interface OwnershipStructureResponse {
  projectId: string;
  projectName: string;
  tree: OwnershipStructureTree;
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

/**
 * Fetches one Project's Ownership & Money-Flow Structure tree, scoped
 * server-side (Decision #3's privacy boundary is enforced entirely by the
 * route this calls, never re-checked here). Omitting both `partnerId`/
 * `subPartnerId` requests the full, unscoped Project tree. Throws on a
 * non-2xx response (401/403/404/etc) -- callers render the message; this is
 * the definitive "was this request authorized" outcome (this story's task
 * item #6) -- no real tree data is ever returned to a caller for
 * `structure/[projectId]/page.tsx` to render unless this call itself
 * succeeds.
 */
export async function getOwnershipStructure(
  projectId: string,
  scope: OwnershipStructureScopeInput = {},
): Promise<OwnershipStructureResponse> {
  const params = new URLSearchParams();
  if (scope.partnerId) {
    params.set("partnerId", scope.partnerId);
  }
  if (scope.subPartnerId) {
    params.set("subPartnerId", scope.subPartnerId);
  }
  const query = params.toString();
  const response = await fetch(`/api/projects/${projectId}/ownership-structure${query ? `?${query}` : ""}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as OwnershipStructureResponse;
}

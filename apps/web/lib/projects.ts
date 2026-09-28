import type { Project, ProjectListItem } from "@niveshbook/types";

/**
 * Thin client-side fetch helpers for the Projects screens (Story 2.1) —
 * `"use client"` components call these instead of hand-rolling `fetch()`
 * inline, so the request shape/error handling for `/api/projects` lives in
 * one place. Mirrors the `readErrorMessage` pattern already used inline in
 * `app/SessionList.tsx`.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface ProjectInput {
  name: string;
  description?: string | null;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Body wasn't JSON (or had no message) — fall through to the generic one.
  }
  return GENERIC_ERROR_MESSAGE;
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const response = await fetch("/api/projects");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as ProjectListItem[];
}

/**
 * spec-partner-project-list-self-access: `GET /api/my-projects`'s own
 * response shape -- redeclared locally rather than imported from
 * `@niveshbook/core` (this spec's Boundaries: no `import`, not even `import
 * type`, from `@niveshbook/core` inside an `apps/web/lib/*.ts` "use
 * client"-consumed helper), mirroring `apps/web/lib/my-investments.ts`'s
 * established convention. Mirrors `MyProjectSummary`
 * (`packages/core/src/my-projects.ts`) field-for-field.
 */
export interface MyProjectSummary {
  id: string;
  name: string;
}

/**
 * The actor's own scoped Project list -- owner_admin gets every Project
 * (byte-identical to `listProjects()`'s own set); a Partner/Sub-partner gets
 * only Projects where they hold a current Partner or Sub-partner Share.
 * Backs the sidebar switcher and Money History's Project filter, both of
 * which previously 403'd for a Partner/Sub-partner session by calling the
 * Owner/Admin-only `listProjects()` above.
 */
export async function listMyProjects(): Promise<MyProjectSummary[]> {
  const response = await fetch("/api/my-projects");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const body = (await response.json()) as { projects: MyProjectSummary[] };
  return body.projects;
}

/** Fetches one Project (for the edit form's pre-fill). Throws on 404/403/etc — callers render the message. */
export async function getProject(id: string): Promise<Project> {
  const response = await fetch(`/api/projects/${id}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as Project;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as Project;
}

export async function updateProject(id: string, input: ProjectInput): Promise<Project> {
  const response = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as Project;
}

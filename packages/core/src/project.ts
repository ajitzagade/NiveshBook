import type { Project } from "@niveshbook/types";
import type { ProjectPort } from "./project-port";

export interface ProjectDeps {
  projects: ProjectPort;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
}

/**
 * Thrown when `name` is empty/whitespace-only ("Given an empty name field,
 * when save is attempted, then it's blocked with a clear validation
 * message" — this story's AC). Callers (the `POST`/`PATCH /api/projects`
 * route handlers) catch this and surface it as a 400 `validation_error`
 * naming the field — no partial state is ever saved.
 */
export class InvalidProjectNameError extends Error {
  constructor() {
    super("Project name is required.");
    this.name = "InvalidProjectNameError";
  }
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new InvalidProjectNameError();
  }
  return trimmed;
}

/** A blank/whitespace-only description is stored as `null`, not `""`. */
function normalizeDescription(description: string | null | undefined): string | null {
  if (description === null || description === undefined) {
    return null;
  }
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Creates a Project with just a name and description — no partner
 * information is required to save (this story's core rule; Partner Shares
 * arrive in Story 2.2+). Callers must run `authorizeScope()` for
 * `"projects:create"` before calling this — it performs no permission check
 * of its own (AD-1's gate lives at the route layer).
 */
export async function createProject(input: ProjectInput, deps: ProjectDeps): Promise<Project> {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  return deps.projects.createProject({ name, description });
}

/**
 * Edits an existing Project's name/description. `name` is always replaced.
 * `description` is only replaced when `input.description` is not
 * `undefined` — i.e. when the caller's request body explicitly included the
 * key (even as `null`, to intentionally clear it). Omitting the key leaves
 * the existing description untouched rather than silently clearing it,
 * since `ProjectPort#updateProject` always writes the full column (there's
 * no partial-update primitive at the port layer), so the current value is
 * looked up and re-written unchanged in that case.
 *
 * Resolves to `null` if `id` doesn't match any row, so callers can surface a
 * 404 — matches `setUserActiveStatus`'s not-found convention. Callers must
 * run `authorizeScope()` for `"projects:update"` before calling this.
 */
export async function updateProject(
  id: string,
  input: ProjectInput,
  deps: ProjectDeps,
): Promise<Project | null> {
  const name = normalizeName(input.name);

  let description: string | null;
  if (input.description === undefined) {
    const existing = await deps.projects.findProjectById(id);
    if (!existing) {
      return null;
    }
    description = existing.description;
  } else {
    description = normalizeDescription(input.description);
  }

  return deps.projects.updateProject(id, { name, description });
}

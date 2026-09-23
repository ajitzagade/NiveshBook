import type { Project } from "@niveshbook/types";

export interface CreateProjectInput {
  name: string;
  description: string | null;
}

export interface UpdateProjectInput {
  name: string;
  description: string | null;
}

/**
 * Port for reading/writing Project records (Story 2.1). Implemented by
 * `packages/db` against Postgres; `packages/core` never imports a DB driver
 * directly (AD-9). Mirrors `packages/core/src/user-port.ts`'s shape.
 */
export interface ProjectPort {
  createProject(input: CreateProjectInput): Promise<Project>;
  /**
   * Returns the updated project, or `null` if `id` doesn't match any row —
   * callers surface that as a 404 rather than throwing.
   */
  updateProject(id: string, input: UpdateProjectInput): Promise<Project | null>;
  findProjectById(id: string): Promise<Project | null>;
  /** Every project — not yet scoped to a Partner (Story 2.4+). */
  listProjects(): Promise<Project[]>;
}

import type { Project } from "@niveshbook/types";

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

export async function listProjects(): Promise<Project[]> {
  const response = await fetch("/api/projects");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as Project[];
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

import { describe, it, expect } from "vitest";
import type { Project } from "@niveshbook/types";
import { createProject, updateProject, InvalidProjectNameError, type ProjectDeps } from "./project";
import type { ProjectPort, CreateProjectInput, UpdateProjectInput } from "./project-port";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Project A",
    description: "Residential development at Pune",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A ProjectPort backed by a mutable in-memory map. */
function createFakeProjectPort(seed: Project[] = []): ProjectPort {
  const store = new Map(seed.map((p) => [p.id, p]));
  let nextId = seed.length + 1;
  return {
    async createProject(input: CreateProjectInput) {
      const project: Project = {
        id: `project-${nextId++}`,
        name: input.name,
        description: input.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(project.id, project);
      return project;
    },
    async updateProject(id: string, input: UpdateProjectInput) {
      const existing = store.get(id);
      if (!existing) return null;
      const updated: Project = {
        ...existing,
        name: input.name,
        description: input.description,
        updatedAt: new Date().toISOString(),
      };
      store.set(id, updated);
      return updated;
    },
    async findProjectById(id: string) {
      return store.get(id) ?? null;
    },
    async listProjects() {
      return [...store.values()];
    },
  };
}

describe("createProject", () => {
  it("saves a project with just a name and description — no partner information required", async () => {
    const projects = createFakeProjectPort();
    const deps: ProjectDeps = { projects };

    const result = await createProject(
      { name: "Project A", description: "Residential development at Pune" },
      deps,
    );

    expect(result.name).toBe("Project A");
    expect(result.description).toBe("Residential development at Pune");
  });

  it("trims a name with surrounding whitespace", async () => {
    const projects = createFakeProjectPort();
    const deps: ProjectDeps = { projects };

    const result = await createProject({ name: "  Project A  " }, deps);

    expect(result.name).toBe("Project A");
  });

  it("stores a missing/undefined description as null", async () => {
    const projects = createFakeProjectPort();
    const deps: ProjectDeps = { projects };

    const result = await createProject({ name: "Project A" }, deps);

    expect(result.description).toBeNull();
  });

  it("stores a whitespace-only description as null, not an empty string", async () => {
    const projects = createFakeProjectPort();
    const deps: ProjectDeps = { projects };

    const result = await createProject({ name: "Project A", description: "   " }, deps);

    expect(result.description).toBeNull();
  });

  it.each(["", "   "])("rejects an empty/whitespace-only name (%j) — blocked before save", async (name) => {
    const projects = createFakeProjectPort();
    const deps: ProjectDeps = { projects };

    await expect(createProject({ name }, deps)).rejects.toThrow(InvalidProjectNameError);
    expect(await projects.listProjects()).toHaveLength(0);
  });
});

describe("updateProject", () => {
  it("saves a name/description change and reflects it immediately", async () => {
    const existing = makeProject({ id: "project-1", name: "Old Name", description: "Old" });
    const projects = createFakeProjectPort([existing]);
    const deps: ProjectDeps = { projects };

    const result = await updateProject(
      "project-1",
      { name: "New Name", description: "New description" },
      deps,
    );

    expect(result).not.toBeNull();
    expect(result?.name).toBe("New Name");
    expect(result?.description).toBe("New description");
  });

  it("resolves to null for a nonexistent id, so the caller can surface a 404", async () => {
    const projects = createFakeProjectPort();
    const deps: ProjectDeps = { projects };

    const result = await updateProject("unknown-id", { name: "Whatever" }, deps);

    expect(result).toBeNull();
  });

  it("rejects an empty name — no partial state is saved", async () => {
    const existing = makeProject({ id: "project-1", name: "Old Name" });
    const projects = createFakeProjectPort([existing]);
    const deps: ProjectDeps = { projects };

    await expect(updateProject("project-1", { name: "" }, deps)).rejects.toThrow(
      InvalidProjectNameError,
    );
    const unchanged = await projects.findProjectById("project-1");
    expect(unchanged?.name).toBe("Old Name");
  });

  it("leaves the existing description untouched when the input omits it entirely", async () => {
    const existing = makeProject({ id: "project-1", name: "Old Name", description: "Keep me" });
    const projects = createFakeProjectPort([existing]);
    const deps: ProjectDeps = { projects };

    const result = await updateProject("project-1", { name: "New Name" }, deps);

    expect(result?.name).toBe("New Name");
    expect(result?.description).toBe("Keep me");
  });

  it("clears the description when the input explicitly passes null", async () => {
    const existing = makeProject({ id: "project-1", description: "Clear me" });
    const projects = createFakeProjectPort([existing]);
    const deps: ProjectDeps = { projects };

    const result = await updateProject("project-1", { name: "Old Name", description: null }, deps);

    expect(result?.description).toBeNull();
  });
});

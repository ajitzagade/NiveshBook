// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project } from "@niveshbook/types";
import { ProjectQuickAddForm } from "./ProjectQuickAddForm";

const createProject = vi.fn();
vi.mock("@/lib/projects", () => ({
  createProject: (...args: unknown[]) => createProject(...args),
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-new",
    name: "New Project",
    description: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  createProject.mockReset();
});

afterEach(() => {
  cleanup();
});

/**
 * spec-quick-add-project-user-modals: `ProjectQuickAddForm` was extracted
 * from `projects/new/page.tsx` (Story 2.1's original inline form) so both
 * `/projects/new` and every Combobox's inline "+ Add New Project" row share
 * one implementation. This suite covers the extracted form's own contract in
 * isolation -- `ProjectSwitcher.test.tsx`/`money-history/page.test.tsx` cover
 * it composed inside a Combobox on both surfaces.
 */
describe("ProjectQuickAddForm", () => {
  it("blocks a blank name client-side -- never calls createProject, shows the inline error, form stays open", async () => {
    const onCreated = vi.fn();
    const { container } = render(<ProjectQuickAddForm onCancel={vi.fn()} onCreated={onCreated} />);

    // jsdom DOES enforce the Input's own `required` attribute -- clicking
    // Save with the field empty would be blocked by native constraint
    // validation before our `onSubmit` handler ever runs, so a plain
    // `userEvent.click` can't reach this component's own explicit blank/
    // whitespace check (below) at all. `fireEvent.submit` dispatches the
    // submit event directly, bypassing that native gate, mirroring this
    // exact "bypassed" row of this spec's I/O matrix ("if bypassed,
    // InvalidProjectNameError shown inline").
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(await screen.findByRole("alert")).toHaveTextContent("Project name is required.");
    expect(createProject).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("submits name + description, shows a success toast via onCreated, and never navigates itself", async () => {
    createProject.mockResolvedValue(makeProject({ name: "Riverside Tower" }));
    const onCreated = vi.fn();
    render(<ProjectQuickAddForm onCancel={vi.fn()} onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("Name"), "Riverside Tower");
    await userEvent.type(screen.getByLabelText("Description"), "A new site");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({ name: "Riverside Tower", description: "A new site" }),
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ name: "Riverside Tower" }));
  });

  it("a duplicate name (no uniqueness check exists, packages/core/src/project.ts) passes through exactly like any other name", async () => {
    createProject.mockResolvedValue(makeProject({ name: "Existing Name" }));
    const onCreated = vi.fn();
    render(<ProjectQuickAddForm onCancel={vi.fn()} onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("Name"), "Existing Name");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("surfaces a server-side InvalidProjectNameError inline without closing the form (whitespace-only name bypassing client validation)", async () => {
    createProject.mockRejectedValue(new Error("Project name is required."));
    const onCreated = vi.fn();
    render(<ProjectQuickAddForm onCancel={vi.fn()} onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("Name"), "   ");
    // The explicit client-side check treats whitespace-only the same as
    // blank -- createProject is still never reached, mirroring the "blocked
    // client-side" row of this spec's I/O matrix.
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Project name is required.");
    expect(createProject).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked, without ever calling createProject", async () => {
    const onCancel = vi.fn();
    render(<ProjectQuickAddForm onCancel={onCancel} onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createProject).not.toHaveBeenCalled();
  });

  /**
   * Review-triage fix (spec-quick-add-project-user-modals, blind-hunter):
   * this form now mounts independently inside every Combobox's popover
   * (sidebar switcher, Money History filter, `/projects/new`) -- a fixed
   * literal id would collide if two ever rendered their inline form at
   * once. `useId()` scopes each instance's Name/Description ids uniquely.
   */
  it("two simultaneously-rendered instances never share DOM ids", () => {
    const { container: containerA } = render(<ProjectQuickAddForm onCancel={vi.fn()} onCreated={vi.fn()} />);
    const { container: containerB } = render(<ProjectQuickAddForm onCancel={vi.fn()} onCreated={vi.fn()} />);

    const nameIdA = containerA.querySelector('input[name="name"]')?.id;
    const nameIdB = containerB.querySelector('input[name="name"]')?.id;
    expect(nameIdA).toBeTruthy();
    expect(nameIdB).toBeTruthy();
    expect(nameIdA).not.toBe(nameIdB);
  });

  /**
   * Review-triage fix (spec-quick-add-project-user-modals, edge-case-hunter):
   * if the user dismisses the popover (unmounting this form) after Save but
   * before `createProject()` resolves, the late resolution must not still
   * call `onCreated` -- that would silently re-select/navigate to the new
   * Project in the still-mounted parent Combobox after the user had already
   * backed out.
   */
  it("a createProject() that resolves after unmount never calls onCreated", async () => {
    let resolveCreate!: (project: Project) => void;
    createProject.mockReturnValue(
      new Promise<Project>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const onCreated = vi.fn();
    const { unmount } = render(<ProjectQuickAddForm onCancel={vi.fn()} onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("Name"), "Riverside Tower");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));

    unmount();
    resolveCreate(makeProject({ name: "Riverside Tower" }));
    // Flush the now-resolved promise's microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(onCreated).not.toHaveBeenCalled();
  });
});

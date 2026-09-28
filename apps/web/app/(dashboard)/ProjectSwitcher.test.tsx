// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project } from "@niveshbook/types";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SidebarShell } from "./SidebarShell";
import type { SidebarNavItem } from "./SidebarNav";

const push = vi.fn();
let mockPathname = "/home";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push }),
}));

const listMyProjects = vi.fn();
const createProject = vi.fn();
vi.mock("@/lib/projects", () => ({
  listMyProjects: (...args: unknown[]) => listMyProjects(...args),
  createProject: (...args: unknown[]) => createProject(...args),
  canCreateProject: (role: string | null | undefined) => role === "owner_admin",
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-a",
    name: "Project A",
    description: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  push.mockReset();
  listMyProjects.mockReset().mockResolvedValue([]);
  createProject.mockReset();
  mockPathname = "/home";
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("ProjectSwitcher — All Investments entry (founder feedback 2026-09-26)", () => {
  it("renders the All Investments item in the dropdown and fires onSelectAllInvestments when selected", async () => {
    const onSelect = vi.fn();
    const onSelectAllInvestments = vi.fn();
    render(
      <ProjectSwitcher
        projects={[makeProject()]}
        activeProjectId={null}
        onSelect={onSelect}
        onSelectAllInvestments={onSelectAllInvestments}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("All Investments"));

    expect(onSelectAllInvestments).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still renders the All Investments item with zero Projects (the view is also reachable by direct URL)", async () => {
    render(
      <ProjectSwitcher
        projects={[]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onSelectAllInvestments={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));

    expect(await screen.findByText("All Investments")).toBeInTheDocument();
    expect(screen.getByText("No Projects yet.")).toBeInTheDocument();
  });

  it("selecting a Project still fires onSelect, never onSelectAllInvestments", async () => {
    const onSelect = vi.fn();
    const onSelectAllInvestments = vi.fn();
    render(
      <ProjectSwitcher
        projects={[makeProject()]}
        activeProjectId={null}
        onSelect={onSelect}
        onSelectAllInvestments={onSelectAllInvestments}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("Project A"));

    expect(onSelect).toHaveBeenCalledWith("project-a");
    expect(onSelectAllInvestments).not.toHaveBeenCalled();
  });
});

describe("SidebarShell — All Investments navigation", () => {
  it("pushes /all-investments when the switcher's All Investments item is selected", async () => {
    listMyProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={[]} role="owner_admin" />);

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("All Investments"));

    expect(push).toHaveBeenCalledWith("/all-investments");
  });
});

describe("SidebarShell — onNavigate (spec-mobile-responsive-phase1-nav-foundation, Decision #2)", () => {
  const NAV_ITEMS: readonly SidebarNavItem[] = [
    { key: "home", label: "Home", icon: <span />, href: "/home", roles: ["owner_admin"] },
  ];

  it("fires onNavigate after a Project switch (a genuine client-side router.push)", async () => {
    const onNavigate = vi.fn();
    listMyProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={NAV_ITEMS} role="owner_admin" onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("Project A"));

    expect(push).toHaveBeenCalledWith("/projects/project-a/shares");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("fires onNavigate after All Investments is selected", async () => {
    const onNavigate = vi.fn();
    listMyProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={NAV_ITEMS} role="owner_admin" onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("All Investments"));

    expect(push).toHaveBeenCalledWith("/all-investments");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("fires onNavigate when a nav-item link is clicked", async () => {
    const onNavigate = vi.fn();
    render(<SidebarShell items={NAV_ITEMS} role="owner_admin" onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("link", { name: "Home" }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("without onNavigate (the >=860px desktop instance's own case), nothing throws on a Project switch, All Investments, or a nav-item click", async () => {
    listMyProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={NAV_ITEMS} role="owner_admin" />);

    await userEvent.click(screen.getByRole("link", { name: "Home" }));
    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await expect(userEvent.click(await screen.findByText("All Investments"))).resolves.not.toThrow();
  });
});

/**
 * spec-partner-project-list-self-access: `role`-branched Project-selection
 * navigation. `owner_admin`'s own `/projects/{id}/{segment}` navigation
 * (covered above) is untouched; `partner`/`sub_partner` instead navigate to
 * their one already-fully-self-accessible per-Project view, Money History,
 * pre-filtered to the selected Project.
 */
describe("SidebarShell — role-branched Project selection navigation (spec-partner-project-list-self-access)", () => {
  it("owner_admin: selecting a Project still navigates to /projects/{id}/{segment} -- byte-identical to before this spec", async () => {
    listMyProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={[]} role="owner_admin" />);

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("Project A"));

    expect(push).toHaveBeenCalledWith("/projects/project-a/shares");
  });

  it("partner: selecting a Project navigates to /money-history?projectId={id} instead", async () => {
    listMyProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={[]} role="partner" />);

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("Project A"));

    expect(push).toHaveBeenCalledWith("/money-history?projectId=project-a");
  });

  it("sub_partner: selecting a Project navigates to /money-history?projectId={id} instead", async () => {
    listMyProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={[]} role="sub_partner" />);

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("Project A"));

    expect(push).toHaveBeenCalledWith("/money-history?projectId=project-a");
  });

  it("partner: fetches its own Projects via listMyProjects", async () => {
    listMyProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={[]} role="partner" />);

    await waitFor(() => expect(listMyProjects).toHaveBeenCalled());
  });
});

/**
 * spec-quick-add-project-user-modals's 4th acceptance criterion: "Given the
 * Combobox opens with a project already selected, then that project always
 * appears in the list." (Combobox resets its search term to empty on every
 * open, so the active Project is never hidden by a stale search filter from
 * a previous session.)
 */
describe("ProjectSwitcher — already-selected Project always appears in the list", () => {
  it("opening the Combobox with an active Project shows that Project among the options, unfiltered", async () => {
    render(
      <ProjectSwitcher
        projects={[makeProject(), makeProject({ id: "project-b", name: "Project B" })]}
        activeProjectId="project-a"
        onSelect={vi.fn()}
        onSelectAllInvestments={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Project A" }));

    expect(await screen.findByText("Project B")).toBeInTheDocument();
    // "Project A" itself renders twice now: once as the trigger's own label,
    // once as its row in the open list -- both present, neither hidden.
    expect(screen.getAllByText("Project A").length).toBe(2);
  });
});

/**
 * spec-quick-add-project-user-modals: the switcher's "+ Add New Project"
 * quick-add row -- gated to `owner_admin` only (`projects:create`,
 * `authorize.ts:112`), never shown to a session that would 403 on submit.
 */
describe("ProjectSwitcher — quick-add Project (spec-quick-add-project-user-modals)", () => {
  it("owner_admin: the + Add New Project row renders", async () => {
    render(
      <ProjectSwitcher
        projects={[makeProject()]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onSelectAllInvestments={vi.fn()}
        role="owner_admin"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));

    expect(await screen.findByText("+ Add New Project")).toBeInTheDocument();
  });

  it.each(["partner", "sub_partner", undefined] as const)(
    "role=%s: the + Add New Project row never renders",
    async (role) => {
      render(
        <ProjectSwitcher
          projects={[makeProject()]}
          activeProjectId={null}
          onSelect={vi.fn()}
          onSelectAllInvestments={vi.fn()}
          role={role}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
      await screen.findByText("Project A");

      expect(screen.queryByText("+ Add New Project")).not.toBeInTheDocument();
    },
  );

  it("owner_admin: quick-add creates the Project, refreshes the list, and auto-selects the new Project -- no navigation to /projects/new", async () => {
    const onSelect = vi.fn();
    const onProjectCreated = vi.fn();
    createProject.mockResolvedValue({
      id: "project-new",
      name: "Riverside Tower",
      description: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    listMyProjects.mockResolvedValue([makeProject(), { id: "project-new", name: "Riverside Tower" }]);

    render(
      <ProjectSwitcher
        projects={[makeProject()]}
        activeProjectId={null}
        onSelect={onSelect}
        onSelectAllInvestments={vi.fn()}
        role="owner_admin"
        onProjectCreated={onProjectCreated}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("+ Add New Project"));
    await userEvent.type(screen.getByLabelText("Name"), "Riverside Tower");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ name: "Riverside Tower", description: null }));
    expect(onSelect).toHaveBeenCalledWith("project-new");
    expect(onProjectCreated).toHaveBeenCalledWith({ id: "project-new", label: "Riverside Tower" });
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("/projects/new"));
  });

  it("blank name in the quick-add form is blocked client-side, never calls createProject", async () => {
    render(
      <ProjectSwitcher
        projects={[makeProject()]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onSelectAllInvestments={vi.fn()}
        role="owner_admin"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("+ Add New Project"));

    // jsdom enforces the Name Input's own `required` attribute -- a plain
    // Save click on an empty field never even reaches `ProjectQuickAddForm`'s
    // `onSubmit` handler. `fireEvent.submit` dispatches the submit event
    // directly, bypassing that native gate, mirroring
    // `ProjectQuickAddForm.test.tsx`'s identical workaround for this exact
    // "blocked client-side" row of this spec's I/O matrix.
    const form = await screen.findByLabelText("Name").then((input) => input.closest("form"));
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(await screen.findByRole("alert")).toHaveTextContent("Project name is required.");
    expect(createProject).not.toHaveBeenCalled();
  });
});

/**
 * Review-triage fix (spec-quick-add-project-user-modals, blind-hunter +
 * edge-case-hunter): the Combobox regressed keyboard navigation versus what
 * it replaced (the native `<select>`/Radix `DropdownMenu`) -- these cover
 * the ArrowDown/Enter selection path and the Escape-backs-out-of-the-
 * add-form-first path added to close that gap, composed through the real
 * `ProjectSwitcher`/`Combobox`, not a mocked stand-in.
 */
describe("ProjectSwitcher — keyboard navigation (review-triage fix)", () => {
  it("ArrowDown moves the highlight, Enter selects the highlighted Project", async () => {
    const onSelect = vi.fn();
    render(
      <ProjectSwitcher
        projects={[makeProject(), makeProject({ id: "project-b", name: "Project B" })]}
        activeProjectId={null}
        onSelect={onSelect}
        onSelectAllInvestments={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    const search = await screen.findByPlaceholderText("Search Projects…");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("project-b");
  });

  it("Escape while the add-new form has unsaved input backs out to the list, without closing the whole popover", async () => {
    render(
      <ProjectSwitcher
        projects={[makeProject()]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onSelectAllInvestments={vi.fn()}
        role="owner_admin"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("+ Add New Project"));
    const nameInput = screen.getByLabelText("Name");
    await userEvent.type(nameInput, "Unsaved Draft");

    fireEvent.keyDown(nameInput, { key: "Escape" });

    // Back on the list (not the whole popover dismissed): the search input
    // is visible again, and the Project it already had is still shown.
    expect(await screen.findByPlaceholderText("Search Projects…")).toBeInTheDocument();
    expect(screen.getByText("Project A")).toBeInTheDocument();
  });
});

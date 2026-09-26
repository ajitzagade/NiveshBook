// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

const listProjects = vi.fn();
vi.mock("@/lib/projects", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
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
  listProjects.mockReset().mockResolvedValue([]);
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
    listProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={[]} />);

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
    listProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={NAV_ITEMS} onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("Project A"));

    expect(push).toHaveBeenCalledWith("/projects/project-a/shares");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("fires onNavigate after All Investments is selected", async () => {
    const onNavigate = vi.fn();
    listProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={NAV_ITEMS} onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("All Investments"));

    expect(push).toHaveBeenCalledWith("/all-investments");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("fires onNavigate when a nav-item link is clicked", async () => {
    const onNavigate = vi.fn();
    render(<SidebarShell items={NAV_ITEMS} onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("link", { name: "Home" }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("without onNavigate (the >=860px desktop instance's own case), nothing throws on a Project switch, All Investments, or a nav-item click", async () => {
    listProjects.mockResolvedValue([makeProject()]);
    render(<SidebarShell items={NAV_ITEMS} />);

    await userEvent.click(screen.getByRole("link", { name: "Home" }));
    await userEvent.click(screen.getByRole("button", { name: /select a project/i }));
    await expect(userEvent.click(await screen.findByText("All Investments"))).resolves.not.toThrow();
  });
});

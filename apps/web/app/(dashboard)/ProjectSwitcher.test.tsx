// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project } from "@niveshbook/types";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SidebarShell } from "./SidebarShell";

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

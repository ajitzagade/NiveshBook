// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ProjectsPage from "./page";

const listProjects = vi.fn();
vi.mock("@/lib/projects", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
}));

const PROJECT = {
  id: "project-1",
  name: "Sunrise Towers",
  description: "A residential project",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectsPage (Story 2.1, Structure action added by Story 5.10)", () => {
  it("renders a 'Structure' action per row, linking to /structure/[id] (Code Map: mirrors Edit/Shares/Add Money/Withdraw Money's exact pattern)", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    const structureLink = await screen.findByRole("link", { name: /Structure/ });
    expect(structureLink).toHaveAttribute("href", "/structure/project-1");
  });

  it("still renders the existing Edit/Shares/Add Money/Withdraw Money actions unchanged", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    await screen.findByRole("link", { name: /Structure/ });
    expect(screen.getByRole("link", { name: /Edit/ })).toHaveAttribute("href", "/projects/project-1/edit");
    expect(screen.getByRole("link", { name: /Shares/ })).toHaveAttribute("href", "/projects/project-1/shares");
    expect(screen.getByRole("link", { name: /Add Money/ })).toHaveAttribute("href", "/projects/project-1/add-money");
    expect(screen.getByRole("link", { name: /Withdraw Money/ })).toHaveAttribute(
      "href",
      "/projects/project-1/withdraw-money",
    );
  });

  it("renders no Structure action in the empty state (no rows to act on)", async () => {
    listProjects.mockResolvedValue([]);

    render(<ProjectsPage />);

    expect(await screen.findByText("No Projects yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Structure/ })).not.toBeInTheDocument();
  });
});

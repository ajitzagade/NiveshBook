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
  createdAt: "2026-03-15T00:00:00.000Z",
  updatedAt: "2026-03-15T00:00:00.000Z",
  partnersCount: 3,
  subPartnersCount: 1,
  totalSharePercent: "100",
  isFullyAllocated: true,
  addMoneyRoundCount: 2,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectsPage (Story 2.1, card grid redesign founder feedback 2026-09-27)", () => {
  it("renders a 'Structure' action per card, linking to /structure/[id] (Code Map: mirrors Edit/Shares/Add Money/Withdraw Money's exact pattern)", async () => {
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
    expect(screen.getByRole("link", { name: /Add Money/ })).toHaveAttribute(
      "href",
      "/projects/project-1/add-money",
    );
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

  it("renders the Project's name and description", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    expect(await screen.findByText("Sunrise Towers")).toBeInTheDocument();
    expect(screen.getByText("A residential project")).toBeInTheDocument();
  });

  it("omits the description line when a Project has none", async () => {
    listProjects.mockResolvedValue([{ ...PROJECT, description: null }]);

    render(<ProjectsPage />);

    expect(await screen.findByText("Sunrise Towers")).toBeInTheDocument();
    expect(screen.queryByText("A residential project")).not.toBeInTheDocument();
  });

  it("renders the Partners/Sub-partners/Share stat pills from the summary aggregate", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    await screen.findByText("Sunrise Towers");
    expect(screen.getByText("Partners")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Sub-partners")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders a success 'Shares: 100% ✓' chip when fully allocated", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    expect(await screen.findByText("Shares: 100% ✓")).toBeInTheDocument();
  });

  it("renders a danger 'Shares: X%' chip (no checkmark) when not fully allocated", async () => {
    listProjects.mockResolvedValue([{ ...PROJECT, totalSharePercent: "60", isFullyAllocated: false }]);

    render(<ProjectsPage />);

    expect(await screen.findByText("Shares: 60%")).toBeInTheDocument();
  });

  it("renders the funding-round count chip", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    expect(await screen.findByText("2 Add Money")).toBeInTheDocument();
  });

  it("renders the Created date", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    expect(await screen.findByText(/Created/)).toBeInTheDocument();
  });
});

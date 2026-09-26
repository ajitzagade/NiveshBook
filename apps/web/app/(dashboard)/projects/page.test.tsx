// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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

    // spec-mobile-responsive-phase2-table-cards: the desktop Table and the
    // below-860px RowCard stack both render every action -- scoped to the
    // Table here (its own, desktop-specific assertion), the RowCard stack's
    // own copy is covered by the dedicated describe block below.
    const table = await screen.findByRole("table");
    const structureLink = within(table).getByRole("link", { name: /Structure/ });
    expect(structureLink).toHaveAttribute("href", "/structure/project-1");
  });

  it("still renders the existing Edit/Shares/Add Money/Withdraw Money actions unchanged", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    const table = await screen.findByRole("table");
    within(table).getByRole("link", { name: /Structure/ });
    expect(within(table).getByRole("link", { name: /Edit/ })).toHaveAttribute("href", "/projects/project-1/edit");
    expect(within(table).getByRole("link", { name: /Shares/ })).toHaveAttribute("href", "/projects/project-1/shares");
    expect(within(table).getByRole("link", { name: /Add Money/ })).toHaveAttribute(
      "href",
      "/projects/project-1/add-money",
    );
    expect(within(table).getByRole("link", { name: /Withdraw Money/ })).toHaveAttribute(
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

/**
 * spec-mobile-responsive-phase2-table-cards: below 860px, each Project
 * renders as a `RowCard` (Name as title, Description as its one field, all
 * 5 actions carried over verbatim) instead of a table row -- both renders
 * exist in the DOM simultaneously (CSS-only breakpoint switch, Phase 1's
 * convention), scoped here via the stack's own `data-testid` so these
 * assertions are independent of the desktop Table's identical content.
 */
describe("ProjectsPage -- below-860px RowCard stack", () => {
  it("renders one RowCard per Project with Name as title, Description as a field, and all 5 actions reachable", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    const cards = await screen.findByTestId("projects-row-cards");
    expect(within(cards).getByText("Sunrise Towers")).toBeInTheDocument();
    expect(within(cards).getByText("A residential project")).toBeInTheDocument();
    expect(within(cards).getByRole("link", { name: /Edit/ })).toHaveAttribute("href", "/projects/project-1/edit");
    expect(within(cards).getByRole("link", { name: /Shares/ })).toHaveAttribute(
      "href",
      "/projects/project-1/shares",
    );
    expect(within(cards).getByRole("link", { name: /Add Money/ })).toHaveAttribute(
      "href",
      "/projects/project-1/add-money",
    );
    expect(within(cards).getByRole("link", { name: /Withdraw Money/ })).toHaveAttribute(
      "href",
      "/projects/project-1/withdraw-money",
    );
    expect(within(cards).getByRole("link", { name: /Structure/ })).toHaveAttribute(
      "href",
      "/structure/project-1",
    );
  });

  it("renders 'Description' as '—' when the Project has none, mirroring the table's own fallback", async () => {
    listProjects.mockResolvedValue([{ ...PROJECT, description: null }]);

    render(<ProjectsPage />);

    const cards = await screen.findByTestId("projects-row-cards");
    expect(within(cards).getByText("—")).toBeInTheDocument();
  });

  it("renders no card stack in the empty state (EmptyState renders once, not duplicated for table+card)", async () => {
    listProjects.mockResolvedValue([]);

    render(<ProjectsPage />);

    expect(await screen.findByText("No Projects yet")).toBeInTheDocument();
    expect(screen.queryByTestId("projects-row-cards")).not.toBeInTheDocument();
  });

  // Review fix: jsdom never evaluates CSS, so a swapped/dropped breakpoint
  // class would still leave every other assertion above green. Assert the
  // actual wiring directly, mirroring layout.test.tsx's `asideClassName`
  // pattern.
  it("wires the desktop Table and mobile RowCard stack to opposite ends of the 860px breakpoint", async () => {
    listProjects.mockResolvedValue([PROJECT]);

    render(<ProjectsPage />);

    const table = await screen.findByRole("table");
    const tableWrapper = table.closest('[class*="860px"]');
    expect(tableWrapper?.className).toContain("max-[860px]:hidden");

    const cards = screen.getByTestId("projects-row-cards");
    expect(cards.className).toContain("hidden");
    expect(cards.className).toContain("max-[860px]:block");
  });
});

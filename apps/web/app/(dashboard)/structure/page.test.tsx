// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import AllProjectsMoneyFlowPage from "./page";
import type { ProjectFlowCanvasProps } from "./ProjectFlowCanvas";

/**
 * Mocks `ProjectFlowCanvas` entirely -- mirrors `structure/[projectId]/
 * page.test.tsx`'s identical `StructureCanvas` mock and its own doc
 * comment's rationale: no established pattern here for mounting
 * `@xyflow/react`'s `<ReactFlow>` under jsdom (`ResizeObserver`/layout APIs
 * jsdom doesn't provide). This page's own fetch/loading/error/empty/
 * navigation logic is tested here in isolation -- `project-flow-layout.
 * test.ts` covers the real node/edge transform.
 */
let lastCanvasProps: ProjectFlowCanvasProps | null = null;
vi.mock("./ProjectFlowCanvas", () => ({
  ProjectFlowCanvas: (props: ProjectFlowCanvasProps) => {
    lastCanvasProps = props;
    return (
      <div data-testid="project-flow-canvas">
        <p>projects:{props.projects.map((project) => project.id).join(",")}</p>
        <p>movements:{props.movements.length}</p>
        {props.projects.map((project) => (
          <button key={project.id} onClick={() => props.onSelectProject(project.id)}>
            select-{project.id}
          </button>
        ))}
      </div>
    );
  },
}));

const listMyProjects = vi.fn();
vi.mock("@/lib/projects", () => ({
  listMyProjects: (...args: unknown[]) => listMyProjects(...args),
}));

const listAvailableBalances = vi.fn();
vi.mock("@/lib/available-balances", () => ({
  listAvailableBalances: (...args: unknown[]) => listAvailableBalances(...args),
}));

const listMoneyMovements = vi.fn();
vi.mock("@/lib/money-movements", () => ({
  listMoneyMovements: (...args: unknown[]) => listMoneyMovements(...args),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AllProjectsMoneyFlowPage (item 3: All-Projects Money Flow)", () => {
  it("shows a loading state before the fetch resolves", () => {
    listMyProjects.mockReturnValue(new Promise(() => {}));

    render(<AllProjectsMoneyFlowPage />);

    expect(screen.getByText("Loading Money Flow…")).toBeInTheDocument();
  });

  it("shows the empty state when the caller has no Projects", async () => {
    listMyProjects.mockResolvedValue([]);

    render(<AllProjectsMoneyFlowPage />);

    expect(await screen.findByText("No Projects yet")).toBeInTheDocument();
  });

  it("shows the error state when listMyProjects fails", async () => {
    listMyProjects.mockRejectedValue(new Error("Could not load Projects."));

    render(<AllProjectsMoneyFlowPage />);

    expect(await screen.findByText("Could not load Projects.")).toBeInTheDocument();
  });

  it("owner_admin: sums each Project's Partner + Sub-partner balances and passes real cross-Project movements through", async () => {
    listMyProjects.mockResolvedValue([
      { id: "p1", name: "Sunrise Towers" },
      { id: "p2", name: "Lakeview" },
    ]);
    listAvailableBalances.mockImplementation((projectId: string) =>
      Promise.resolve(
        projectId === "p1"
          ? { partners: [{ partnerId: "a", name: "A", sharePercent: "50", balance: "1000.00", subPartners: [{ subPartnerId: "s1", name: "S1", sharePercent: "10", balance: "250.00" }] }] }
          : { partners: [] },
      ),
    );
    listMoneyMovements.mockImplementation((projectId: string) =>
      Promise.resolve({
        moneyMovements:
          projectId === "p2"
            ? [{ id: "mv1", sourceProjectId: "p1", destinationProjectId: "p2", amount: "5000", withdrawalDestinationAllocationId: null, availableBalanceSpendId: null, destinationInvestmentTransactionId: "tx1", createdAt: "" }]
            : [],
      }),
    );

    render(<AllProjectsMoneyFlowPage />);

    await waitFor(() => expect(screen.getByTestId("project-flow-canvas")).toBeInTheDocument());
    expect(lastCanvasProps?.projects).toEqual([
      { id: "p1", name: "Sunrise Towers", availableBalance: "1250.00" },
      { id: "p2", name: "Lakeview", availableBalance: "0.00" },
    ]);
    expect(lastCanvasProps?.movements).toEqual([
      { sourceProjectId: "p1", destinationProjectId: "p2", amount: "5000" },
    ]);
  });

  it("partner/sub_partner: a 403 on available balances/movements shows a null balance and no edges, never crashes", async () => {
    listMyProjects.mockResolvedValue([{ id: "p1", name: "Sunrise Towers" }]);
    listAvailableBalances.mockRejectedValue(new Error("Forbidden"));
    listMoneyMovements.mockRejectedValue(new Error("Forbidden"));

    render(<AllProjectsMoneyFlowPage />);

    await waitFor(() => expect(screen.getByTestId("project-flow-canvas")).toBeInTheDocument());
    expect(lastCanvasProps?.projects).toEqual([{ id: "p1", name: "Sunrise Towers", availableBalance: null }]);
    expect(lastCanvasProps?.movements).toEqual([]);
  });

  it("selecting a Project navigates to its own /structure/[projectId] Money Flow", async () => {
    listMyProjects.mockResolvedValue([{ id: "p1", name: "Sunrise Towers" }]);
    listAvailableBalances.mockResolvedValue({ partners: [] });
    listMoneyMovements.mockResolvedValue({ moneyMovements: [] });

    render(<AllProjectsMoneyFlowPage />);

    const selectButton = await screen.findByText("select-p1");
    selectButton.click();

    expect(push).toHaveBeenCalledWith("/structure/p1");
  });
});

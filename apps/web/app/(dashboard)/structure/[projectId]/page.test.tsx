// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OwnershipStructurePage from "./page";
import type { StructureCanvasProps } from "./StructureCanvas";

/**
 * Mocks `StructureCanvas` entirely -- this codebase has no established
 * pattern for mounting `@xyflow/react`'s `<ReactFlow>` under jsdom (it needs
 * `ResizeObserver`/layout-measurement APIs jsdom doesn't provide), so this
 * page's own logic (fetch-once, view-mode toggle, drill-down state, the
 * error/empty states) is tested here in isolation from the diagram's actual
 * rendering -- `structure-layout.test.ts` covers the real node/edge
 * transform logic that would otherwise be exercised by mounting the canvas.
 * This stub renders just enough of `props` to assert on scope/viewMode from
 * the test.
 */
let lastCanvasProps: StructureCanvasProps | null = null;
vi.mock("./StructureCanvas", () => ({
  StructureCanvas: (props: StructureCanvasProps) => {
    lastCanvasProps = props;
    return (
      <div data-testid="structure-canvas">
        <p>scope:{props.tree.scope.type}</p>
        <p>viewMode:{props.viewMode}</p>
        <p>partners:{props.tree.partners.map((p) => p.partnerId).join(",")}</p>
        {props.tree.partners.map((p) => (
          <button key={p.partnerId} onClick={() => props.onSelectPartner(p.partnerId)}>
            select-{p.partnerId}
          </button>
        ))}
      </div>
    );
  },
}));

const getOwnershipStructure = vi.fn();
vi.mock("@/lib/ownership-structure", () => ({
  getOwnershipStructure: (...args: unknown[]) => getOwnershipStructure(...args),
}));

let mockProjectId = "project-1";
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: mockProjectId }),
  useSearchParams: () => mockSearchParams,
}));

function makePartner(overrides: Record<string, unknown> = {}) {
  return {
    type: "partner",
    partnerId: "a",
    name: "Partner A",
    sharePercent: "60",
    actualAmount: "0",
    totalIn: "0",
    totalOut: "0",
    subPartners: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockProjectId = "project-1";
  mockSearchParams = new URLSearchParams();
  lastCanvasProps = null;
});

describe("OwnershipStructurePage (Story 5.10)", () => {
  it("shows a loading state before the fetch resolves", async () => {
    getOwnershipStructure.mockReturnValue(new Promise(() => {}));
    render(<OwnershipStructurePage />);
    expect(screen.getByText("Loading structure…")).toBeInTheDocument();
  });

  it("renders the generic error state on a rejected fetch -- e.g. a 403 from the route -- never partial data (task item #6)", async () => {
    getOwnershipStructure.mockRejectedValue(new Error("You don't have permission to do that."));

    render(<OwnershipStructurePage />);

    expect(await screen.findByText("You don't have permission to do that.")).toBeInTheDocument();
    expect(screen.queryByTestId("structure-canvas")).not.toBeInTheDocument();
  });

  it("fetches the unscoped project tree when no partnerId/subPartnerId is in the URL", async () => {
    getOwnershipStructure.mockResolvedValue({
      projectId: "project-1",
      projectName: "My Project",
      tree: { scope: { type: "project" }, partners: [makePartner()], soloSubPartner: null },
    });

    render(<OwnershipStructurePage />);

    await waitFor(() =>
      expect(getOwnershipStructure).toHaveBeenCalledWith("project-1", {
        partnerId: undefined,
        subPartnerId: undefined,
      }),
    );
    expect(await screen.findByTestId("structure-canvas")).toBeInTheDocument();
  });

  it("fetches a Partner-scoped tree when ?partnerId= is present (a Partner's own entry point)", async () => {
    mockSearchParams = new URLSearchParams({ partnerId: "partner-xyz" });
    getOwnershipStructure.mockResolvedValue({
      projectId: "project-1",
      projectName: "My Project",
      tree: { scope: { type: "partner", partnerId: "partner-xyz" }, partners: [makePartner({ partnerId: "partner-xyz" })], soloSubPartner: null },
    });

    render(<OwnershipStructurePage />);

    await waitFor(() =>
      expect(getOwnershipStructure).toHaveBeenCalledWith("project-1", {
        partnerId: "partner-xyz",
        subPartnerId: undefined,
      }),
    );
  });

  it("renders EmptyState for a Project with zero current Partner Shares, not a crash (I/O matrix row 10)", async () => {
    getOwnershipStructure.mockResolvedValue({
      projectId: "project-1",
      projectName: "My Project",
      tree: { scope: { type: "project" }, partners: [], soloSubPartner: null },
    });

    render(<OwnershipStructurePage />);

    expect(await screen.findByText("No Partner Shares yet")).toBeInTheDocument();
    expect(screen.queryByTestId("structure-canvas")).not.toBeInTheDocument();
  });

  it("view-mode toggle switches viewMode without re-fetching (Decision #7)", async () => {
    const user = userEvent.setup();
    getOwnershipStructure.mockResolvedValue({
      projectId: "project-1",
      projectName: "My Project",
      tree: { scope: { type: "project" }, partners: [makePartner()], soloSubPartner: null },
    });

    render(<OwnershipStructurePage />);
    await screen.findByTestId("structure-canvas");
    expect(getOwnershipStructure).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Actual Amount" }));

    expect(await screen.findByText("viewMode:actual")).toBeInTheDocument();
    expect(getOwnershipStructure).toHaveBeenCalledTimes(1);
  });

  it("clicking a Partner node in the full tree re-scopes client-side, no re-fetch, and shows 'Back to full Project' (Decision #6)", async () => {
    const user = userEvent.setup();
    getOwnershipStructure.mockResolvedValue({
      projectId: "project-1",
      projectName: "My Project",
      tree: {
        scope: { type: "project" },
        partners: [makePartner({ partnerId: "a" }), makePartner({ partnerId: "b" })],
        soloSubPartner: null,
      },
    });

    render(<OwnershipStructurePage />);
    await screen.findByTestId("structure-canvas");

    await user.click(screen.getByRole("button", { name: "select-a" }));

    expect(await screen.findByText("partners:a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to full Project/ })).toBeInTheDocument();
    expect(getOwnershipStructure).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Back to full Project/ }));
    expect(await screen.findByText("partners:a,b")).toBeInTheDocument();
  });

  it("drill-down does not apply to an already Partner-scoped tree (nothing further to drill into)", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({ partnerId: "a" });
    getOwnershipStructure.mockResolvedValue({
      projectId: "project-1",
      projectName: "My Project",
      tree: { scope: { type: "partner", partnerId: "a" }, partners: [makePartner({ partnerId: "a" })], soloSubPartner: null },
    });

    render(<OwnershipStructurePage />);
    await screen.findByTestId("structure-canvas");

    await user.click(screen.getByRole("button", { name: "select-a" }));

    expect(screen.queryByRole("button", { name: /Back to full Project/ })).not.toBeInTheDocument();
  });
});

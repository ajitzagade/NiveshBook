import { createRoot, type Root } from "react-dom/client";
import { toPng } from "html-to-image";
import type { MoneyFlowEdge, OwnershipStructureTree } from "@niveshbook/core";
import { StructureCanvas } from "../../structure/[projectId]/StructureCanvas";
import type { ViewMode } from "../../structure/[projectId]/structure-layout";

export interface CapturedFlowDiagrams {
  percentage: string;
  actual: string;
  moneyFlow: string;
}

const CAPTURE_MODES: ReadonlyArray<{ mode: ViewMode; key: keyof CapturedFlowDiagrams }> = [
  { mode: "percentage", key: "percentage" },
  { mode: "actual", key: "actual" },
  { mode: "money_flow", key: "moneyFlow" },
];

const CONTAINER_WIDTH = 960;
const CONTAINER_HEIGHT = 520;

function noopSelectPartner() {
  // Capture-only rendering -- nothing is ever clicked off-screen.
}

function waitForSettledFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Renders one already-fetched `OwnershipStructureTree` off-screen through
 * all 3 of `StructureCanvas`'s view modes, sequentially, capturing each as a
 * PNG for the Project Money Flow Report PDF. The live `/structure/[projectId]`
 * page is never navigated to or re-fetched -- this reuses the exact same
 * component against data the caller already has.
 *
 * Hidden via `position: fixed; left: 0; top: 0; z-index: -1` with an
 * explicit width/height -- NOT `display:none` (breaks `@xyflow/react`'s
 * internal DOM measurement for layout/`fitView`) and NOT a large negative
 * offset like `left: -9999px` (confirmed empirically via this feature's own
 * spike: positioning the container outside the viewport's bounds made
 * `html-to-image` capture a blank image every time, with no error -- keeping
 * it at the viewport origin, just stacked behind everything else via
 * `z-index: -1`, captures correctly).
 *
 * Readiness: `StructureCanvas`'s `onInit` fires once the `@xyflow/react`
 * instance is mounted. `fitView()` is called explicitly there (rather than
 * relying on the declarative `fitView` prop's own timing) and its returned
 * promise awaited, then two animation-frame ticks as a settle margin before
 * capture -- this codebase has no prior DOM-to-image precedent, so this
 * sequencing is verified empirically via this feature's own e2e spec, not
 * assumed correct.
 *
 * Sequential, not parallel, across the 3 modes: `StructureCanvas` remounts a
 * fresh `<ReactFlow>` per mode by design (its own `canvasKey` doc comment),
 * so driving 3 live instances at once here would multiply that mount cost
 * for no benefit -- this function is already one project's worth of work in
 * a loop the caller runs once per selected project.
 */
export async function captureStructureDiagrams(
  tree: OwnershipStructureTree,
  projectName: string,
  moneyFlowEdges: MoneyFlowEdge[],
): Promise<CapturedFlowDiagrams> {
  const images: Partial<CapturedFlowDiagrams> = {};

  for (const { mode, key } of CAPTURE_MODES) {
    // A fresh container element per mode, not one reused across all 3 --
    // `html-to-image` returned byte-identical PNGs for genuinely different
    // DOM content when the same container node was reused across sequential
    // captures (confirmed empirically). A new node each time sidesteps
    // whatever node-identity-keyed caching causes that.
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "0";
    container.style.top = "0";
    container.style.width = `${CONTAINER_WIDTH}px`;
    container.style.height = `${CONTAINER_HEIGHT}px`;
    container.style.zIndex = "-1";
    document.body.appendChild(container);

    let root: Root | undefined;
    try {
      root = createRoot(container);
      const activeRoot = root;

      await new Promise<void>((resolve) => {
        activeRoot.render(
          <StructureCanvas
            tree={tree}
            viewMode={mode}
            projectName={projectName}
            onSelectPartner={noopSelectPartner}
            moneyFlowEdges={moneyFlowEdges}
            onInit={(instance) => {
              void instance.fitView({ minZoom: 0.2, padding: 0.15 }).then(() => resolve());
            }}
          />,
        );
      });
      await waitForSettledFrame();

      images[key] = await toPng(container, { pixelRatio: 2 });
    } finally {
      root?.unmount();
      container.remove();
    }
  }

  if (!images.percentage || !images.actual || !images.moneyFlow) {
    throw new Error(`Failed to capture all 3 diagram views for ${projectName}.`);
  }

  return { percentage: images.percentage, actual: images.actual, moneyFlow: images.moneyFlow };
}

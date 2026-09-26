"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Network } from "lucide-react";
import type { OwnershipStructureTree } from "@niveshbook/core";
import { Button, Card, EmptyState, PageHeader } from "@niveshbook/ui";
import { getOwnershipStructure } from "@/lib/ownership-structure";
import { StructureCanvas } from "./StructureCanvas";
import { VIEW_MODES, type ViewMode } from "./structure-layout";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projectName: string; tree: OwnershipStructureTree };

/**
 * Ownership & Money-Flow Structure Diagram (Story 5.10) -- a new top-level
 * page, deliberately OUTSIDE `/projects/**` (this story's Decision #4,
 * directly applying Story 5.9's own hard-learned lesson: a Partner/
 * Sub-partner self-access entry point placed inside `/projects/**` is
 * unreachable, since `projects/layout.tsx`'s `requireOwnerAdminSession()`
 * gates that entire subtree). `"use client"` (Decision #6/#7's client-side
 * drill-down and view-mode toggle) against `GET
 * /api/projects/[id]/ownership-structure` -- this codebase's own established
 * shape for an interactive, 3-role self-access screen (mirrors
 * `reports/[type]/page.tsx`'s identical "use client + REST route" precedent,
 * not the Epic 5 dashboard server-component shape those pages use instead).
 *
 * This page's own authorization/session check is independent of
 * `(dashboard)/layout.tsx`'s shell gate (this story's task item #6): no real
 * tree data is ever fetched here except through the one `getOwnershipStructure`
 * call below, which hits a route that calls `authorize()`/`authorizeScope()`
 * BEFORE any data read (AD-1) -- an unauthorized request (e.g. a `partner`/
 * `sub_partner` session hand-editing the URL to drop `?partnerId=`, or
 * requesting a different Partner's `partnerId`) never renders anything but
 * this page's own generic error state, regardless of the shell having
 * already admitted any of the 3 roles. See this story's Implementation Notes
 * for why this shape was chosen over the Code Map's literal
 * "page.tsx calls authorize()" wording (no precedent for that exists
 * anywhere in this codebase).
 *
 * Fetches once per initial scope (`?partnerId=`/`?subPartnerId=`, absent =
 * the full unscoped Project tree) -- view-mode switching (Decision #7) and
 * drill-down-by-click (Decision #6) are both pure client-side state from
 * there on, never a re-fetch: drilling into a Partner from the full tree
 * just re-renders a client-side-filtered slice of the SAME already-fetched
 * tree.
 */
export default function OwnershipStructurePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const searchParams = useSearchParams();

  const initialPartnerId = searchParams.get("partnerId") ?? undefined;
  const initialSubPartnerId = searchParams.get("subPartnerId") ?? undefined;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [viewMode, setViewMode] = useState<ViewMode>("percentage");
  const [drillPartnerId, setDrillPartnerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Nested inside an async IIFE -- `react-hooks/set-state-in-effect`
    // flags a direct top-level `setState` call in an effect body as if it
    // happened synchronously; mirrors `money-history/page.tsx`'s identical
    // `refresh`/`appliedFilters` fetch precedent. This effect's own
    // dependency array is exactly `[projectId, initialPartnerId,
    // initialSubPartnerId]` (Decision #7): a later drill-down/view-mode
    // change touches neither, so it never re-triggers this fetch.
    void (async () => {
      setState({ status: "loading" });
      try {
        const result = await getOwnershipStructure(projectId, {
          partnerId: initialPartnerId,
          subPartnerId: initialSubPartnerId,
        });
        if (!cancelled) {
          setState({ status: "loaded", projectName: result.projectName, tree: result.tree });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, initialPartnerId, initialSubPartnerId]);

  function handleSelectPartner(partnerId: string) {
    if (state.status !== "loaded" || state.tree.scope.type !== "project") {
      // Drill-down only applies to the full, unscoped Project tree
      // (Decision #6) -- a Partner's own already-scoped view has nothing
      // further to drill into.
      return;
    }
    setDrillPartnerId(partnerId);
  }

  function handleBackToFullProject() {
    setDrillPartnerId(null);
  }

  if (state.status === "loading") {
    return (
      <div>
        <PageHeader title="Ownership & Money-Flow Structure" />
        <Card>
          <p className="text-[13.4px] text-ink-soft">Loading structure…</p>
        </Card>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <PageHeader title="Ownership & Money-Flow Structure" />
        <Card>
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        </Card>
      </div>
    );
  }

  const { tree, projectName } = state;

  const isDrilled = tree.scope.type === "project" && drillPartnerId !== null;
  const effectiveTree: OwnershipStructureTree = isDrilled
    ? {
        scope: { type: "partner", partnerId: drillPartnerId as string },
        partners: tree.partners.filter((partner) => partner.partnerId === drillPartnerId),
        soloSubPartner: null,
      }
    : tree;

  const isEmpty = effectiveTree.partners.length === 0 && !effectiveTree.soloSubPartner;

  return (
    <div>
      <PageHeader
        title="Ownership & Money-Flow Structure"
        description={`${projectName} -- ownership tree, percentages, and money flow.`}
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            {isDrilled ? (
              <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={handleBackToFullProject}>
                Back to full Project
              </Button>
            ) : null}
            {VIEW_MODES.map((mode) => (
              // Structure -> violet (Decision 1's tone map, founder feedback
              // 2026-09-26); `tone` is scoped to `.nb-btn-ghost` in
              // tokens.css, so the active mode's primary variant is
              // untouched by construction.
              <Button
                key={mode.value}
                variant={viewMode === mode.value ? "primary" : "ghost"}
                tone="violet"
                onClick={() => setViewMode(mode.value)}
              >
                {mode.label}
              </Button>
            ))}
          </div>
        }
      />

      <Card>
        {isEmpty ? (
          <EmptyState
            icon={<Network size={22} />}
            title="No Partner Shares yet"
            description="Once this Project has current Partner Shares, its ownership structure will show up here."
          />
        ) : (
          <StructureCanvas
            tree={effectiveTree}
            viewMode={viewMode}
            projectName={projectName}
            onSelectPartner={handleSelectPartner}
          />
        )}
      </Card>
    </div>
  );
}

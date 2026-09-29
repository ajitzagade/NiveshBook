"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Network, Search } from "lucide-react";
import { Button, Card, EmptyState, Input, PageHeader } from "@niveshbook/ui";
import { listMyProjects } from "@/lib/projects";
import { listAvailableBalances } from "@/lib/available-balances";
import { listMoneyMovements } from "@/lib/money-movements";
import { getOwnershipStructure } from "@/lib/ownership-structure";
import { ProjectFlowCanvas } from "./ProjectFlowCanvas";
import type { ProjectFlowMovementInput, ProjectFlowNodeInput } from "./project-flow-layout";
import { FullFlowCanvas } from "./FullFlowCanvas";
import type { FullFlowProjectInput } from "./full-flow-layout";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: ProjectFlowNodeInput[]; movements: ProjectFlowMovementInput[] };

/**
 * The Full Flow tab's own lazily-fetched data (2026-09-29 founder request;
 * UX spec: EXPERIENCE.md "Money Flow tabs" / "Full Flow tree") -- `idle`
 * until the tab is first activated, so the default Projects tab costs
 * nothing extra and existing behavior is byte-for-byte unchanged. One
 * `getOwnershipStructure` call per visible Project (the same self-access-
 * scoped endpoint this page's movements fallback already uses, so a
 * Partner/Sub-partner session sees exactly their own slice per Project,
 * never a sibling's -- no new authorization surface). A single Project's
 * fetch failing degrades to a bare Project card (empty tree), never a
 * whole-tab error.
 */
type FullFlowState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; inputs: FullFlowProjectInput[] };

const EMPTY_TREE: FullFlowProjectInput["tree"] = { scope: { type: "project" }, partners: [], soloSubPartner: null };

/**
 * All-Projects Money Flow (item 3's redesign: "View Structure" -> "View
 * Money Flow", now with a genuine all-Projects entry point, not just the
 * per-Project one at `/structure/[projectId]`). A bare sibling route
 * (Next.js App Router: `structure/page.tsx` alongside `structure/
 * [projectId]/page.tsx`) rather than a special `?projectId=all` query on the
 * per-Project page -- the two views render fundamentally different graphs
 * (Projects-as-nodes here vs. Partners/Sub-partners-as-nodes there), so a
 * shared route would need to branch its entire render tree on that
 * distinction anyway.
 *
 * Reuses `listMyProjects()` (already role-scoped: every Project for
 * `owner_admin`, only the caller's own current Projects for a Partner/
 * Sub-partner -- spec-partner-project-list-self-access) for the node list,
 * so this page needs no role check of its own. Available balances
 * (`available_balances:view`) is `owner_admin`-only server-side with no
 * self-access carve-out -- a Partner/Sub-partner's node simply shows no
 * balance figure (`availableBalance: null`), rather than inventing an
 * approximate number `authorize.ts` was never asked to bless.
 *
 * Cross-Project movements are different (2026-09-28 fix): the plain
 * `money_movements:list` endpoint (`listMoneyMovements`) is also
 * `owner_admin`-only, but a Partner/Sub-partner's own cross-Project
 * transfers are ALREADY visible to them one Project at a time via
 * `GET /api/projects/[id]/ownership-structure`'s self-access-scoped
 * `moneyFlowEdges` (fixed the same day to auto-resolve a Partner/
 * Sub-partner's own Share when no `?partnerId=`/`?subPartnerId=` is given).
 * So: try the owner_admin-only path first per Project; on failure, fall back
 * to that same self-access endpoint and pull its `direction: "out",
 * counterpartyKind: "project"` edges (OUTBOUND, not inbound -- a
 * Partner/Sub-partner's own `myProjects` list is a SUBSET of every Project,
 * unlike `owner_admin`'s "every Project" list, so it can't be assumed the
 * *destination* Project is even one of the actor's own; the *source*
 * Project always is, since fetching it at all requires a Share there,
 * which is exactly what was needed to send the transfer in the first
 * place). This still never double-counts a movement between two of the
 * actor's own Projects: the sending Project's fetch only ever carries the
 * "out" side, the receiving Project's fetch only ever carries the "in"
 * side (mirrored proof: `listMoneyMovements`'s own owner_admin path scopes
 * by *destination* only and still counts each movement exactly once,
 * because a Project's own fetch can never see itself from both directions
 * for the same movement). `counterpartyLabel` is a plain name, not an id,
 * so the destination side is resolved back to an id via this actor's own
 * `myProjects` list -- if the destination Project isn't one of the actor's
 * own (no name match), the edge is silently dropped, exactly like
 * `project-flow-layout.ts`'s existing dangling-edge guard already does for
 * any edge referencing a Project outside the visible set. A Partner/
 * Sub-partner session therefore now sees their own real cross-Project money
 * flow here too, never a sibling's, never anything `authorize.ts` wouldn't
 * otherwise show them.
 */
export default function AllProjectsMoneyFlowPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Founder-reported (2026-09-28): at real-world Project counts (tens of
  // Projects, not the 1-3 this view was designed/tested against), the grid
  // renders every node at once with no way to narrow it down -- `fitView`
  // alone still has to shrink to a zoom level where node labels become
  // illegible, since there's no cap on how many nodes it's fitting. A
  // client-side name search (mirrors `Combobox`'s own `filterComboboxOptions`
  // case-insensitive-substring convention) lets the viewer narrow the canvas
  // down to a legible handful without needing a second, heavier feature
  // (pagination, server-side search) for what's fundamentally the same
  // "find the Project I mean" problem the sidebar's own Project switcher
  // already solves the same way.
  const [search, setSearch] = useState("");
  // "projects" (the existing canvas) is the default -- the new Full Flow
  // tab renders the per-Partner tree view; switching is pure client state,
  // never a route change (EXPERIENCE.md, Money Flow tabs).
  const [tab, setTab] = useState<"projects" | "full_flow">("projects");
  const [fullFlow, setFullFlow] = useState<FullFlowState>({ status: "idle" });
  // See the Full Flow fetch effect below for why these are refs, not deps.
  const fullFlowStartedRef = useRef(false);
  const unmountedRef = useRef(false);
  useEffect(() => {
    // Reset on (re)mount, not just initialization -- React StrictMode's dev
    // double-invocation runs this cleanup once on the simulated unmount,
    // and without the reset the ref would stay `true` for the component's
    // whole real life, silently discarding the Full Flow fetch's result.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState({ status: "loading" });
      try {
        const myProjects = await listMyProjects();
        const projects: ProjectFlowNodeInput[] = await Promise.all(
          myProjects.map(async (project) => {
            try {
              const balances = await listAvailableBalances(project.id);
              const total = balances.partners.reduce((sum, partner) => {
                const subTotal = partner.subPartners.reduce((subSum, sub) => subSum + Number(sub.balance), 0);
                return sum + Number(partner.balance) + subTotal;
              }, 0);
              return { id: project.id, name: project.name, availableBalance: total.toFixed(2) };
            } catch {
              // Best-effort only -- `available_balances:view` is
              // `owner_admin`-only server-side; a Partner/Sub-partner
              // session (or any other failure) simply shows no figure for
              // this Project, per this page's own doc comment.
              return { id: project.id, name: project.name, availableBalance: null };
            }
          }),
        );

        const projectIdByName = new Map(myProjects.map((project) => [project.name, project.id]));
        const movementLists = await Promise.all(
          myProjects.map(async (project): Promise<ProjectFlowMovementInput[]> => {
            try {
              const { moneyMovements } = await listMoneyMovements(project.id);
              return moneyMovements.map((movement) => ({
                sourceProjectId: movement.sourceProjectId,
                destinationProjectId: movement.destinationProjectId,
                amount: movement.amount,
              }));
            } catch {
              // `money_movements:list` is `owner_admin`-only -- fall back to
              // this Project's own self-access-scoped OUTBOUND "project"
              // edges (see this page's own doc comment for why outbound,
              // not inbound, is the one guaranteed resolvable side for a
              // Partner/Sub-partner's own subset of Projects, and why this
              // still never double-counts a movement this actor can see
              // from both ends).
              try {
                const { moneyFlowEdges } = await getOwnershipStructure(project.id);
                return moneyFlowEdges
                  .filter((edge) => edge.direction === "out" && edge.counterpartyKind === "project")
                  .map((edge) => {
                    const destinationProjectId = projectIdByName.get(edge.counterpartyLabel);
                    return destinationProjectId
                      ? { sourceProjectId: project.id, destinationProjectId, amount: String(edge.amount) }
                      : null;
                  })
                  .filter((movement): movement is ProjectFlowMovementInput => movement !== null);
              } catch {
                return [];
              }
            }
          }),
        );
        const movements: ProjectFlowMovementInput[] = movementLists.flat();

        if (!cancelled) {
          setState({ status: "loaded", projects, movements });
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
  }, []);

  const filteredProjects = useMemo(() => {
    if (state.status !== "loaded") return [];
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return state.projects;
    return state.projects.filter((project) => project.name.toLowerCase().includes(trimmed));
  }, [state, search]);

  // Full Flow data, fetched once, on first activation of that tab only --
  // see `FullFlowState`'s own doc comment. Per-Project trees come from the
  // same already-role-scoped `getOwnershipStructure` endpoint the movements
  // fallback above uses; a single Project's failure degrades to a bare
  // Project card, never a whole-tab error.
  // Started-ref rather than a `fullFlow.status` dependency: with the status
  // in this effect's own deps, its `setFullFlow({status:"loading"})` would
  // re-run the effect and the cleanup would cancel the very fetch it just
  // started. The fetch is deliberately NOT cancelled on a tab switch either
  // (it's tab-agnostic session data -- finishing it while the Projects tab
  // is showing just means Full Flow is ready on return); only a real
  // unmount stops the state write.
  useEffect(() => {
    if (tab !== "full_flow" || state.status !== "loaded" || fullFlowStartedRef.current) {
      return;
    }
    fullFlowStartedRef.current = true;
    void (async () => {
      setFullFlow({ status: "loading" });
      try {
        const inputs: FullFlowProjectInput[] = await Promise.all(
          state.projects.map(async (project) => {
            try {
              const { tree, moneyFlowEdges } = await getOwnershipStructure(project.id);
              return {
                projectId: project.id,
                projectName: project.name,
                availableBalance: project.availableBalance,
                tree,
                moneyFlowEdges,
              };
            } catch {
              return {
                projectId: project.id,
                projectName: project.name,
                availableBalance: project.availableBalance,
                tree: EMPTY_TREE,
                moneyFlowEdges: [],
              };
            }
          }),
        );
        if (!unmountedRef.current) {
          setFullFlow({ status: "loaded", inputs });
        }
      } catch (error) {
        if (!unmountedRef.current) {
          setFullFlow({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      }
    })();
  }, [tab, state]);

  const filteredFullFlowInputs = useMemo(() => {
    if (fullFlow.status !== "loaded") return [];
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return fullFlow.inputs;
    // Same name filter as the Projects tab. A cross-Project edge whose
    // destination is filtered out of view simply falls back to a dashed
    // external reference card (full-flow-layout.ts resolves destinations
    // against this same filtered set), so the link is never silently lost.
    return fullFlow.inputs.filter((input) => input.projectName.toLowerCase().includes(trimmed));
  }, [fullFlow, search]);

  return (
    <div>
      <PageHeader
        title="All Projects — Money Flow"
        description="Every Project you can see, with any real money that's moved between them. Select a Project for its own full Money Flow."
        action={
          // The per-Project screen's exact view-mode Button pattern (violet
          // tone, primary-when-active) doing tab duty -- EXPERIENCE.md's
          // "Money Flow tabs": no new tab component invented.
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant={tab === "projects" ? "primary" : "ghost"} tone="violet" onClick={() => setTab("projects")}>
              Projects
            </Button>
            <Button variant={tab === "full_flow" ? "primary" : "ghost"} tone="violet" onClick={() => setTab("full_flow")}>
              Full Flow
            </Button>
          </div>
        }
      />

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Money Flow…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.projects.length === 0 ? (
          <EmptyState
            icon={<Network size={22} />}
            title="No Projects yet"
            description="Once you're part of a Project, its Money Flow will show up here."
          />
        ) : (
          <>
            {state.projects.length > 1 ? (
              <div className="relative mb-3 max-w-[320px]">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search Projects…"
                  aria-label="Search Projects"
                  className="pl-8"
                />
              </div>
            ) : null}
            {tab === "projects" ? (
              filteredProjects.length === 0 ? (
                <EmptyState
                  icon={<Search size={22} />}
                  title="No Projects match your search"
                  description="Try a different name, or clear the search to see every Project again."
                />
              ) : (
                <ProjectFlowCanvas
                  projects={filteredProjects}
                  movements={state.movements}
                  onSelectProject={(projectId) => router.push(`/structure/${projectId}`)}
                />
              )
            ) : fullFlow.status === "loading" || fullFlow.status === "idle" ? (
              <p className="text-[13.4px] text-ink-soft">Loading Full Flow…</p>
            ) : fullFlow.status === "error" ? (
              <p role="alert" className="text-[13.4px] text-danger">
                {fullFlow.message}
              </p>
            ) : filteredFullFlowInputs.length === 0 ? (
              <EmptyState
                icon={<Search size={22} />}
                title="No Projects match your search"
                description="Try a different name, or clear the search to see every Project again."
              />
            ) : (
              <>
                {/* Legend -- always visible above the canvas (EXPERIENCE.md, Full Flow tree). */}
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-soft">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-ink-faint opacity-60" /> ownership
                    (share)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-info" /> moved to another Project
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-violet" /> to a person / Available
                    Balance
                  </span>
                  <span className="text-ink-faint">Amounts are all-time totals for each person on that Project.</span>
                </div>
                <FullFlowCanvas
                  projects={filteredFullFlowInputs}
                  onSelectProject={(projectId) => router.push(`/structure/${projectId}`)}
                />
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

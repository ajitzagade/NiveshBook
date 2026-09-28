"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Network, Search } from "lucide-react";
import { Card, EmptyState, Input, PageHeader } from "@niveshbook/ui";
import { listMyProjects } from "@/lib/projects";
import { listAvailableBalances } from "@/lib/available-balances";
import { listMoneyMovements } from "@/lib/money-movements";
import { getOwnershipStructure } from "@/lib/ownership-structure";
import { ProjectFlowCanvas } from "./ProjectFlowCanvas";
import type { ProjectFlowMovementInput, ProjectFlowNodeInput } from "./project-flow-layout";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: ProjectFlowNodeInput[]; movements: ProjectFlowMovementInput[] };

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

  return (
    <div>
      <PageHeader
        title="All Projects — Money Flow"
        description="Every Project you can see, with any real money that's moved between them. Select a Project for its own full Money Flow."
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
            {filteredProjects.length === 0 ? (
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
            )}
          </>
        )}
      </Card>
    </div>
  );
}

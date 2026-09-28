"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Network } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@niveshbook/ui";
import { listMyProjects } from "@/lib/projects";
import { listAvailableBalances } from "@/lib/available-balances";
import { listMoneyMovements } from "@/lib/money-movements";
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
 * (`available_balances:view`) and cross-Project movements
 * (`money_movements:list`) are both `owner_admin`-only server-side gates
 * already -- rather than duplicating that check here, this page just
 * attempts both fetches per Project and treats a 403/failure as "not shown"
 * (an `availableBalance: null` node, or simply no edges), the same safe-
 * default pattern `spec-quick-add-project-user-modals` already established
 * for a failed role check. A Partner/Sub-partner session therefore still
 * gets real value here -- a map of the Projects they're part of, each
 * clickable into their own already-permitted `/structure/[projectId]` view
 * -- without ever seeing data `authorize.ts` wouldn't otherwise show them.
 */
export default function AllProjectsMoneyFlowPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

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

        const movementLists = await Promise.all(
          myProjects.map((project) =>
            listMoneyMovements(project.id)
              .then((result) => result.moneyMovements)
              .catch(() => []),
          ),
        );
        const movements: ProjectFlowMovementInput[] = movementLists
          .flat()
          .map((movement) => ({
            sourceProjectId: movement.sourceProjectId,
            destinationProjectId: movement.destinationProjectId,
            amount: movement.amount,
          }));

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
          <ProjectFlowCanvas
            projects={state.projects}
            movements={state.movements}
            onSelectProject={(projectId) => router.push(`/structure/${projectId}`)}
          />
        )}
      </Card>
    </div>
  );
}

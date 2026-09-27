"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Plus, Pencil, Percent, Minus, Network } from "lucide-react";
import type { ProjectListItem } from "@niveshbook/types";
import { Button, Card, EmptyState, PageHeader, StatusChip } from "@niveshbook/ui";
import { listProjects } from "@/lib/projects";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: ProjectListItem[] };

/**
 * The card grid every Project renders into (founder feedback 2026-09-27,
 * Bolt-mockup redesign) -- mirrors the Home page's own `DASHBOARD_CARD_GRID`
 * shape: two cards per row, one column below 860px.
 */
const PROJECT_CARD_GRID = "grid grid-cols-2 gap-4 max-[860px]:grid-cols-1";

/**
 * Postgres's `numeric(7,4)` column always round-trips at its full declared
 * scale (a stored `"33.33"` reads back as `"33.3300"` -- exact, no precision
 * lost, just padded). Trims trailing fractional zeros for display only, via
 * plain string manipulation (no `parseFloat`/`Number()`) -- mirrors the
 * Partner Shares page's own `formatSharePercent`, duplicated locally per this
 * codebase's established per-module local-helper convention (`shares/page.tsx`,
 * `add-money/page.tsx`, `withdraw-money/page.tsx`, `home/page.tsx` each
 * already have their own copy).
 */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

function formatCreatedDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The 5 per-project actions (Edit/Shares/Add Money/Withdraw Money/
 * Structure), tones per DESIGN.md's canonical nav-badge map (founder
 * feedback 2026-09-26) -- extracted so every Project's card footer renders
 * the exact same buttons.
 */
function ProjectActionButtons({ project }: { project: ProjectListItem }) {
  return (
    <>
      <Button asChild variant="ghost" tone="accent">
        <Link href={`/projects/${project.id}/edit`} className="inline-flex items-center gap-1.5">
          <Pencil size={14} />
          Edit
        </Link>
      </Button>
      <Button asChild variant="ghost" tone="info">
        <Link href={`/projects/${project.id}/shares`} className="inline-flex items-center gap-1.5">
          <Percent size={14} />
          Partner Shares
        </Link>
      </Button>
      <Button asChild variant="ghost" tone="success">
        <Link href={`/projects/${project.id}/add-money`} className="inline-flex items-center gap-1.5">
          <Plus size={14} />
          Add Money
        </Link>
      </Button>
      <Button asChild variant="ghost" tone="danger">
        <Link href={`/projects/${project.id}/withdraw-money`} className="inline-flex items-center gap-1.5">
          <Minus size={14} />
          Withdraw Money
        </Link>
      </Button>
      <Button asChild variant="ghost" tone="violet">
        <Link href={`/structure/${project.id}`} className="inline-flex items-center gap-1.5">
          <Network size={14} />
          View Structure
        </Link>
      </Button>
    </>
  );
}

/**
 * One Project card (founder feedback 2026-09-27, Bolt-mockup redesign) --
 * name + description, Partners/Sub-partners/Share% stat pills,
 * "Shares: X% ✓/incomplete" and "N Add Money" chips (from the
 * `assembleProjectSummaries` aggregate, `GET /api/projects`), and a footer
 * with the Created date plus the existing 5 action buttons unchanged. No
 * chevron/whole-card link -- there's no unscoped "view Project" destination
 * today, so this deliberately doesn't fake one.
 */
function ProjectCard({ project }: { project: ProjectListItem }) {
  const sharePercentLabel = formatSharePercent(project.totalSharePercent);
  return (
    <Card elevated className="flex flex-col">
      <div className="text-[16px] font-bold">{project.name}</div>
      {project.description ? (
        <div className="mt-0.5 text-[13px] text-ink-soft">{project.description}</div>
      ) : null}

      <div className="my-3.5 grid grid-cols-3 gap-2">
        <div className="rounded-el bg-surface-alt px-2 py-2 text-center">
          <div className="text-[10.6px] font-semibold text-ink-faint">Partners</div>
          <div className="text-[15px] font-bold">{project.partnersCount}</div>
        </div>
        <div className="rounded-el bg-surface-alt px-2 py-2 text-center">
          <div className="text-[10.6px] font-semibold text-ink-faint">Sub-partners</div>
          <div className="text-[15px] font-bold">{project.subPartnersCount}</div>
        </div>
        <div className="rounded-el bg-surface-alt px-2 py-2 text-center">
          <div className="text-[10.6px] font-semibold text-ink-faint">Share</div>
          <div className="text-[15px] font-bold">{sharePercentLabel}%</div>
        </div>
      </div>

      <div className="mb-3.5 flex flex-wrap gap-1.5">
        <StatusChip variant={project.isFullyAllocated ? "success" : "danger"}>
          Shares: {sharePercentLabel}%{project.isFullyAllocated ? " ✓" : ""}
        </StatusChip>
        <StatusChip variant="info">{project.addMoneyRoundCount} Add Money</StatusChip>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-[12px] text-ink-faint">Created {formatCreatedDate(project.createdAt)}</span>
        <div className="flex flex-wrap gap-1.5">
          <ProjectActionButtons project={project} />
        </div>
      </div>
    </Card>
  );
}

/**
 * Projects list (Story 2.1): fetches `GET /api/projects` client-side and
 * renders all four required states (NFR8) — loading, error, empty, loaded.
 * Owner/Admin-only at the API layer (`authorizeScope("projects:list")`) —
 * a non-Owner/Admin sees the plain error state below, not partial data.
 */
export default function ProjectsPage() {
  const [state, setState] = useState<ListState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    listProjects()
      .then((projects) => {
        if (!cancelled) setState({ status: "loaded", projects });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Create and edit Projects. Partner Shares are added separately, after the Project exists."
        action={
          <Button asChild>
            <Link href="/projects/new" className="inline-flex items-center gap-1.5">
              <Plus size={14} />
              New Project
            </Link>
          </Button>
        }
      />

      {state.status === "loading" ? (
        <Card>
          <p className="text-[13.4px] text-ink-soft">Loading Projects…</p>
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        </Card>
      ) : state.projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban size={22} />}
            title="No Projects yet"
            description="Create your first Project to start tracking partner investments and withdrawals."
            action={
              <Button asChild>
                <Link href="/projects/new" className="inline-flex items-center gap-1.5">
                  <Plus size={14} />
                  New Project
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className={PROJECT_CARD_GRID}>
          {state.projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

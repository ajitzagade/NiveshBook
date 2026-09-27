"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Plus, Pencil, Percent, Minus, Network } from "lucide-react";
import type { Project } from "@niveshbook/types";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  RowCard,
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
} from "@niveshbook/ui";
import { listProjects } from "@/lib/projects";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: Project[] };

/**
 * The 5 per-project actions (Edit/Shares/Add Money/Withdraw Money/
 * Structure), tones per DESIGN.md's canonical nav-badge map (founder
 * feedback 2026-09-26) -- extracted so the desktop Table cell and the
 * below-860px `RowCard`'s own `action` slot (spec-mobile-responsive-
 * phase2-table-cards, Decision #4) render the exact same buttons rather
 * than duplicating this JSX twice.
 *
 * `compact` (founder feedback 2026-09-27): the desktop Table needs all 5 on
 * one row within the page's existing max-width, so it renders the `sm`
 * Button size with a smaller icon; the below-860px RowCard stack has a full
 * card row per button and stays at the normal, more touch-friendly size.
 */
function ProjectActionButtons({ project, compact }: { project: Project; compact?: boolean }) {
  const size = compact ? "sm" : "md";
  const iconSize = compact ? 12 : 14;
  return (
    <>
      <Button asChild variant="ghost" tone="accent" size={size}>
        <Link href={`/projects/${project.id}/edit`} className="inline-flex items-center gap-1.5">
          <Pencil size={iconSize} />
          Edit
        </Link>
      </Button>
      <Button asChild variant="ghost" tone="info" size={size}>
        <Link href={`/projects/${project.id}/shares`} className="inline-flex items-center gap-1.5">
          <Percent size={iconSize} />
          Partner Shares
        </Link>
      </Button>
      <Button asChild variant="ghost" tone="success" size={size}>
        <Link href={`/projects/${project.id}/add-money`} className="inline-flex items-center gap-1.5">
          <Plus size={iconSize} />
          Add Money
        </Link>
      </Button>
      <Button asChild variant="ghost" tone="danger" size={size}>
        <Link href={`/projects/${project.id}/withdraw-money`} className="inline-flex items-center gap-1.5">
          <Minus size={iconSize} />
          Withdraw Money
        </Link>
      </Button>
      <Button asChild variant="ghost" tone="violet" size={size}>
        <Link href={`/structure/${project.id}`} className="inline-flex items-center gap-1.5">
          <Network size={iconSize} />
          View Structure
        </Link>
      </Button>
    </>
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

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Projects…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.projects.length === 0 ? (
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
        ) : (
          <>
            {/*
              Desktop (>=860px): the existing Table, byte-for-byte unchanged
              other than this new wrapping div (spec-mobile-responsive-
              phase2-table-cards) -- hidden below 860px, where the RowCard
              stack below takes over instead.
            */}
            <div className="max-[860px]:hidden">
              <Table>
                <TableHead>
                  <TableRow>
                    <Th className="w-[180px]">Name</Th>
                    <Th className="!text-left">Actions</Th>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.projects.map((project) => (
                    <TableRow key={project.id}>
                      {/* Capped width (founder feedback 2026-09-27): an HTML table auto-sizes Name generously by default, starving Actions of the room its 5 buttons need for one line. truncate + title give a long name a native tooltip fallback. */}
                      <Td className="max-w-[180px] truncate font-semibold" title={project.name}>
                        {project.name}
                      </Td>
                      <Td className="!text-left">
                        <div className="flex flex-wrap gap-1.5">
                          <ProjectActionButtons project={project} compact />
                        </div>
                      </Td>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/*
              Below 860px: one RowCard per Project (Decision #4) -- title
              carries the Name column; the 5 action buttons render verbatim
              in RowCard's flex-wrap action slot instead of being trimmed or
              hidden. No Description field (founder feedback 2026-09-27 --
              dropped from the list view entirely, still editable on the
              Project's own Edit page).
            */}
            <div className="hidden max-[860px]:block" data-testid="projects-row-cards">
              {state.projects.map((project) => (
                <RowCard key={project.id} title={project.name} fields={[]} action={<ProjectActionButtons project={project} />} />
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

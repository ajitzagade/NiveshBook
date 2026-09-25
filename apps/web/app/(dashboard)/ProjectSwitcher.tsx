"use client";

import { ChevronDown, FolderKanban } from "lucide-react";
import type { Project } from "@niveshbook/types";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@niveshbook/ui";

/**
 * The sidebar's project switcher: a dropdown of every current Project,
 * showing which one is "active" and letting the Owner/Admin change it.
 * `SidebarShell` owns the actual selection state (localStorage + URL sync)
 * and the Projects list fetch -- this component is presentation-only, so it
 * has no fetch/effect of its own.
 *
 * `activeProjectId` and `projects` are passed separately (rather than one
 * resolved `selected: Project | null`) so the trigger label can tell apart
 * "no Project has ever been chosen" from "one HAS been chosen, its name
 * just hasn't loaded yet" -- the latter is the common case right after any
 * sidebar click, since `NavItem` renders a plain `<a>` (not `next/link`), so
 * every navigation is a full page reload that remounts this component and
 * re-fetches `projects` from scratch, even though `activeProjectId` itself
 * is already known instantly (derived from the URL, no fetch needed).
 * Showing "Select a Project" during that brief window would incorrectly
 * read as "nothing is selected."
 */
export function ProjectSwitcher({
  projects,
  activeProjectId,
  onSelect,
}: {
  projects: readonly Project[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
}) {
  const active = activeProjectId ? projects.find((project) => project.id === activeProjectId) : null;
  const label = !activeProjectId ? "Select a Project" : active ? active.name : "Loading…";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-el border border-border bg-surface px-2.5 py-2 text-left text-[12.6px] font-semibold text-ink transition-colors hover:bg-surface-alt"
        >
          <FolderKanban size={14} className="shrink-0 text-ink-soft" />
          <span className="flex-1 truncate">{label}</span>
          <ChevronDown size={14} className="shrink-0 text-ink-faint" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[204px]">
        {projects.length === 0 ? (
          <p className="px-2.5 py-1.5 text-[12.6px] text-ink-faint">No Projects yet.</p>
        ) : (
          projects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}>
              {project.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

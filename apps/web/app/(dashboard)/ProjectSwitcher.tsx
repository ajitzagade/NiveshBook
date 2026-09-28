"use client";

import { ChevronDown, FolderKanban, LayoutGrid } from "lucide-react";
import { Combobox, PopoverClose, type ComboboxOption } from "@niveshbook/ui";
import { canCreateProject, type MyProjectSummary } from "@/lib/projects";
import { ProjectQuickAddForm } from "./projects/ProjectQuickAddForm";

/**
 * The sidebar's project switcher: a searchable Combobox of every current
 * Project, showing which one is "active" and letting the Owner/Admin change
 * it (spec-quick-add-project-user-modals: replaced the plain `DropdownMenu`
 * with the new reusable `Combobox` primitive, adding a client-side search
 * and a gated "+ Add New Project" quick-add row -- everything else about
 * this component's contract is unchanged). `SidebarShell` owns the actual
 * selection state (localStorage + URL sync) and the Projects list fetch --
 * this component is presentation-only, so it has no fetch/effect of its own.
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
 *
 * `projects` is narrowed to `MyProjectSummary` (`{ id, name }`,
 * spec-partner-project-list-self-access) -- this component only ever reads
 * those two fields (Interface Segregation), and its caller (`SidebarShell`)
 * now sources the list from `listMyProjects()`, whose response shape carries
 * nothing more. Imported from `@/lib/projects` (a plain `apps/web` file, not
 * `@niveshbook/core`) -- the client-bundle gotcha this codebase otherwise
 * guards against doesn't apply to this import.
 */
export function ProjectSwitcher({
  projects,
  activeProjectId,
  onSelect,
  onSelectAllInvestments,
  role,
  onProjectCreated,
}: {
  projects: readonly MyProjectSummary[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  /** Founder feedback 2026-09-26: navigates to the cross-project `/all-investments` view -- `SidebarShell` owns the navigation, keeping this component presentation-only. */
  onSelectAllInvestments: () => void;
  /**
   * spec-quick-add-project-user-modals: gates the "+ Add New Project" row --
   * only an `owner_admin` session ever passes `"projects:create"`
   * (`authorize.ts:112`); every other role never even sees the option
   * (this spec's "never show what would 403 on submit" rule). Optional so
   * a caller/test that doesn't care about quick-add keeps compiling --
   * omitting it just hides the row, the safe default.
   */
  role?: "owner_admin" | "partner" | "sub_partner";
  /**
   * Fires once a quick-add create succeeds, so `SidebarShell` can refresh
   * its own `projects` list -- selection itself is handled by `onSelect`
   * (the Combobox calls it directly on quick-add success, same as picking
   * an existing row), this callback is purely "the list is now stale, go
   * refetch it."
   */
  onProjectCreated?: (project: ComboboxOption) => void;
}) {
  const active = activeProjectId ? projects.find((project) => project.id === activeProjectId) : null;
  const label = !activeProjectId ? "Select a Project" : active ? active.name : "Loading…";

  const options: ComboboxOption[] = projects.map((project) => ({ id: project.id, label: project.name }));

  return (
    <Combobox
      options={options}
      value={activeProjectId}
      onChange={onSelect}
      emptyMessage="No Projects yet."
      searchPlaceholder="Search Projects…"
      contentClassName="w-[204px]"
      trigger={
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-el border border-border bg-surface px-2.5 py-2 text-left text-[12.6px] font-semibold text-ink transition-colors hover:bg-surface-alt"
        >
          <FolderKanban size={14} className="shrink-0 text-ink-soft" />
          <span className="flex-1 truncate">{label}</span>
          <ChevronDown size={14} className="shrink-0 text-ink-faint" />
        </button>
      }
      header={
        /*
          Founder feedback 2026-09-26: the cross-project "All Investments"
          entry -- always present (it's also reachable by direct URL),
          visually separated from the per-Project search/list below by a
          bottom border. Wrapped in `PopoverClose` (not the Combobox's own
          row-select path -- this is a fixed action, not a Project option)
          so clicking it closes the popover the same way picking a Project
          does.
        */
        <PopoverClose asChild>
          <button
            type="button"
            onClick={onSelectAllInvestments}
            className="mb-1.5 flex w-full items-center gap-2 border-b border-border px-2.5 py-1.5 pb-2 text-left text-[13px] text-ink outline-none hover:bg-surface-alt"
          >
            <LayoutGrid size={14} className="shrink-0 text-ink-soft" />
            All Investments
          </button>
        </PopoverClose>
      }
      addNew={
        canCreateProject(role)
          ? {
              label: "+ Add New Project",
              renderForm: ({ onCancel, onCreated }) => (
                <ProjectQuickAddForm
                  compact
                  onCancel={onCancel}
                  onCreated={(project) => {
                    const option: ComboboxOption = { id: project.id, label: project.name };
                    onProjectCreated?.(option);
                    onCreated(option);
                  }}
                />
              ),
            }
          : undefined
      }
    />
  );
}

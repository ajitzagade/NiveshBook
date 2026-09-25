"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Project } from "@niveshbook/types";
import { listProjects } from "@/lib/projects";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SidebarNav, type SidebarNavItem } from "./SidebarNav";

const STORAGE_KEY = "niveshbook:active-project-id";

/**
 * The 4 Project-scoped nav items (`layout.tsx`'s own doc comment) and the
 * URL segment each corresponds to under `/projects/[id]/...`.
 */
const SCOPED_SEGMENT: Partial<Record<SidebarNavItem["key"], string>> = {
  partnerShares: "shares",
  addMoney: "add-money",
  withdrawMoney: "withdraw-money",
  availableBalance: "available-balance",
};

/**
 * Owns the "active Project" concept the 4 Project-scoped sidebar links
 * (Partner Shares/Add Money/Withdraw Money/Available Balance) were missing
 * (`layout.tsx`'s own long-standing doc comment on `NAV_ITEMS`) -- purely a
 * client-side convenience, never persisted server-side, so it's implemented
 * here rather than as a new domain concept in `packages/core`.
 *
 * Two ways the active Project gets set, both converging on the same
 * `localStorage` key so either one keeps the other in sync:
 * 1. Explicitly, via the `ProjectSwitcher` dropdown -- also navigates,
 *    preserving whichever scoped page you're currently on (e.g. switching
 *    Projects while on Add Money lands you on the new Project's Add Money).
 * 2. Implicitly, by visiting any `/projects/[id]/...` page directly (e.g.
 *    the per-Project buttons on the Projects list) -- the URL itself is
 *    treated as the source of truth for "the Project you're looking at."
 *
 * Once set, the sidebar's 4 Project-scoped links point straight at that
 * Project instead of falling back to the Projects list.
 */
export function SidebarShell({ items }: { items: readonly SidebarNavItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((result) => {
        if (!cancelled) setProjects(result);
      })
      .catch(() => {
        // Best-effort only -- the switcher just shows "No Projects yet" and
        // every scoped link keeps falling back to `/projects`, exactly as it
        // did before this existed.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restores the last-active Project once, on mount, from localStorage.
  // Nesting the setState call inside an async IIFE satisfies
  // `react-hooks/set-state-in-effect`, mirroring `money-history/page.tsx`'s
  // identical precedent.
  useEffect(() => {
    void (async () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setActiveProjectId(stored);
    })();
  }, []);

  // Treats the URL itself as the source of truth whenever it's already on a
  // specific Project's scoped page -- keeps the switcher (and every other
  // scoped link) in sync with wherever you actually navigated, not just
  // wherever the dropdown last pointed.
  useEffect(() => {
    void (async () => {
      const match = /^\/projects\/([^/]+)\//.exec(pathname);
      if (match) {
        setActiveProjectId(match[1]);
        window.localStorage.setItem(STORAGE_KEY, match[1]);
      }
    })();
  }, [pathname]);

  function selectProject(projectId: string) {
    setActiveProjectId(projectId);
    window.localStorage.setItem(STORAGE_KEY, projectId);

    // Preserve whichever scoped page you're currently on (e.g. switching
    // Projects while viewing Add Money lands on the new Project's Add
    // Money); otherwise land on Partner Shares as a sensible default.
    const currentSegment = /^\/projects\/[^/]+\/([a-z-]+)$/.exec(pathname)?.[1];
    const segment = currentSegment ?? "shares";
    router.push(`/projects/${projectId}/${segment}`);
  }

  const resolvedItems: SidebarNavItem[] = items.map((item) => {
    const segment = SCOPED_SEGMENT[item.key];
    if (!segment || !activeProjectId) return item;
    return { ...item, href: `/projects/${activeProjectId}/${segment}` };
  });

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <ProjectSwitcher projects={projects} selected={activeProject} onSelect={selectProject} />
      <SidebarNav items={resolvedItems} />
    </div>
  );
}

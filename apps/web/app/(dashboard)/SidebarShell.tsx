"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ComboboxOption } from "@niveshbook/ui";
import { listMyProjects, type MyProjectSummary } from "@/lib/projects";
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
export function SidebarShell({
  items,
  role,
  onNavigate,
}: {
  items: readonly SidebarNavItem[];
  /**
   * spec-partner-project-list-self-access: drives `selectProject`'s
   * navigation branch below -- `owner_admin` is unchanged (navigates into
   * the Project's own Owner/Admin-only scoped pages); `partner`/
   * `sub_partner` instead navigate to their one already-fully-self-
   * accessible per-Project view, Money History. The Project list fetch
   * itself (`listMyProjects()` below) is already scoped server-side for
   * every role -- this prop only affects navigation, not the fetch.
   */
  role: "owner_admin" | "partner" | "sub_partner";
  /**
   * Fires whenever this shell causes a navigation -- a nav-item link, a
   * Project switch, or "All Investments" (spec-mobile-responsive-phase1-
   * nav-foundation, Decision #2) -- so a `MobileNav`-hosted instance
   * (inside the off-canvas `Drawer`) can close itself. The `>=860px`
   * desktop `<aside>` instance passes nothing, so this stays a no-op there.
   */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<readonly MyProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  // Reset to `true` in the effect setup (not just declared `useRef(true)`)
  // -- React 18 Strict Mode double-invokes this effect once on initial
  // mount in dev (mount -> cleanup -> mount again), and without the reset
  // that dev-only cleanup pass permanently stuck the ref at `false` for
  // this component's whole real lifetime, silently dropping
  // `handleProjectCreated`'s post-fetch `setProjects` call below.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listMyProjects()
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

    if (role !== "owner_admin") {
      // spec-partner-project-list-self-access: a Partner/Sub-partner has no
      // access to the Owner/Admin-only `/projects/{id}/{segment}` pages
      // below -- their one already-fully-self-accessible per-Project view is
      // Money History, pre-filtered to this Project.
      router.push(`/money-history?projectId=${projectId}`);
      onNavigate?.();
      return;
    }

    // Preserve whichever scoped page you're currently on (e.g. switching
    // Projects while viewing Add Money lands on the new Project's Add
    // Money); otherwise land on Partner Shares as a sensible default.
    const currentSegment = /^\/projects\/[^/]+\/([a-z-]+)$/.exec(pathname)?.[1];
    const segment = currentSegment ?? "shares";
    router.push(`/projects/${projectId}/${segment}`);
    onNavigate?.();
  }

  /**
   * spec-quick-add-project-user-modals: fires once `ProjectSwitcher`'s
   * inline "+ Add New Project" quick-add succeeds. `selectProject` itself
   * is unchanged (`Combobox` calls `onSelect`/`selectProject` directly on
   * success, exactly like picking an existing row) -- this handler's own
   * job is purely refreshing the stale `projects` list: an optimistic
   * append makes the new Project visible/selectable immediately (no flash
   * of "Loading…" while the list re-fetches, since `router.push` below is a
   * client-side navigation that never remounts this component), followed by
   * a best-effort `listMyProjects()` re-fetch to reconcile with the server's
   * canonical list.
   */
  function handleProjectCreated(project: ComboboxOption) {
    setProjects((prev) => (prev.some((existing) => existing.id === project.id) ? prev : [...prev, { id: project.id, name: project.label }]));
    listMyProjects()
      .then((result) => {
        if (mountedRef.current) setProjects(result);
      })
      .catch(() => {
        // Best-effort reconciliation only -- the optimistic append above
        // already made the new Project visible/selectable.
      });
  }

  const resolvedItems: SidebarNavItem[] = items.map((item) => {
    const segment = SCOPED_SEGMENT[item.key];
    if (!segment || !activeProjectId) return item;
    return { ...item, href: `/projects/${activeProjectId}/${segment}` };
  });

  return (
    <div className="flex flex-col gap-3">
      <ProjectSwitcher
        projects={projects}
        activeProjectId={activeProjectId}
        onSelect={selectProject}
        onSelectAllInvestments={() => {
          router.push("/all-investments");
          onNavigate?.();
        }}
        role={role}
        onProjectCreated={handleProjectCreated}
      />
      <SidebarNav items={resolvedItems} onNavigate={onNavigate} />
    </div>
  );
}

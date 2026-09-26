// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project } from "@niveshbook/types";
import { MobileNav } from "./MobileNav";
import type { SidebarNavItem } from "./SidebarNav";

const push = vi.fn();
const mockPathname = "/home";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push }),
}));

const listProjects = vi.fn();
vi.mock("@/lib/projects", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-a",
    name: "Project A",
    description: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const ITEMS: readonly SidebarNavItem[] = [
  { key: "home", label: "Home", icon: <span />, href: "/home", roles: ["owner_admin"] },
];

/**
 * jsdom has no real `matchMedia` -- a minimal stub that records every
 * registered "change" listener per query string, so a test can simulate a
 * viewport crossing a breakpoint by invoking it directly (`MobileNav`'s own
 * `useEffect` calls `window.matchMedia("(min-width: 860px)").addEventListener`).
 */
type ChangeListener = (event: MediaQueryListEvent) => void;
const mediaQueryListeners = new Map<string, Set<ChangeListener>>();

beforeEach(() => {
  push.mockReset();
  listProjects.mockReset().mockResolvedValue([]);
  mediaQueryListeners.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const listeners = new Set<ChangeListener>();
      mediaQueryListeners.set(query, listeners);
      return {
        matches: false,
        media: query,
        addEventListener: (_event: string, listener: ChangeListener) => listeners.add(listener),
        removeEventListener: (_event: string, listener: ChangeListener) => listeners.delete(listener),
      } as unknown as MediaQueryList;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MobileNav (spec-mobile-responsive-phase1-nav-foundation)", () => {
  it("opens the drawer via the hamburger trigger, and closes it via the panel's own close button", async () => {
    render(<MobileNav items={ITEMS} appName="NiveshBook" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the drawer end-to-end when a nav-item link is selected (not just that onNavigate is threaded)", async () => {
    render(<MobileNav items={ITEMS} appName="NiveshBook" />);

    await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = screen.getByRole("dialog");

    await userEvent.click(within(dialog).getByRole("link", { name: "Home" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the drawer end-to-end when 'All Investments' is selected from the Project switcher (a genuine client-side navigation)", async () => {
    listProjects.mockResolvedValue([makeProject()]);
    render(<MobileNav items={ITEMS} appName="NiveshBook" />);

    await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /select a project/i }));
    await userEvent.click(await screen.findByText("All Investments"));

    expect(push).toHaveBeenCalledWith("/all-investments");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the drawer when the viewport crosses back into desktop width (>=860px) while it's open (review finding: rotation/foldable/resize regression)", async () => {
    render(<MobileNav items={ITEMS} appName="NiveshBook" />);

    await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const listeners = mediaQueryListeners.get("(min-width: 860px)");
    expect(listeners?.size).toBeGreaterThan(0);
    act(() => {
      listeners?.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does NOT close an already-closed drawer on a desktop-width media match (no-op, not an error)", async () => {
    render(<MobileNav items={ITEMS} appName="NiveshBook" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const listeners = mediaQueryListeners.get("(min-width: 860px)");
    expect(() => {
      act(() => {
        listeners?.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
      });
    }).not.toThrow();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

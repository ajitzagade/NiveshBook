import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { redirect } from "next/navigation";
import DashboardLayout from "./layout";
import { SidebarShell } from "./SidebarShell";

// `vi.hoisted()` genuinely runs before every `vi.mock()` factory below (unlike
// a plain top-level `const`, which -- despite appearing earlier in this
// file's source -- is NOT yet initialized when "./layout"'s own hoisted
// `import` chain first resolves "@/lib/session-guard" and invokes this
// factory) -- required here because `requireOwnerAdminOrPartnerOrSubPartnerSession`
// is referenced directly in the returned object, evaluated eagerly the
// moment the factory runs (unlike `findUserById` below, which is only read
// inside a nested `() => (...)` closure -- not invoked until a test actually
// calls `DashboardLayout()`, by which point the whole module has finished
// initializing).
const { requireOwnerAdminOrPartnerOrSubPartnerSession } = vi.hoisted(() => ({
  requireOwnerAdminOrPartnerOrSubPartnerSession: vi.fn(),
}));
const findUserById = vi.fn();

vi.mock("@/lib/session-guard", () => ({
  requireOwnerAdminOrPartnerOrSubPartnerSession,
}));

vi.mock("@niveshbook/db", () => ({
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById,
    listAllUsers: vi.fn(),
  }),
}));

vi.mock("@/lib/client-config", () => ({
  getClientConfig: () => ({ branding: { appName: "NiveshBook" } }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

/** Depth-first search for the first element of `type` -- mirrors `home/page.test.tsx`'s own tree-walking `findComponent` precedent, narrowed to "first match" since `layout.tsx` only ever renders one `SidebarShell`. */
function findComponent(node: ReactNode, type: unknown): ReactElement | undefined {
  if (node === null || node === undefined || typeof node !== "object") {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findComponent(child, type);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) {
    return element;
  }
  return findComponent(element.props?.children, type);
}

describe("DashboardLayout (Story 5.5 role-based nav filtering, widened to sub_partner by Story 5.6)", () => {
  beforeEach(() => {
    requireOwnerAdminOrPartnerOrSubPartnerSession
      .mockReset()
      .mockResolvedValue({ id: "session-1", userId: "user-1" });
    findUserById.mockReset();
    (redirect as unknown as Mock).mockClear();
  });

  it("owner_admin: all 10 items render (Story 5.9 adds Audit History), in the existing order", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "owner_admin", active: true });

    const result = await DashboardLayout({ children: <div /> });

    const shell = findComponent(result, SidebarShell);
    const items = (shell?.props as { items: { key: string }[] }).items;
    expect(items.map((item) => item.key)).toEqual([
      "home",
      "projects",
      "partnerShares",
      "addMoney",
      "withdrawMoney",
      "availableBalance",
      "adjustNextTime",
      "moneyHistory",
      "reports",
      "auditHistory",
    ]);
  });

  it("partner: only Home, Adjust Next Time, Money History, and Reports render -- every other item stays hidden", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "partner", active: true });

    const result = await DashboardLayout({ children: <div /> });

    const shell = findComponent(result, SidebarShell);
    const items = (shell?.props as { items: { key: string }[] }).items;
    expect(items.map((item) => item.key)).toEqual(["home", "adjustNextTime", "moneyHistory", "reports"]);
  });

  it("sub_partner (Story 5.6, widened by Story 5.7): only Home, Adjust Next Time, Money History, and Reports render -- identical set to partner's own", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "sub_partner", active: true });

    const result = await DashboardLayout({ children: <div /> });

    const shell = findComponent(result, SidebarShell);
    const items = (shell?.props as { items: { key: string }[] }).items;
    expect(items.map((item) => item.key)).toEqual(["home", "adjustNextTime", "moneyHistory", "reports"]);
  });

  it("Story 5.9: partner and sub_partner sessions never see the Audit History nav item", async () => {
    for (const role of ["partner", "sub_partner"] as const) {
      findUserById.mockResolvedValue({ id: "user-1", role, active: true });

      const result = await DashboardLayout({ children: <div /> });

      const shell = findComponent(result, SidebarShell);
      const items = (shell?.props as { items: { key: string }[] }).items;
      expect(items.some((item) => item.key === "auditHistory")).toBe(false);
    }
  });

  it("Story 5.7: Reports now carries an href (widened from the inert, Owner/Admin-only placeholder)", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "owner_admin", active: true });

    const result = await DashboardLayout({ children: <div /> });

    const shell = findComponent(result, SidebarShell);
    const items = (shell?.props as { items: { key: string; href?: string }[] }).items;
    expect(items.find((item) => item.key === "reports")?.href).toBe("/reports");
  });

  it("redirects to / when the actor's own second lookup can't find them (defense-in-depth, fails closed rather than defaulting to the broader Owner/Admin item set)", async () => {
    findUserById.mockResolvedValue(null);

    await expect(DashboardLayout({ children: <div /> })).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
  });
});

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { redirect } from "next/navigation";
import { ReportTile } from "@niveshbook/ui";
import ReportsPage from "./page";

const findUserById = vi.fn();
// `requireSession` is referenced directly in the "@/lib/session-guard" mock
// factory below, evaluated eagerly the moment that factory runs --
// `vi.hoisted()` genuinely runs before every `vi.mock()` factory, unlike a
// plain top-level `const` (mirrors `home/page.test.tsx`'s/`layout.test.tsx`'s
// identical fix -- this story's known test-harness gotcha).
const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));

vi.mock("@/lib/session-guard", () => ({ requireSession }));

vi.mock("@niveshbook/db", () => ({
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById,
    listAllUsers: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

/** Depth-first search for every element of `type` -- mirrors `layout.test.tsx`'s own tree-walking `findComponent` precedent, widened to "every match" since this page renders one `ReportTile` per visible report. */
function findAllComponents(node: ReactNode, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      findAllComponents(child, type, out);
    }
    return out;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) {
    out.push(element);
  }
  findAllComponents(element.props?.children, type, out);
  return out;
}

describe("ReportsPage (Story 5.7, FR38/FR39 tile grid)", () => {
  beforeEach(() => {
    requireSession.mockReset().mockResolvedValue({ id: "session-1", userId: "user-1" });
    findUserById.mockReset();
    (redirect as unknown as Mock).mockClear();
  });

  it("owner_admin sees all 10 report tiles, including Money Movement", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "owner_admin", active: true });

    const result = await ReportsPage();

    const tiles = findAllComponents(result, ReportTile);
    expect(tiles).toHaveLength(10);
    expect(tiles.map((tile) => (tile.props as { name: string }).name)).toContain("Money Movement");
  });

  it("partner sees 9 tiles -- Money Movement is absent, not disabled/hidden-but-rendered", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "partner", active: true });

    const result = await ReportsPage();

    const tiles = findAllComponents(result, ReportTile);
    expect(tiles).toHaveLength(9);
    expect(tiles.map((tile) => (tile.props as { name: string }).name)).not.toContain("Money Movement");
  });

  it("sub_partner sees 9 tiles -- Money Movement is absent, identical set to partner's own", async () => {
    findUserById.mockResolvedValue({ id: "user-1", role: "sub_partner", active: true });

    const result = await ReportsPage();

    const tiles = findAllComponents(result, ReportTile);
    expect(tiles).toHaveLength(9);
    expect(tiles.map((tile) => (tile.props as { name: string }).name)).not.toContain("Money Movement");
  });

  it("redirects to / when the actor's own second lookup can't find them", async () => {
    findUserById.mockResolvedValue(null);

    await expect(ReportsPage()).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
  });
});

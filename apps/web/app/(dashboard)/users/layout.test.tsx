import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { redirect } from "next/navigation";
import UsersLayout from "./layout";

// `vi.hoisted()` genuinely runs before every `vi.mock()` factory below
// (mirrors `apps/web/app/(dashboard)/projects/layout.test.tsx`'s identical
// fix) -- required since `requireOwnerAdminSession` is referenced directly
// in the returned object, evaluated eagerly the moment this factory runs.
const { requireOwnerAdminSession } = vi.hoisted(() => ({
  requireOwnerAdminSession: vi.fn(),
}));

vi.mock("@/lib/session-guard", () => ({
  requireOwnerAdminSession,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

/**
 * spec-user-creation: mirrors `projects/layout.test.tsx`'s exact scope --
 * proves this nested layout calls the EXISTING, unchanged
 * `requireOwnerAdminSession()` and honors its outcome, with that guard
 * itself fully mocked. Does NOT re-prove the guard's own role logic (already
 * proven independently and in full by `apps/web/lib/session-guard.test.ts`).
 */
describe("UsersLayout (spec-user-creation: Owner/Admin-only gate for /users)", () => {
  beforeEach(() => {
    requireOwnerAdminSession.mockReset();
    (redirect as unknown as Mock).mockClear();
  });

  it("passes through for an owner_admin session (requireOwnerAdminSession resolves normally)", async () => {
    requireOwnerAdminSession.mockResolvedValue({ id: "session-1", userId: "user-1" });

    const result = await UsersLayout({ children: "child-content" });

    expect(result).toBe("child-content");
    expect(requireOwnerAdminSession).toHaveBeenCalledTimes(1);
  });

  it("propagates a redirect when requireOwnerAdminSession() rejects the session (actual role-rejection proof lives in lib/session-guard.test.ts)", async () => {
    requireOwnerAdminSession.mockImplementation(() => {
      redirect("/");
      throw new Error("unreachable");
    });

    await expect(UsersLayout({ children: "child-content" })).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
  });
});

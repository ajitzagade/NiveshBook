import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { redirect } from "next/navigation";
import ProjectsLayout from "./layout";

// `vi.hoisted()` genuinely runs before every `vi.mock()` factory below
// (mirrors `apps/web/app/(dashboard)/layout.test.tsx`'s identical fix) --
// required since `requireOwnerAdminSession` is referenced directly in the
// returned object, evaluated eagerly the moment this factory runs.
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
 * Story 5.5 finding (documented in that story's Implementation Notes):
 * widening the top-level `(dashboard)` layout's own gate to admit
 * `partner` removed the only protection `/projects/**` previously had,
 * since none of those pages call any guard of their own. This nested
 * layout restores it by calling the EXISTING, unchanged
 * `requireOwnerAdminSession()` -- these tests prove it's actually WIRED UP
 * (an owner_admin session passes through untouched; a guard-rejected
 * session propagates its redirect rather than being swallowed), with
 * `requireOwnerAdminSession()` itself fully mocked. They do NOT re-prove
 * that guard's own role logic (that a `partner` role specifically gets
 * rejected) -- that's already proven independently, in full, by
 * `apps/web/lib/session-guard.test.ts`.
 */
describe("ProjectsLayout (Story 5.5 finding: restores pre-existing Owner/Admin-only protection for /projects/**)", () => {
  beforeEach(() => {
    requireOwnerAdminSession.mockReset();
    (redirect as unknown as Mock).mockClear();
  });

  it("passes through for an owner_admin session (requireOwnerAdminSession resolves normally)", async () => {
    requireOwnerAdminSession.mockResolvedValue({ id: "session-1", userId: "user-1" });

    const result = await ProjectsLayout({ children: "child-content" });

    expect(result).toBe("child-content");
    expect(requireOwnerAdminSession).toHaveBeenCalledTimes(1);
  });

  /**
   * Review finding (2026-09-25): this test's ORIGINAL name claimed to prove
   * "a partner session is rejected" -- but `requireOwnerAdminSession()` is
   * fully mocked here, so this test only proves `ProjectsLayout` PROPAGATES
   * whatever that guard decides (redirect-and-rethrow in, thrown redirect
   * out) -- it never actually exercises a partner role. That's a deliberate
   * scope choice (this file's whole job is "does the nested layout call the
   * EXISTING, unchanged guard and honor its outcome," not "does the guard
   * itself correctly reject a partner" -- that's `requireOwnerAdminSession()`'s
   * OWN contract, already proven independently and in full in
   * `apps/web/lib/session-guard.test.ts` ("redirects to / for an
   * authenticated non-owner_admin role", including a `partner` role
   * specifically) -- re-asserting it here would just duplicate that
   * coverage against a second, unnecessary mock of the same guard.
   */
  it("propagates a redirect when requireOwnerAdminSession() rejects the session (the actual partner-rejection proof lives in lib/session-guard.test.ts)", async () => {
    requireOwnerAdminSession.mockImplementation(() => {
      redirect("/");
      throw new Error("unreachable");
    });

    await expect(ProjectsLayout({ children: "child-content" })).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
  });
});

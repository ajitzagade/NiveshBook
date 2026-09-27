import type { ReactNode } from "react";
import { requireOwnerAdminSession } from "@/lib/session-guard";

/**
 * spec-user-creation: Owner/Admin-only gate for the new Users screen,
 * mirroring `projects/layout.tsx`'s exact rationale one subtree over --
 * `users/page.tsx` is a `"use client"` component (it needs interactive
 * Dialog state for the "New User" form) that only talks to REST APIs
 * already gated Owner/Admin-only (`authorizeScope("users:list"/"users:create")`),
 * so without this nested layout a non-owner_admin navigating directly to
 * `/users` would see the full page shell (title, "New User" button) with
 * only an empty/failed data fetch underneath -- no real data leaks (the API
 * still 403s), but this violates the same "never a visible-but-blocked
 * page" rule `projects/layout.tsx` closes for its own subtree.
 *
 * Reuses `requireOwnerAdminSession()` completely unchanged (Open/Closed).
 */
export default async function UsersLayout({ children }: { children: ReactNode }) {
  await requireOwnerAdminSession();
  return children;
}

---
title: 'Self-scoped Project list for the sidebar switcher and Money History filter'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '2ef7871bfc86373788826502f1727e68ca117338'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Partner/Sub-partner login sees an empty "Select a Project" dropdown and an empty Project filter on Money History — both call `GET /api/projects`, which is Owner/Admin-only, so the fetch silently 403s (already logged as deferred-work, not yet fixed). This blocks the founder's core ask: a Partner should be able to see their own Projects and pivot into their own money flow for one of them.

**Approach:** Add a new self-scoped `GET /api/my-projects` (mirrors the already-shipped `GET /api/my-investments` convention exactly: one permission, all 3 roles, scoping computed inside `packages/core` from the actor's role — never inferred from client input). Owner/Admin gets every Project (byte-identical to today's switcher). Partner/Sub-partner gets only Projects where they hold a *current* Partner or Sub-partner Share (case-insensitive `userId` match, mirroring `resolveMoneyHistoryScope`'s exact convention). Both `SidebarShell` and Money History's Project filter switch to this new endpoint. For a Partner/Sub-partner, selecting a Project in the switcher navigates to `/money-history?projectId={id}` — their one already-fully-self-accessible, per-Project view of everything that happened on it (money added/withdrawn, moved between Projects, kept in Available Balance, paid to a person) — instead of the Owner/Admin-only `/projects/{id}/shares` the switcher uses today. Owner/Admin's own switcher navigation is unchanged. Partner Shares/Available Balance/Ownership-Structure page-level self-access are explicitly out of scope (split into separate specs already logged in `deferred-work.md`).

## Boundaries & Constraints

**Always:** Only *current* Partner/Sub-partner Shares count (mirrors every existing self-access convention in this codebase — Money History, My Investments, both Dashboards). `userId` matching is case-insensitive, mirroring `resolveMoneyHistoryScope` byte-for-byte. Owner/Admin's own Project set/behavior stays exactly as today. `authorizeScope()` runs before any data fetch (AD-1).

**Never:** No change to `GET /api/projects`'s own shape, gate, or callers (Projects list/create/edit pages keep using it unchanged). No new page for Partner Shares/Available Balance/Structure self-access — those are separate, already-deferred specs. No `import` (not even `import type`) from `@niveshbook/core` inside any `apps/web/lib/*.ts` "use client"-consumed helper — redeclare the response shape locally, mirroring `apps/web/lib/my-investments.ts`'s established convention (a prior story's own documented client-bundle gotcha).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Admin session | Any | `my-projects` returns every Project — same set the switcher shows today | N/A |
| Partner with 2 current Partner Shares | 2 Projects | Returns exactly those 2 | N/A |
| Sub-partner with 1 current Sub-partner Share | 1 Project | Returns exactly that 1 | N/A |
| Partner/Sub-partner with zero current shares | 0 Projects | Returns `[]` — switcher shows "No Projects yet." (unchanged empty state) | N/A |
| Partner selects a Project in the switcher | Click | Navigates to `/money-history?projectId={id}`, list pre-filtered to that Project | N/A |
| Owner/Admin selects a Project in the switcher | Click | Unchanged — navigates to `/projects/{id}/{segment}` exactly as today | N/A |
| Unauthenticated request to `/api/my-projects` | No session | `401 unauthenticated` | N/A |
| Money History opened directly with `?projectId=X` | Deep link | Project filter pre-applies on load (mirrors existing `traceType`/`traceId` URL-seeding) | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/authorize.ts` — add `"my_projects:list": new Set(["owner_admin", "partner", "sub_partner"])`, mirroring `"my_investments:list"`'s identical entry (line ~328).
- `packages/core/src/my-projects.ts` (new) — `assembleMyProjects(actorRole, actorUserId, allProjects, currentPartnerShares, currentSubPartnerShares): MyProjectSummary[]` where `MyProjectSummary = { id: string; name: string }`. Owner/Admin branch maps `allProjects` unchanged. Partner/Sub-partner branch: filter both share lists by `share.userId?.toLowerCase() === actorUserId.toLowerCase()` (mirror `packages/core/src/money-history.ts`'s `resolveMoneyHistoryScope`, lines ~68-85), collect distinct `projectId`s, map to `{id, name}` via `allProjects`.
- `packages/core/src/index.ts` — barrel-export the new module.
- `apps/web/app/api/my-projects/route.ts` (new) — `GET`, mirrors `apps/web/app/api/my-investments/route.ts`'s exact shape: session check → `authorizeScope(session.userId, "my_projects:list", ...)` → re-fetch actor via `findUserById` for role → fetch `projectPort.listProjects()` + `listAllCurrentPartnerShares()` + `listAllCurrentSubPartnerShares()` → `assembleMyProjects()` → JSON.
- `apps/web/lib/projects.ts` — add `listMyProjects(): Promise<MyProjectSummary[]>` calling `/api/my-projects`; redeclare `MyProjectSummary` locally (no import from `@niveshbook/core`, mirrors `apps/web/lib/my-investments.ts`'s documented convention).
- `apps/web/app/(dashboard)/SidebarShell.tsx` — swap `listProjects()` → `listMyProjects()`; accept a new `role: "owner_admin" | "partner" | "sub_partner"` prop; `selectProject()` branches: `owner_admin` unchanged, else `router.push(\`/money-history?projectId=${projectId}\`)`.
- `apps/web/app/(dashboard)/layout.tsx` — pass the already-resolved `actor.role` to `<SidebarShell>` and `<MobileNav>` (no new lookup — `actor` is already fetched here).
- `apps/web/app/(dashboard)/MobileNav.tsx` — accept + thread the new `role` prop to its own nested `<SidebarShell>` instance.
- `apps/web/app/(dashboard)/money-history/page.tsx` — swap `listProjects()` → `listMyProjects()`; seed `formFilters.projectId`/`appliedFilters.projectId` from `searchParams.get("projectId")` once on mount, mirroring the existing `traceType`/`traceId` read (lines ~133-134).
- `apps/web/app/(dashboard)/ProjectSwitcher.tsx` — narrow the `projects` prop type from `readonly Project[]` to `readonly { id: string; name: string }[]` (it only ever reads `.id`/`.name` — Interface Segregation).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/authorize.ts` + `authorize.test.ts` — new permission, all 3 roles
- [x] `packages/core/src/my-projects.ts` + tests — every I/O matrix row (owner_admin/partner/sub_partner/zero-shares)
- [x] `apps/web/app/api/my-projects/route.ts` + test — auth/scoping wiring
- [x] `apps/web/lib/projects.ts` — `listMyProjects()`
- [x] `apps/web/app/(dashboard)/SidebarShell.tsx` + `layout.tsx` + `MobileNav.tsx` + tests — role threading, switch to `listMyProjects()`, role-branched navigation
- [x] `apps/web/app/(dashboard)/money-history/page.tsx` + test — switch to `listMyProjects()`, `?projectId=` URL-seeding
- [x] `apps/web/app/(dashboard)/ProjectSwitcher.tsx` — narrowed prop type
- [x] Live verification: a real Partner login sees their own Projects in the switcher, selecting one lands on a pre-filtered Money History; Owner/Admin's own switcher/nav unchanged

**Acceptance Criteria:**
- Given a Partner with 2 current Partner Shares, when they open the sidebar switcher, then they see exactly those 2 Projects (never a 403, never every Project in the system)
- Given a Partner selects one of their own Projects in the switcher, when the click resolves, then Money History opens already filtered to that Project
- Given an Owner/Admin session, when they use the switcher, then behavior is byte-identical to before this spec

## Implementation Notes

**Live verification (2026-09-28):** ran against local Postgres. Logged in as a real Partner user (`s510-partner-a@niveshbook.test`, linked via a current Partner Share to "Story 5.10 Verify Project"). Confirmed via `GET /api/my-projects`: Partner session returns exactly their own 1 Project; Owner/Admin session returns all 66. Via Playwright against the real running app: the sidebar switcher now lists "Story 5.10 Verify Project" (previously empty/broken for this role), clicking it navigates to `/money-history?projectId=01a0dc5b-d598-73b6-9660-1e9be7b06ba4`, and the Project filter shows that Project pre-selected. Screenshot confirms the dropdown populated correctly.

## Spec Change Log

## Review Triage Log

3-layer review (blind-hunter, edge-case-hunter, verification-gap), 2026-09-28.

1. **[medium, patch]** `money-history/page.tsx`'s `formFilters.projectId`/`appliedFilters.projectId` seed from `?projectId=` only inside a `useState` lazy initializer, which runs once on first mount. Navigating the switcher to a *second* Project while already sitting on Money History (`router.push` to the same route with a new `projectId`) does not remount the page, so the filter silently keeps showing the previously-selected Project instead of the newly-selected one. Verified: Next.js App Router same-route client navigations re-render with fresh `useSearchParams()` but never re-run `useState`'s lazy initializer. Blind Hunter and Edge Case Hunter both independently found this (same root cause, same location).
2. **[false]** "`assembleMyProjects`'s `actorRole` accepts the full `UserRole` union with no explicit rejection of `project_admin`" / "`SidebarShell`'s role branch could misroute a `project_admin` actor." Disproven: `apps/web/lib/session-guard.ts`'s `requireOwnerAdminOrPartnerOrSubPartnerSession()` (the whole `(dashboard)` layout's own gate) redirects any role other than `owner_admin`/`partner`/`sub_partner` away before `layout.tsx`'s body — and hence `SidebarShell`/`role` — ever runs; separately, `authorizeScope("my_projects:list", ...)` in the API route rejects `project_admin` with 403 before `assembleMyProjects()` is ever called. Both call sites are unreachable by this role in practice. Blind Hunter and Edge Case Hunter both independently raised this.
3. **[false]** `apps/web/next-env.d.ts` diff (`.next/types` → `.next/dev/types`) is unrelated to this feature. Not a defect: `apps/web/AGENTS.md` explicitly documents this file is auto-written by `next dev` and that committing it "keeps the tree clean." Raised by Blind Hunter and Verification Gap.
4. **[low, patch]** `deferred-work.md`'s existing entry ("`SidebarShell.tsx` unconditionally calls `listProjects()`... pointless 'Select a Project' control for `partner`") is exactly the bug this spec fixes, but the diff never marks it resolved — misleads a future reader into thinking it's still open. This file's own established convention (see earlier entries) is to strike through and annotate `**Resolved by Story X**` rather than delete.
5. **[low, patch]** `ProjectSwitcher.tsx`'s narrowed prop is an inline `{ id: string; name: string }[]` literal instead of `import type { MyProjectSummary } from "@/lib/projects"` — the same shape hand-duplicated a 3rd time (core, `lib/projects.ts`, and here). Verified safe to import: `@/lib/projects` is a plain `apps/web` file, not `@niveshbook/core`, so the client-bundle gotcha this spec's own Boundaries warns about doesn't apply here.
6. **[low, patch]** `packages/core/src/my-projects.test.ts`'s "zero current shares" test has a stray over-indented closing `);` (line 112, 6 spaces vs. the file's consistent 4).
7. **[low, patch]** `apps/web/app/api/my-projects/route.test.ts`'s 403-for-`project_admin` test only asserts `listProjects` wasn't called, not `partnerSharesListAll`/`subPartnerSharesListAll` — AD-1 ("no data touched before authorize") is only partially verified by that test, even though the route code itself already gets this right.
8. **[false]** "Selecting a Project could push an un-encoded, URL-reserved character into `/money-history?projectId=...`." Disproven: `projectId` here is always one of `assembleMyProjects()`'s own `Project.id` values — a UUID(v7), per this codebase's schema/port convention everywhere else verified this session — never free text; the triggering condition cannot occur.
9. **[defer]** Deactivated-actor edge case at `/api/my-projects` was flagged as untested. Disproven as a gap specific to this spec: Story 1.6 already deletes every session row on `active: true → false`, so a deactivated actor's `getSession()` already 401s before this route's `authorizeScope` ever runs — a system-wide, already-tested invariant, not something this route needs to re-verify.
10. **[defer]** `route.ts` re-fetches the actor via a second `findUserById()` after `authorizeScope()`'s own internal lookup (a theoretical role-change-mid-request race, and a redundant DB round-trip). Verified pre-existing: byte-for-byte the same two-step pattern `my-investments/route.ts` already uses, unchanged by this spec.
11. **[defer]** `listMyProjects()`'s `{ projects: [...] }` response-unwrap is never exercised by a real `fetch`-mocked test — every consumer test substitutes a `vi.fn()` for the whole function, so a regression in the unwrap logic would ship undetected by the full suite. Pre-verified by Verification Gap (cites exact call sites/mocks). Real gap, but matches this codebase's existing, pervasive convention: no helper in `apps/web/lib/projects.ts` has a dedicated fetch-level test today; fixing it here alone would be an inconsistent one-off rather than a deliberate testing-convention change.
12. **[low, rejected]** Partner/sub-partner branch's result order (`Set` insertion order across two share arrays) isn't guaranteed to match `allProjects`' order, and isn't pinned by a test. Rejected: no ordering requirement exists anywhere in this spec's I/O matrix or elsewhere in the codebase for "my own Projects" lists; unlikely to be noticed, and the fix would mean inventing an unspecified canonical sort key.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `my-projects.test.ts` covers every I/O matrix row; `authorize.test.ts` covers the new permission
- `pnpm --filter @niveshbook/web test` — expected: route test, `SidebarShell`/`layout`/`MobileNav` role-threading tests, Money History URL-seeding test
- `pnpm lint` / `pnpm typecheck` / `pnpm build` — expected: clean

**Manual checks:**
- Log in as a real Partner user linked to 1+ Projects: confirm the switcher lists exactly their own Projects, selecting one opens Money History pre-filtered to it, and Owner/Admin's own login is completely unaffected.

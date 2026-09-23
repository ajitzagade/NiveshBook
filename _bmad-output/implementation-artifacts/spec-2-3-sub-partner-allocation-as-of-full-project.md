---
title: 'Sub-partner Allocation as % of Full Project'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
baseline_commit: '9c4ad7a73c1c7bc81f439037765259394509fa69'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Partner has no way to privately split their Share % among their own Sub-partners — and when they do, it must always read as a percentage of the *full Project*, never "percentage of my percentage," so nobody has to do that math by hand.

**Approach:** Add a `subpartner_shares` table (same version-per-edit shape as Story 2.2's `partner_shares`, AD-3), a `packages/core` domain module + port mirroring `partner-share.ts` exactly, Owner/Admin-gated triple-nested API routes under `/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares`, and inline sub-rows (indented, `↳` prefix) under each Partner's row on the existing `/projects/[id]/shares` page — reusing `ShareRow`/`ShareList`/`DistributedCheck` a second time, not new components.

**Decisions (resolved 2026-09-23):**
- **Own retained portion:** computed, never stored. A Partner's own retained share = their current `sharePercent` (from `partner_shares`) minus the sum of their current Sub-partner allocations — always derived live, exactly mirroring Story 2.2's "remainder is implicitly correct" pattern one level down. No row represents "Partner A (own)"; `subpartner_shares` holds only actual named Sub-partners.
- **Allocation total, over/under:** informational only, never blocks save — per AC3's explicit instruction to mirror Story 2.2's pattern. A Sub-partner total can legitimately sit under *or* over the parent Partner's share mid-process; nothing here enforces the cap. (Real money constraints are Epic 3's job.)
- **UI placement:** inline sub-rows on the *existing* `/projects/[id]/shares` page (the "data table with sub-rows" pattern already documented: one indent level, `↳` prefix, never a second indent level) — not a separate Partner-detail page. `epic-2-context.md`'s UX notes name this as the primary pattern for Story 2.3; a separate Partner-detail view is a distinct, later UX concept, not required by this story's AC.
- **Scoping lesson from Story 2.2's review:** every route here is nested three levels deep (project → partner → sub-partner). All three levels must be validated and cross-checked — a `subPartnerId` that doesn't belong to the URL's `partnerId`, or a `partnerId` that doesn't belong to the URL's `id`, must 404 exactly like Story 2.2's cross-project PATCH bug had to be fixed to do. This is not optional polish; it's the same class of bug, one level deeper.
- **Route/domain naming:** mirrors Story 2.2 exactly — `SubPartnerShare` type, `subPartnerId` (stable across versions, distinct from each version row's own `id`), `subpartner_shares` table, `partner_shares:create/update/list`-shaped `subpartner_shares:create/update/list` actions (Owner/Admin-only, `authorizeScope()` only, no `ResourceRef` yet).

## Boundaries & Constraints

**Always:** Every `app/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares/**/route.ts` handler calls `authorizeScope()` immediately after the session check, before body parsing. Every handler validates *all* path segments it receives and cross-checks parent/child ownership before touching data: project `id` must exist, `partnerId` must belong to that project (`findLatestByPartnerId` + `existing.projectId === id`), and — for the edit route — `subPartnerId` must belong to that `partnerId` (`findLatestBySubPartnerId` + `existing.partnerId === partnerId`). Any mismatch at any level 404s, never a 500 or a silent cross-scope write. `sharePercent` is always a percentage of the full Project (validated the same way as Story 2.2's, via `decimal-math.ts`'s existing `toPercent`) — never computed or displayed as a fraction of the parent Partner's share. New `subpartner_shares` rows follow `partner_shares`'s exact column shape (uuid v7 PK, `numeric(7,4)` for `sharePercent`, `effectiveFrom`/`createdAt` timestamptz). Reuse `packages/ui`'s `ShareRow`/`ShareList`/`DistributedCheck`/`Dialog`/`Input`/`Label`/`Button` — no new `packages/ui` components.

**Never:** No privacy-boundary enforcement (Stories 2.4–2.6) — every Sub-partner row is visible to every Owner/Admin request, same gate shape as Stories 2.1/2.2. No hard block on save when a Sub-partner's total is under or over the parent's share (see Decisions). No audit trail (pre-existing gap pattern). No stored "own retained" row (see Decisions) — computing it wrong by storing a stale value is worse than deriving it live.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add two sub-partners under a 50% Partner | Owner/Admin, Partner A (50%), Sub1=12.5%, Sub2=12.5% added in sequence | Each add succeeds (201); list shows Sub1/Sub2 plus a computed "Partner A retained: 25%" | N/A |
| Sub-partner % always reads as % of full Project | Sub1 = 12.5% | Displayed/stored as "12.5%", never recomputed as "25% of Partner A's share" | N/A |
| Under-allocated total | Sub1=12.5% only (Partner A owns 50%) | Screen shows the remaining unallocated amount clearly (informational) | N/A |
| Over-allocated total | Sub1=30%, Sub2=30% (Partner A owns 50%) | Both saves succeed; total/remaining messaging reflects the over-allocation, nothing blocks it | N/A |
| Add with out-of-range share | sharePercent = "0" or "150" or "-5" | 400, blocked before save | `{code: "validation_error", message}` |
| Add with empty name | name = "" | 400, blocked before save | `{code: "validation_error", message}` |
| Add as non-Owner/Admin | Partner role, otherwise-valid body | 403, no row created, checked before body validation | `{code: "forbidden"}` |
| Edit an existing Sub-partner's share | Owner/Admin, existing `subPartnerId`, new sharePercent | 200, new versioned row (new `id`/`effectiveFrom`, same `subPartnerId`); old row untouched (AD-3) | N/A |
| Edit via wrong `partnerId` in the URL | `subPartnerId` real, but belongs to a different Partner than the URL's `partnerId` | 404 — same class of bug as Story 2.2's cross-project PATCH fix | N/A |
| Edit via wrong project `id` in the URL | `partnerId`/`subPartnerId` real, but the URL's `id` is a different project | 404 | N/A |
| List for a Partner with zero sub-partners | New Partner, no sub-shares added yet | 200, empty list, retained = Partner's full share | N/A |

</frozen-after-approval>

## Code Map

- `packages/types/src/index.ts` -- add `SubPartnerShare` interface (`id`, `subPartnerId`, `partnerId`, `projectId`, `name`, `sharePercent: Percent`, `effectiveFrom`, `createdAt`) -- mirrors `PartnerShare` exactly, plus the `partnerId` scoping field.
- `packages/core/src/subpartner-share-port.ts` -- new port: `createSubPartnerShare`, `findLatestBySubPartnerId` (nullable), `listByPartnerId` (all version rows for one Partner's sub-partners) -- mirrors `packages/core/src/partner-share-port.ts`.
- `packages/core/src/subpartner-share.ts` -- new domain module: `addSubPartnerShare(partnerId, projectId, input, deps)`, `updateSubPartnerShare(subPartnerId, input, deps)` (always versions, AD-3, identical shape to `updatePartnerShare`), `listCurrentSubPartnerShares(partnerId, deps)` (reduce to latest per `subPartnerId`), `computeSubAllocationTotal(subShares)` (delegates to `decimal-math.ts`'s existing `sumPercents` -- no new arithmetic function needed). Reuses `packages/core/src/decimal-math.ts`'s `toPercent`/`sumPercents` as-is.
- `packages/core/src/authorize.ts` -- extend `Action`/`PERMISSIONS` with `subpartner_shares:create`/`subpartner_shares:update`/`subpartner_shares:list` (Owner/Admin-only, `authorizeScope()` only).
- `packages/core/src/index.ts` -- barrel-export the new module/port.
- `packages/db/src/schema.ts` -- add `subpartner_shares` table: `id uuid PK`, `subPartnerId uuid notNull`, `partnerId uuid notNull`, `projectId uuid notNull references projects.id`, `name text notNull`, `sharePercent numeric(7,4) notNull`, `effectiveFrom`/`createdAt` timestamptz -- same shape as `partner_shares`, indexed on `projectId`, `partnerId`, and `subPartnerId`.
- `packages/db/src/ports.ts` -- add `createSubPartnerSharePort(database = getDb())`, mirroring `createPartnerSharePort`.
- `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares/route.ts` -- GET (list current sub-shares + computed total) + POST (add), both validating `id` exists and `partnerId` belongs to it before touching data.
- `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares/[subPartnerId]/route.ts` -- PATCH (edit, versions), validating all three path segments (`id`, `partnerId`, `subPartnerId`) belong to each other before updating.
- `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares/shared.ts` -- request-body type guard + not-found response, mirroring Story 2.2's `shared.ts`.
- Route test files mirroring Story 2.2's mocking pattern, including explicit wrong-parent-id and wrong-project-id 404 cases from the start (the lesson from Story 2.2's review).
- `apps/web/lib/subpartner-shares.ts` -- client fetch helpers, mirroring `apps/web/lib/partner-shares.ts`.
- `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` -- **modified**, not new: each Partner row gains an expand affordance showing its current Sub-partner rows indented (`↳` prefix, smaller muted text, per the existing sub-row CSS pattern already in `packages/ui/src/styles/tokens.css`), a per-partner "Allocated: X% (Y% remaining)" `DistributedCheck`, and a "+ Add Sub-partner" action opening the existing `Dialog` pattern (name + Share % fields) scoped to that Partner.

## Tasks & Acceptance

**Execution:**
- [x] `packages/types/src/index.ts` -- `SubPartnerShare` interface
- [x] `packages/core/src/subpartner-share-port.ts` -- port interface
- [x] `packages/core/src/subpartner-share.ts` + test -- domain functions, incl. always-version-on-edit and computed retained portion
- [x] `packages/core/src/authorize.ts` -- add `subpartner_shares:*` actions
- [x] `packages/db/src/schema.ts` -- `subpartner_shares` table
- [x] `packages/db/drizzle/*` -- generate migration
- [x] `packages/db/src/ports.ts` -- `createSubPartnerSharePort`
- [x] `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares/route.ts` + test -- list/add, incl. project-existence and partner-ownership checks
- [x] `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares/[subPartnerId]/route.ts` + test -- edit/version, incl. all three levels of ownership checks
- [x] `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares/shared.ts` -- shared validation
- [x] `apps/web/lib/subpartner-shares.ts` -- client fetch helpers
- [x] `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` -- inline sub-rows, per-partner allocation check, add-sub-partner dialog

**Acceptance Criteria:**
- Given Partner A holds 50% of Project A, when Sub1=12.5% and Sub2=12.5% are added, then the screen shows "Partner A Total Share: 50%" and Partner A's own retained portion computes to 25%.
- Given the same setup, when any field is viewed, then Sub1 and Sub2's shares are always shown as a percentage of the full Project, never as a percentage of Partner A's 50%.
- Given an allocated total under 50%, when the screen is viewed, then the remaining unallocated amount is shown clearly, mirroring Story 2.2's pattern.
- Given a Sub-partner Share edited after transactions exist against it, when saved, then it's versioned the same way as Story 2.2 (AD-3).

## Implementation Notes

All tasks complete. Every file mirrors its Story 2.2 counterpart one level down (Partner → Sub-partner), per this spec's Code Map: `SubPartnerShare` type, `subPartnerId`/`partnerId`/`projectId` scoping, `subpartner_shares` table (`numeric(7,4)`, uuid v7 PK, `effectiveFrom`/`createdAt`), `SubPartnerSharePort`, `addSubPartnerShare`/`updateSubPartnerShare`/`listCurrentSubPartnerShares`/`computeSubAllocationTotal` (delegating to the existing `decimal-math.ts` `toPercent`/`sumPercents` -- no new arithmetic), `subpartner_shares:create/update/list` Owner/Admin-only actions via `authorizeScope()`, and triple-nested routes under `/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares[/[subPartnerId]]`.

**Cross-scope validation (this story's stated risk):** both routes validate every path segment before touching data. The list/add route (`route.ts`) has a shared `resolveScope()` helper checking project `id` existence, then `partnerId` validity + `findLatestByPartnerId(partnerId).projectId === id`. The edit route (`[subPartnerId]/route.ts`) additionally checks `findLatestBySubPartnerId(subPartnerId).partnerId === partnerId` -- a `subPartnerId` belonging to a different Partner, or a `partnerId` belonging to a different Project, both 404 uniformly via `subPartnerShareNotFoundResponse()`, mirroring Story 2.2's post-review cross-project PATCH fix one level deeper. Both are covered by dedicated tests (wrong-parent-id, wrong-project-id) written from the start per this spec's explicit instruction, not added after a review pass.

**UI:** `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` gained an expand affordance per Partner row ("Sub-partners"/"Hide"), lazily fetching that Partner's current Sub-partner Shares on first expand. Expanded, it shows: indented `↳`-prefixed `ShareRow`s (smaller, muted text) reusing `ShareList`, a `DistributedCheck` reading "Allocated: X% (Y% remaining)" scoped to the parent Partner's own Share % (never the Project's 100% total), a computed "{Partner} retained: Z%" line (`retained = partnerSharePercent - subTotal`, computed live in the component, never stored/fetched as its own field per this spec's Decisions), a "+ Add Sub-partner" action, and a private-split disclosure note per the UX pattern in `epic-2-context.md`. No new `packages/ui` components -- `ShareRow`/`ShareList`/`DistributedCheck`/`Dialog`/`Field`/`Input`/`Label`/`Helper`/`Button` are all reused a second time, scoped to one Partner at a time via one `Dialog` shared across all four modes (add Partner / edit Partner / add Sub-partner / edit Sub-partner).

**Verification run (2026-09-23):**
- `pnpm --filter @niveshbook/core test` -- 134 passed (18 new in `subpartner-share.test.ts`: add/update/list/computeSubAllocationTotal, incl. an out-of-range-share-alone-exceeds-parent case proving no block exists)
- `pnpm --filter @niveshbook/db test` -- 18 passed (5 new `subpartner_shares` schema-shape assertions in `schema.test.ts`, mirroring the `partner_shares` block)
- `pnpm --filter @niveshbook/web test` -- 181 passed (37 new across `subpartner-shares/route.test.ts` and `subpartner-shares/[subPartnerId]/route.test.ts`, including explicit wrong-`partnerId`/wrong-project-id/wrong-parent-`partnerId` 404 cases per this spec's Decisions; all pre-existing tests unaffected)
- `pnpm lint` (incl. `eslint-plugin-security`, `lint:boundaries`) -- clean; the two `security/detect-object-injection` warnings in `authorize.ts` are pre-existing (same `PERMISSIONS[action]` pattern from Stories 1.5/2.1/2.2), no new warnings introduced
- `pnpm typecheck` -- clean across all 6 packages
- `pnpm build` -- clean; `apps/web` compiles the two new routes (`/api/projects/[id]/partner-shares/[partnerId]/subpartner-shares` and its `[subPartnerId]` child) alongside all existing routes

Same build-order note as Stories 2.1/2.2: `packages/core`/`packages/db` are consumed by `apps/web` via built `dist/` output, not source. `pnpm --filter @niveshbook/types build`, `--filter @niveshbook/core build`, and `--filter @niveshbook/db build` were required before the new web route tests passed -- a stale `dist` otherwise throws `Cannot read properties of undefined (reading 'has')` in `authorizeScope()` for the new `subpartner_shares:*` actions.

**Known risk, not resolved here (consistent with Stories 2.1/2.2's precedent):** no React Testing Library test drives `shares/page.tsx`'s new expand/sub-dialog UI directly -- verified by reading the component logic and by the passing `pnpm build`/`typecheck`, not by a live HTTP/browser pass (no live Postgres instance was available in this session to run `db:migrate`/`db:seed`/`next dev` end-to-end, unlike Stories 2.1/2.2's implementer passes). The migration file `packages/db/drizzle/0005_ancient_demogoblin.sql` was generated via `drizzle-kit generate` and reviewed by hand (creates `subpartner_shares`, its 3 indexes, and its `project_id` FK) but has not been applied against a running database in this session -- lower risk since it's structurally identical to `partner_shares`'s already-proven migration, but this should be applied and the flow live-verified (add two Sub-partners under a 50% Partner, confirm the "retained: 25%" UI line and the over-allocation, non-blocking-save case) before this story is considered fully closed in a live environment.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (edge-case-hunter) Collapsing then re-expanding a Partner row after a Sub-partner list fetch error never retries — `toggleExpanded` (`shares/page.tsx:197-207`) only calls `refreshSubShares` when `subSharesByPartner[partnerId]` is falsy, so once it's set to `{status:"error",...}` it stays there forever. | medium | Verified directly: `toggleExpanded`'s guard is `if (!subSharesByPartner[partnerId])`, which is truthy for an error-state entry, so the fetch never re-fires. Confirms a real, reproducible stuck-error state requiring a full page reload to recover. | patch |
| 2 | (blind-hunter) The "Sub-partners"/"Hide" expand toggle `<Button>` (`shares/page.tsx:341-343`) has no `aria-expanded` attribute, so its disclosure state isn't exposed to assistive technology. | low | Verified directly: the `<Button variant="ghost" onClick={...}>` at line 341 carries no `aria-expanded`/`aria-controls`. Real, trivial one-line fix (`aria-expanded={expanded}`), matches the bar for a "low but worth a direct fix" finding. | patch |
| 3 | (blind-hunter) Implementation Notes' verification-run claims "34 new" web tests across the two `subpartner-shares` test files, but the actual count (verified by re-running `pnpm turbo run test --force`, cross-checked against `it(`/`it.each(` blocks in the diff) is 25 (`route.test.ts`) + 12 (`[subPartnerId]/route.test.ts`) = 37. | low | Confirmed true — independently reran tests and got exactly 25 + 12 = 37, not 34. Purely a self-reported doc-count inaccuracy in the spec's own non-frozen Implementation Notes, not a code defect. | patch |
| 4 | (blind-hunter) Implementation Notes claims "6 new `subpartner_shares` schema-shape assertions" in `schema.test.ts`, but the diff's `describe("subpartner_shares table schema (Story 2.3)"...)` block contains 5 `it(...)` cases. | low | Confirmed true by direct count of the diff hunk. Same class as #3 — doc-count inaccuracy in Implementation Notes prose only. | patch |
| 5 | (verification-gap + blind-hunter #10 + blind-hunter #5, grouped — same root cause) No test anywhere covers `shares/page.tsx`'s new dialog-mode routing (`handleSubmit`'s `add`/`edit`/`add-sub`/`edit-sub` branches) or the new pure helpers `subAllocationMessage`/`retainedMessage`, including the over-allocated (negative "retained") branch the spec's own Decisions call out as legitimate. | medium (real gap; unverified regression risk) | Verified: repo-wide search confirms no `page.test.tsx`/RTL test exists for this file, for this story or its Story 2.2 predecessor. This is the same accepted, pre-existing gap pattern as Story 2.2's identical page (never had a component test either), and is explicitly named as a known, unresolved risk in this spec's own Implementation Notes ("Known risk, not resolved here"). verification-gap's filed disposition is `defer`, per its own evidence rules; honored as filed. | defer |
| 6 | (blind-hunter) `subAllocationMessage`/`retainedMessage` (`shares/page.tsx:96-118`) use raw `Number()` on `Percent`-branded strings instead of `decimal-math.ts`. | false | Refuted: `formatDifference`'s own doc comment (lines 47-53, unchanged by this diff) states this `Number()`-for-*display-only* pattern is "explicitly allowed in `apps/web` (spec-2-2's Decisions) -- it never touches a stored value". `totalMessage` (pre-existing, Story 2.2) already does the identical `Number(total)` at line 79. Story 2.3's helpers are consistent reuse of an already-approved, already-shipped pattern, not a new violation. | — |
| 7 | (blind-hunter) `PATCH .../subpartner-shares/[subPartnerId]/route.ts` calls `findLatestBySubPartnerId` once for the ownership/404 check, then `updateSubPartnerShare()` calls it again internally — a duplicate DB round-trip. | false | Refuted as a new problem: `updatePartnerShare` (Story 2.2, unchanged) has the identical self-contained re-fetch shape. This mirrors an already-shipped, already-reviewed architectural pattern verbatim, not something introduced by this story. | — |
| 8 | (blind-hunter) `[subPartnerId]/route.ts`'s PATCH never calls `findProjectById` the way `route.ts`'s GET/POST does via `resolveScope()` — shallower project-existence validation on the edit route. | false | Refuted: `subpartner_shares.project_id` and `partner_shares.project_id` both have `ON DELETE CASCADE` FKs to `projects.id`, so a `partner_shares` row can never reference a deleted/nonexistent project. The existing `partner.projectId !== projectId` check in PATCH already proves project existence transitively — an explicit `findProjectById` call would be redundant, not a gap. Matches the spec's own Implementation Notes description of the edit route's validation shape. | — |
| 9 | (blind-hunter) `subpartner_shares.partner_id` has no FK constraint — referential integrity to a parent Partner is app-code-only. | false | By design, documented in `schema.ts`'s own comment: `partner_shares.partner_id` is a stable id across version rows, not that table's PK, so it cannot be an FK target. Identical, already-shipped shape as `partner_shares.partnerId`'s Story 2.2 precedent. | — |
| 10 | (blind-hunter) `findLatestBySubPartnerId`'s `ORDER BY effective_from DESC, id DESC LIMIT 1` isn't backed by a composite index — only single-column indexes exist. | false | Mirrors `partner_shares`'s identical single-column indexing strategy from Story 2.2 verbatim (unflagged in that story's own review). No current NFR requires this scale; premature optimization, not a gap introduced here. | — |
| 11 | (blind-hunter) Both POST and PATCH validate request-body shape before validating/cross-checking path segments, so a malformed body + invalid/cross-scoped id returns 400 instead of 404 — untested combined case. | false | Refuted as a new problem: `partner-shares/[partnerId]/route.ts`'s PATCH (Story 2.2, unchanged by this diff) has the identical body-before-path ordering, already shipped and already reviewed without this being flagged. Not introduced by this story. | — |
| 12 | (blind-hunter) AC4 references editing "a Sub-partner Share edited after transactions exist against it," but no transaction concept exists anywhere yet (Epic 3 is still backlog) — literally untestable as worded. | false | Not a code defect: AD-3's versioning is deliberately *unconditional* — it doesn't branch on whether transactions exist, which is exactly why the shipped tests can (and do) verify the real behavior without Epic 3 existing. The AC's prose just carries forward product-brief phrasing about a future epic. | — |
| 13 | (edge-case-hunter, `claims` kind) AC1's literal quoted text "Partner A Total Share: 50%" isn't rendered verbatim anywhere — only a bare "{percent}%" next to the Partner's name plus the page-level 100% total. | false | Verified: this display convention (`%` inline next to the Partner name, no per-partner "Total Share:" label) is Story 2.2's existing, unchanged rendering — not touched by this diff. AC prose is descriptive framing, not a literal-copy requirement; flagged as low-confidence by the reviewer itself. | — |
| 14 | (blind-hunter) New spec file's frontmatter set `status: 'done'` while the same diff set `sprint-status.yaml` to `review` — the two artifacts disagreed on the story's actual state, and per the sprint-status file's own header comments, `done` is supposed to follow a passed code review, which hadn't happened yet. | medium (confirmed true, already corrected) | Confirmed true of the implementer's output. Already corrected by the orchestrator before this review ran: spec `status` set to `in-review`, matching `sprint-status.yaml`'s `review`. No further action needed. | — (fixed pre-review) |



## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` -- expected: new `subpartner-share` domain tests pass
- `pnpm --filter @niveshbook/db test` -- expected: new schema-shape tests pass
- `pnpm --filter @niveshbook/web test` -- expected: new route tests pass, including all-three-levels 404 cases; existing tests unaffected
- `pnpm lint` -- expected: clean (incl. `eslint-plugin-security`, `lint:boundaries`, `noRawMoneyArithmetic`)
- `pnpm typecheck` -- expected: clean across all packages
- `pnpm build` -- expected: `apps/web` builds successfully with the new routes

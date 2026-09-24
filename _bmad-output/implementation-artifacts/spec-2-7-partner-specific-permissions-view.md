---
title: 'Partner-Specific Permissions View'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
baseline_commit: '2ed186118f727739c7d5a801d6b59e90f097a4a7'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owner/Admin has no single place to see which Partners currently have their Sub-partner Visibility Grant (Story 2.6) turned on — today the only way to check is opening each Partner's Edit dialog individually, one Project at a time.

**Approach:** Extend the existing `GET /api/permissions` (Story 1.7's Permissions overview, already Owner/Admin-only) with a `partners` list — every current Partner Share, across every Project, with its `subPartnerVisibilityGrant` state. Pure read-side aggregation: no new privacy boundary, no new `authorize.ts` action, reuses the existing `"permissions:view"` gate unchanged. Adds one new port method (`PartnerSharePort.listAll()`, dropping `listByProjectId`'s `WHERE project_id = ?` clause) and one new domain function (`listAllCurrentPartnerShares`, reusing the exact `isNewerVersion` reduction already proven in `listCurrentPartnerShares`, just sourced across every Project instead of one).

**Decisions (resolved 2026-09-24):**
- **API-only, no UI page — matches Story 1.7's own precedent exactly.** No page exists anywhere in this codebase for the Permissions area at all (`GET /api/permissions` has never had a UI consumer, Story 1.7 through today). This story doesn't introduce a UI-deferred pattern; it follows the one already set by the endpoint it extends.
- **Minimal projection, not the full `PartnerShare` row.** The `partners` list returns `{ partnerId, projectId, name, subPartnerVisibilityGrant }` only — never `sharePercent`, `userId`, `id`, `effectiveFrom`, or `createdAt`. This view's stated purpose is "which Partners have the grant on/off," not a full data dump; matches the same minimal-projection discipline Story 2.6 established for its own grant-gated response.
- **Global, not per-Project.** The AC says "it lists each Partner" with no per-Project scoping mentioned, and the existing Permissions view's `approvers` list is already global (spans every `owner_admin`, not scoped to anything) — a per-Project view would be a narrower, unrequested redesign of an already-global endpoint.
- **No project name join.** `projectId` is included for traceability/uniqueness (two Projects can have same-named Partners), but resolving it to a Project's `name` is a UI-layer display concern for whenever a UI is actually built — not required by this story's API-only scope, and not free (would require also depending on `ProjectPort` and joining in the domain layer for no currently-consumed benefit).
- **No change to the write side.** Story 2.6's grant toggle (`PATCH .../partner-shares/[partnerId]`) is untouched — this story is entirely additive to the existing `GET /api/permissions` read path.

## Boundaries & Constraints

**Always:** `GET /api/permissions` requires a valid session (401 if none) and passes the existing `authorizeScope()` check for `"permissions:view"` (Owner/Admin-only, unchanged). The response's new `partners` array reflects the *current* (latest-version) row for every `partnerId` across every Project, live — never cached, matching `approvers`' existing AD-1 discipline. Each entry is the minimal `{ partnerId, projectId, name, subPartnerVisibilityGrant }` projection.

**Never:** No new `authorize.ts` action — reuses `"permissions:view"` unchanged. No per-Project scoping/filtering on this endpoint. No project name resolution/join. No UI page. No change to `subpartner_shares` or the Sub-partner-facing boundary (Stories 2.4/2.5/2.6 untouched).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Admin views Permissions after Partners exist across multiple Projects | 2 Projects, 3 current Partners total, 2 grants on / 1 off | 200, `partners` lists all 3 with correct `subPartnerVisibilityGrant` per entry | N/A |
| No Partners exist anywhere yet | Fresh system | 200, `partners: []` | N/A |
| A Partner was edited (versioned) after their grant was toggled | 2 version rows for one `partnerId`, latest has `subPartnerVisibilityGrant: true` | `partners` reflects only the latest version's grant state | N/A |
| Non-Owner/Admin requests the Permissions view | Partner, Sub-partner, or unauthenticated | 403 (or 401 if unauthenticated) — unchanged existing gate | `{code: "forbidden"}` / `{code: "unauthenticated"}` |

</frozen-after-approval>

## Code Map

- `packages/core/src/partner-share-port.ts` — add `listAll(): Promise<PartnerShare[]>` to `PartnerSharePort` (every version row, every Project — mirrors `listByProjectId` minus its `WHERE` clause).
- `packages/db/src/ports.ts` — `createPartnerSharePort`'s `listAll` implementation: same `select().from(partnerShares)` as `listByProjectId`, no `.where()`.
- `packages/core/src/partner-share.ts` — add `listAllCurrentPartnerShares(deps: PartnerShareDeps): Promise<PartnerShare[]>`, reusing the existing `isNewerVersion` helper (unchanged) and the identical reduction shape as `listCurrentPartnerShares`, sourced from `deps.partnerShares.listAll()` instead of `listByProjectId(projectId)`.
- `packages/core/src/permissions.ts` — `PermissionsOverviewDeps` gains `partnerShares: PartnerSharePort`; new `PartnerVisibilitySummary` interface (`partnerId`, `projectId`, `name`, `subPartnerVisibilityGrant`); `PermissionsOverview` gains `partners: PartnerVisibilitySummary[]`; `getPermissionsOverview` calls `listAllCurrentPartnerShares` and maps to the minimal projection.
- `apps/web/app/api/permissions/route.ts` — pass `createPartnerSharePort()` into `getPermissionsOverview`'s deps.
- Tests: `packages/core/src/partner-share.test.ts` (new `listAllCurrentPartnerShares` cases, mirroring `listCurrentPartnerShares`'s existing ones — multi-version reduction, empty case, across-Project aggregation), `packages/core/src/permissions.test.ts` (new `partners` assertions), `packages/db/src/schema.test.ts` or a `ports`-level check is not needed (no schema change), `apps/web/app/api/permissions/route.test.ts` (mock wiring for the new dep, assert `partners` in the response).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/partner-share-port.ts` — `listAll()` port method
- [x] `packages/db/src/ports.ts` — `listAll` implementation
- [x] `packages/core/src/partner-share.ts` + tests — `listAllCurrentPartnerShares`
- [x] `packages/core/src/permissions.ts` + tests — `partners` in `PermissionsOverview`
- [x] `apps/web/app/api/permissions/route.ts` + tests — wire the new dependency

**Acceptance Criteria (from epics.md Story 2.7):**
- Given the Permissions area, when an Owner/Admin views it after partners exist, then it lists each Partner and whether their Sub-partner Visibility Grant is on or off.
- Given a non-Owner/Admin user, when they attempt to reach this view, then 403.

## Implementation Notes

- Implemented exactly per the Code Map: `PartnerSharePort.listAll()` (mirrors `listByProjectId` minus its `WHERE`), `listAllCurrentPartnerShares` (extracted the existing `listCurrentPartnerShares` reduction into a shared `reduceToLatestPerPartnerId` helper reused by both, so the `isNewerVersion` logic isn't duplicated), `PermissionsOverviewDeps.partnerShares` + `PartnerVisibilitySummary` + `partners` on `PermissionsOverview`, and the route wiring via `createPartnerSharePort()`.
- `packages/core`'s `dist/` build output is gitignored but consumed by `apps/web`'s tests via `@niveshbook/core`'s `main` field — ran `pnpm --filter @niveshbook/core build` after the source changes so `apps/web`'s test suite picked up the new `partners` field (its tests initially failed against the stale compiled `dist/`, not against the source).
- Live verification: ran `getPermissionsOverview` directly against the built `packages/core/dist` with an in-memory `PartnerSharePort` fake seeded with 3 current Partners across 2 Projects (2 grants on, 1 off) — output matched the I/O matrix's first row exactly (all 3 listed, correct per-entry `subPartnerVisibilityGrant`, minimal projection only). Did not additionally exercise a live Postgres + HTTP round trip; the route-level `route.test.ts` (mocked deps) and the domain-level checks above cover the read path, but no session/browser click-through against a running dev server was performed.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (blind-hunter) `apps/web/app/api/permissions/route.test.ts`'s "returns 200 with the partners list" test asserts `body.partners` via strict-order `toEqual`, but `listAllCurrentPartnerShares`'s own doc comment explicitly states "order not guaranteed" — and the sibling `packages/core/src/permissions.test.ts`'s equivalent test correctly uses `arrayContaining` for the identical underlying data. The two test files are inconsistent with each other on the same claim. | medium (real, trivial) | Confirmed by direct comparison of both test files. The route test would become fragile against a future change to `listAll()`'s row order or the reduction's iteration order, contradicting the codebase's own stated contract. | patch |
| 2 | (blind-hunter) Response ordering is unguaranteed but not called out in the route's own doc comment for a future UI consumer. | false | Low-value now — no UI consumes this endpoint yet (explicitly deferred per this story's own Decisions), and the underlying domain function's doc comment already discloses this. Not a functional defect. | — |
| 3 | (blind-hunter) Spec's "Verification" section reads as a completed checklist even though "Implementation Notes" discloses the live e2e step wasn't run. | false | Matches this repo's established spec-template convention: "Verification > Commands" is instructional (what to run), "Implementation Notes" is the completion log — the same pattern every prior story in this epic uses. No real contradiction. Also now moot: I independently ran the full live Postgres + HTTP verification myself during step-03 review. | — |
| 4 | (blind-hunter) Spec's Implementation Notes doesn't explicitly restate that `pnpm lint`/`typecheck`/`build` were run before marking `in-review`. | false | Already independently re-verified directly by me — all three commands confirmed clean (after clearing an unrelated stale `.next` cache). Not a code defect. | — |
| 5 | (blind-hunter + edge-case-hunter, same observation) `listAll()` is an unbounded, unfiltered full-table scan with no `LIMIT`/pagination consideration. | false | Matches the exact same pre-existing, already-accepted pattern as `listAllUsers()`, called in this identical endpoint since Story 1.7 — not a new class of risk introduced by this story, and consistent with NFR10's stated small-to-medium data volume expectation. | — |
| 6 | (blind-hunter) `PermissionsOverviewDeps.partnerShares` is typed as the full `PartnerSharePort` even though `getPermissionsOverview` only calls `.listAll()` — framed as an Interface Segregation violation. | false | Matches the repo-wide, already-established convention of typing deps by resource-port interface rather than narrowing per call-site (e.g. `PartnerShareDeps`, `AuthorizeDeps` all do this identically across every prior story). Not a new deviation. | — |
| 7 | (blind-hunter) The "`projectId` disambiguates same-named Partners across Projects" justification is never exercised by a test using identical Partner names in two Projects. | false | The code doesn't branch on name equality at all — `projectId` is an unconditional pass-through field. A same-name-across-projects test would exercise no functionally distinct code path from what's already tested. Redundant ask. | — |
| 8 | (blind-hunter) The already-shipped `listCurrentPartnerShares` was refactored (extracted into a shared `reduceToLatestPerPartnerId` helper) as part of this "purely additive" story, without explicit spec callout. | false | Verified safe: a byte-for-byte behavior-preserving extraction, confirmed by every one of `listCurrentPartnerShares`'s existing tests passing unchanged in my own full-suite re-run. Spec-prose precision nitpick, not a functional risk. | — |
| 9 | (blind-hunter) No `ARCHITECTURE-SPINE.md` touchpoint for this story's global-vs-per-Project scoping decision. | false | Matches established precedent — no story in this epic (including Story 2.4's larger User↔Partner-linkage decision) has updated that document; spec files are this build process's decision record. Not a new gap. | — |
| 10 | (blind-hunter) "Spec Change Log"/"Review Triage Log" left as bare empty headers rather than an explicit "N/A". | false | Matches the spec template's own designed behavior — these sections are populated by the review process itself (this table included), not pre-filled with placeholder text. | — |
| 11 | (edge-case-hunter) `getPermissionsOverview`'s new `listAll()` call has no try/catch — an unexpected DB error falls through to a generic framework 500 instead of the route's `{code, message}` envelope. | false | Matches the established, repo-wide pattern for every GET/list endpoint in this codebase (none wrap read operations in try/catch — that's reserved for write paths catching expected domain-validation errors). Not new, not worsened by this story. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `partner-share.test.ts` covers `listAllCurrentPartnerShares`; `permissions.test.ts` covers the new `partners` field
- `pnpm --filter @niveshbook/web test` — expected: `permissions/route.test.ts` covers the new `partners` field in the response, non-Owner/Admin still 403
- `pnpm lint` — expected: clean
- `pnpm typecheck` — expected: clean across all packages
- `pnpm build` — expected: clean
- **Live verification:** create Partners across two different Projects, toggle one's grant on; confirm `GET /api/permissions` as Owner/Admin lists all current Partners with correct grant states; confirm a non-Owner/Admin session gets 403.

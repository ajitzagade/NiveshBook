---
title: 'Create and Edit a Project'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
baseline_commit: 'b5aeb5004e8584abed0c9db0196a7905dd4a9d78'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owner/Admin has no way to create or edit a Project — Epic 2 (Projects, Partner Shares, Privacy) has nothing to build on top of, and no Project-scoped resource exists for `authorize()` to gate yet.

**Approach:** Add a `projects` table, a `packages/core` project domain module + port (mirroring the existing user-port pattern), Owner/Admin-gated create/list/update API routes using `authorizeScope()`, and a full authenticated app shell (sidebar) + list/create/edit UI (reusing `packages/ui`).

**Decisions (resolved 2026-09-23):**
- **Shell/UI scope:** full — this story builds the authenticated shell (sidebar, `packages/ui`'s `NavItem`/`NAV_BADGE_COLOR`) alongside the Projects list/create/edit pages. All 9 NFR18 nav items render (Owner/Admin is authorized for all of them — rendering them isn't the "unauthorized item" case EXPERIENCE.md forbids, that's about role, not build-completeness). Only Home and Projects get a real destination; the other 7 render icon+label with no `href`/`onClick` (inert, not a dead link) until their epics land. Home is a minimal placeholder page (not the real dashboard — that's Epic 5's Story 5.4/5.5/5.6).
- **`authorize()` shape:** `authorizeScope()` only for `projects:create`/`projects:update`/`projects:list` — no Project-shaped `ResourceRef` yet. Story 2.4+ builds that when Partner-level scoping actually needs it.
- **Money columns:** omitted from the Projects table for this story — Name/Description/actions only. Added when Epic 3/4 land with real data.
- **Token budget:** this spec runs ~2,200–2,300 tokens (over the 900–1300 target, above the 1600 risk line) — accepted deliberately: it's one cohesive user-facing goal (create/edit a project) spanning DB+core+API+UI+shell, and the scope standard says not to artificially split a cohesive cross-layer story. Implementation should watch for context rot given the size; the Code Map below exists specifically to avoid re-deriving patterns mid-implementation.

## Boundaries & Constraints

**Always:** Every `app/api/projects/**/route.ts` handler calls `authorizeScope()` before touching data (AD-1). New `projects` table follows `schema.ts`'s existing conventions (uuid v7 PK, text/timestamptz columns). `packages/core` stays zero-DB/zero-HTTP (AD-9) — DB access only in `packages/db`'s project-port implementation. Reuse `packages/ui`'s `Table`/`Card`/`Button`/`Th`/`Td`/`NavItem` for shell and form UI. Every nav item's authorization still comes from the server-verified role (AD-1) — the shell renders the full NFR18 list because Owner/Admin is authorized for all of it, not because visibility is UI-decided.

**Never:** No partner/share logic yet (Story 2.2+) — a project must be creatable and editable with zero partners. No money/balance columns on the Projects table (see Decisions). No Partner Shares, sub-partner allocation, or privacy-boundary logic (Stories 2.2–2.6). No real dashboard content on Home (Epic 5). No `authorize()`/`ResourceRef` work for Projects (see Decisions).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create with valid name | Owner/Admin, name="Project A", description="Residential development at Pune" | 201, project saved, appears in list | N/A |
| Create with empty name | Owner/Admin, name="" | 400 blocked before save | `{code: "validation_error", message}` naming the field |
| Create as non-Owner/Admin | Partner role, otherwise-valid body | 403, no project created | `{code: "forbidden"}`, no partial state |
| Edit existing project | Owner/Admin, existing id, new name/description | 200, change reflected immediately | N/A |
| Edit nonexistent project | Owner/Admin, random UUID | 404 | Same shape/non-leak pattern as Story 1.6 |
| Edit as non-Owner/Admin | Partner role, existing id | 403, no changes persisted | `{code: "forbidden"}` |
| Malformed id in URL | Owner/Admin, non-UUID path segment | 404 (not 400) | Matches existing malformed-id-looks-like-404 convention (`apps/web/lib/ids.ts`) — avoids leaking id-format validity as a side channel |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema.ts` -- add `projects` table: uuid v7 PK, `name text notNull`, `description text` (nullable), `createdAt`/`updatedAt` timestamptz notNull defaultNow -- follow `users`/`sessions` table conventions already in this file.
- `packages/db/drizzle/` -- new migration via `pnpm --filter @niveshbook/db db:generate` after the schema edit.
- `packages/core/src/project.ts` -- new domain module: `createProject`/`updateProject` with empty-name validation -- mirrors `packages/core/src/permissions.ts`'s validation-function shape.
- `packages/core/src/project-port.ts` -- new port interface (`createProject`, `updateProject`, `findProjectById`, `listProjects`) -- mirrors `packages/core/src/user-port.ts`.
- `packages/core/src/authorize.ts` -- extend the `Action` union + `PERMISSIONS` map with `projects:create`/`projects:update`/`projects:list` (Owner/Admin-only).
- `packages/core/src/index.ts` -- barrel-export the new module/port.
- `packages/db/src/ports.ts` -- add `createProjectPort(database = getDb())`, following the existing `createUserPort`/`createSessionPort` factory pattern.
- `apps/web/app/api/projects/route.ts` -- GET (list) + POST (create), both `authorizeScope` -- mirrors `apps/web/app/api/users/route.ts`.
- `apps/web/app/api/projects/[id]/route.ts` -- PATCH (edit) -- mirrors `apps/web/app/api/users/[id]/route.ts` (session check, UUID validation via `apps/web/lib/ids.ts`, authorize, 404-vs-403 non-leak pattern).
- `apps/web/app/api/projects/route.test.ts`, `apps/web/app/api/projects/[id]/route.test.ts` -- mirror `apps/web/app/api/users/[id]/route.test.ts`'s mocking pattern (`vi.mock("@niveshbook/db", ...)`, in-memory fake store).
- `packages/ui/src/components/input.tsx` + `label.tsx` (+ barrel export) -- new; no form Input/Label exists in `packages/ui` yet (confirmed). Style per the mockup's `.field`/`.field-label`/`.amt-input` pattern (`DESIGN.md`).
- `apps/web/lib/session-guard.ts` (or reuse existing session-read helper in `apps/web/lib/session.ts`) -- server-side session/role check for the dashboard layout -- redirect to login if unauthenticated, matches existing route-handler session pattern.
- `apps/web/app/(dashboard)/layout.tsx` -- new authenticated shell: sidebar composed from `packages/ui`'s `NavItem`/`NAV_BADGE_COLOR` (all 9 NFR18 items rendered; only Home/Projects get `href`, the rest render inert per Decisions).
- `apps/web/app/(dashboard)/page.tsx` -- minimal Home placeholder (not the real dashboard -- Epic 5).
- `apps/web/app/(dashboard)/projects/page.tsx` -- list, `Table`/`Card`/`Button` ("+ New Project"), calls `GET /api/projects`.
- `apps/web/app/(dashboard)/projects/new/page.tsx` -- create form (`Input`/`Label`/`Button`), calls `POST /api/projects`.
- `apps/web/app/(dashboard)/projects/[id]/edit/page.tsx` -- edit form, same fields, calls `PATCH /api/projects/[id]`.
- `apps/web/lib/projects.ts` -- thin client fetch helpers for the three calls above, following any existing client-fetch pattern in `apps/web/lib/` (check `client-config.ts`/`users.ts` for the established shape before inventing a new one).

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema.ts` -- add `projects` table -- data model for this and every later Epic 2–5 story
- [x] `packages/db/drizzle/*` -- generate migration -- applies the schema change
- [x] `packages/core/src/project.ts` -- create/update domain functions with validation -- keeps validation out of the HTTP layer
- [x] `packages/core/src/project-port.ts` -- port interface -- keeps `packages/core` DB-free (AD-9)
- [x] `packages/core/src/authorize.ts` -- add `projects:create`/`projects:update`/`projects:list` actions (Owner/Admin-only) -- extends Story 1.5's gate, per AC3
- [x] `packages/db/src/ports.ts` -- `createProjectPort` implementation -- driven adapter for the new port
- [x] `apps/web/app/api/projects/route.ts` + test -- list/create endpoints -- AC1, AC2, AC3
- [x] `apps/web/app/api/projects/[id]/route.ts` + test -- edit endpoint -- AC4, AC5, AC6, AC7 (plus GET, not itemized here -- see Implementation Notes)
- [x] `packages/ui/src/components/input.tsx` + `label.tsx` + barrel export -- reusable form fields for this and every later form
- [x] `apps/web/app/(dashboard)/layout.tsx` -- authenticated shell with sidebar
- [x] `apps/web/app/(dashboard)/home/page.tsx` -- Home placeholder (moved from `page.tsx` -- see Implementation Notes)
- [x] `apps/web/app/(dashboard)/projects/page.tsx` -- list page
- [x] `apps/web/app/(dashboard)/projects/new/page.tsx` -- create page
- [x] `apps/web/app/(dashboard)/projects/[id]/edit/page.tsx` -- edit page
- [x] `apps/web/lib/projects.ts` -- client fetch helpers

**Acceptance Criteria:**
- Given no partner details exist yet, when Owner/Admin creates a project with a name and description, then it saves and appears in the project list without requiring partner information.
- Given an empty name field, when save is attempted, then it's blocked with a clear validation message.
- Given a non-Owner/Admin user, when they attempt to create a project via direct API call, then 403.
- Given an existing project, when Owner/Admin edits its name or description, then the change is saved and reflected immediately.

## Implementation Notes

All tasks complete. Full verification run 2026-09-23:
- `pnpm --filter @niveshbook/core test` -- 74 passed (new `project.test.ts` + `authorize.test.ts` `projects:create`/`projects:update`/`projects:list` cases)
- `pnpm --filter @niveshbook/db test` -- 8 passed (new `projects` table schema-shape assertions in `schema.test.ts` -- still no live-DB tests, per `deferred-work.md`)
- `pnpm --filter @niveshbook/web test` -- 108 passed (new `api/projects/route.test.ts` + `api/projects/[id]/route.test.ts` cover every I/O Matrix row; all pre-existing tests unaffected)
- `pnpm typecheck` -- clean across all 6 packages
- `pnpm lint` (incl. `eslint-plugin-security`) and `pnpm lint:boundaries` -- clean; the two `security/detect-object-injection` warnings in `authorize.ts` are pre-existing (same `PERMISSIONS[action]` pattern Story 1.5 already had, just at shifted line numbers)
- `pnpm build` -- clean; `apps/web` compiles `/home`, `/projects`, `/projects/new`, `/projects/[id]/edit`, `/api/projects`, `/api/projects/[id]` alongside all existing routes

Same build-order note as Story 1.6: `packages/core`/`packages/db`/`packages/types` are consumed by `apps/web` via their built `dist/` output, not source -- `pnpm --filter @niveshbook/types build`, `pnpm --filter @niveshbook/core build`, and `pnpm --filter @niveshbook/db build` were required before the new web route tests could see the new `Action` values/`ProjectPort`, otherwise a stale `dist` throws `Cannot read properties of undefined (reading 'has')` in `authorizeScope()`.

**Deviation from the Code Map, with rationale:** the Home placeholder lives at `apps/web/app/(dashboard)/home/page.tsx` (`/home`), not literally `apps/web/app/(dashboard)/page.tsx` (`/`). Next.js App Router route groups don't add a path segment, so `(dashboard)/page.tsx` would resolve to the exact same URL (`/`) as the pre-existing `apps/web/app/page.tsx` (Story 1.1's login gate / logged-in session-list view) -- co-existing, this is Next's documented "conflicting paths" build error. Rather than rewrite Story 1.1/1.4's tested login-page behavior (out of this story's scope), the dashboard shell mounts at `/home` instead, leaving `app/page.tsx` and its passing test suite (`app/page.test.tsx`, `app/layout.test.tsx`) completely untouched. The `NavItem` "Home" entry points at `/home` accordingly.

**Addition beyond the Code Map:** `GET /api/projects/[id]` was added alongside the specified `PATCH` (mirroring `apps/web/app/api/users/[id]/route.ts`'s GET+PATCH pairing) because the edit page needs a way to pre-fill the form with the Project's current name/description. It reuses the `"projects:list"` gate rather than introducing a fourth `Action`, since spec-2-1's Decisions explicitly cap the action set at exactly `projects:create`/`projects:update`/`projects:list`.

`packages/ui` also gained `Field`/`FieldHint` (in `label.tsx`, alongside `Label`) beyond the literal `input.tsx`/`label.tsx` bullet -- small, reusable wrappers for the mockup's `.field` (16px bottom margin) and `.field-hint` pattern, used by both the new/edit Project forms.

**Known risk, not resolved here:** the generated migration (`packages/db/drizzle/0003_nifty_caretaker.sql`) has not been applied to any live database -- no reachable Postgres instance (colima/docker not running) during implementation, same constraint noted for Story 1.7's migration. Run `pnpm --filter @niveshbook/db db:migrate` before this ships to any environment with real data.

**Step-03 orchestrator verification (2026-09-23), beyond the implementer's own pass:** re-ran `pnpm typecheck`/`pnpm turbo run test --force`/`pnpm turbo run lint --force`/`pnpm lint:boundaries`/`pnpm turbo run build --force` independently (not from cache) -- identical results (74/8/108 tests passed, 0 lint errors, clean build). Then started colima + `docker compose up -d --wait`, ran `db:migrate` (applied cleanly, resolving the risk noted above for this environment) and `db:seed`, and exercised the full flow live against a real Postgres instance via the actual HTTP API: create (201) → empty-name validation (400) → list (200, contains the created project) → edit (200, change persisted) → edit nonexistent id (404) → edit malformed id (404, not 400) → no session (401) → Partner-role user attempting create/list/edit (403 on all three, confirmed no data created and the project's name unchanged in the DB after the rejected edit attempt). Also hit `/home`, `/projects`, `/projects/new` while authenticated (200, correct shell/content) and `/projects` unauthenticated (307 redirect to `/`). Every I/O Matrix row is now verified twice: once by mocked unit tests, once live end-to-end. Postgres container left running (not torn down) for continued Epic 2 work.

**Step-04 patch verification (2026-09-23):** all 7 patch groups (see Review Triage Log) applied and independently re-verified. The patch pass itself added `apps/web/lib/session-guard.test.ts` but no new test cases for the other 6 fixes' corrected behavior -- added those directly rather than looping the subagent again for something this small: `packages/core/src/project.test.ts` (description preserved when omitted from `updateProject`, cleared when explicitly `null`) and one new case each in `apps/web/app/api/projects/route.test.ts` / `.../[id]/route.test.ts` (non-Owner/Admin + malformed body → 403, not 400) and `session-guard.test.ts` (`requireOwnerAdminSession`'s role check). Full suite re-run clean (76/8/115 tests, 0 lint errors, clean typecheck/build/boundaries). Live-reverified against the running Postgres instance: "Go to dashboard" link present on the post-login page; a Partner-role session hitting `/projects` gets a 307 redirect to `/` while Owner/Admin still gets 200; `PATCH` with only `{name}` (no `description` key) preserves the existing description; a Partner sending a malformed body to `POST /api/projects` gets 403, not 400.

## Spec Change Log

## Review Triage Log

Reviewed by 3 parallel layers (blind-hunter, edge-case-hunter, verification-gap) against the diff since `baseline_commit`. 18 raw findings, verified individually below, then grouped by root cause for routing.

| # | Source | Finding | Verdict | Evidence | Group |
|---|---|---|---|---|---|
| 1 | verification-gap | No test covers `requireSession()`/`(dashboard)` layout's redirect-when-unauthenticated behavior | medium | Pre-verified by the gap layer (grepped for test files referencing `session-guard`/`requireSession`/`(dashboard)`; none exist). Confirmed: a regression here (guard dropped/inverted) would ship silently — no existing test renders `DashboardLayout` or calls `requireSession()`. | G4 |
| 2 | verification-gap | `PATCH` always overwrites `description` via `body.description ?? null`, clearing it when omitted | medium | Verified at `apps/web/app/api/projects/[id]/route.ts` (now line ~158) and `packages/core/src/project.ts`'s `updateProject`. Not reachable via the one real caller (edit page always sends both fields) but a live API contract defect for any other caller. | G3 |
| 3 | verification-gap | Write endpoints validate body shape before `authorizeScope()`; read endpoints authorize first | medium | Verified in both `route.ts` files — `isValidBody`/JSON-parse runs before `authorizeScope()` on `POST`/`PATCH`, contradicting AC3's unqualified "403" for a non-Owner/Admin attempt when the body happens to be malformed. | G2 |
| 4 | blind-hunter | No in-app link from the post-login `/` page to `/home` or `/projects` | medium | Verified: `apps/web/app/page.tsx`/`LoginForm.tsx` untouched by this diff, contain no link to the new dashboard. Feature built but unreachable without typing the URL. | G1a |
| 5 | blind-hunter | No tests for any new React page/layout (only the 2 API route test files exist) | medium (auth-relevant portion) / low, rejected (broader UI-state coverage) | Verified: no `*.test.ts*` matches `layout`, `home`, `projects/page`, `session-guard`. Auth-relevant portion merges into #1 (G4). Broader form/loading-state coverage: real gap but fix (tests for 4 more files) exceeds a trivial patch, and no concrete bad outcome demonstrated beyond "untested" — reject per low+non-trivial-fix rule. | G4 (partial) |
| 6 | blind-hunter | 7 inert nav items render as plain focusable no-op buttons, contradicting the "inert, not a dead link" code comment | medium | Verified in `nav-item.tsx`: no `href`/`onClick` still renders a fully focusable, hover-styled `<button>` — indistinguishable from broken. Also an accessibility gap (Tab reaches 7 no-ops). | G5 |
| 7 | blind-hunter | Sidebar renders full nav (incl. working "Projects" link) for any authenticated role, not just Owner/Admin | high | Verified: `requireSession()` only checks session existence, never role. Every `projects:*` action is Owner/Admin-only per this story's Decisions, so a logged-in Partner (a real, already-functional role since Story 1.1) sees a live "Projects" link that 403s on click — directly violates the explicit rule quoted in `epic-2-context.md`: "a nav item is omitted entirely for a role that can't access it, never shown disabled... a visible-but-blocked item would itself leak that the feature exists." The frozen spec's own Boundaries text ("the shell renders the full list because Owner/Admin is authorized for all of it") assumes the viewer *is* Owner/Admin without verifying it — a real gap between stated reasoning and actual behavior, not an accepted tradeoff (the frozen intent decided the API's authorization shape, not who may view the shell). | G1b |
| 8 | blind-hunter | Auth-ordering inconsistency (duplicate of #3) | medium | Same claim, same evidence as #3. | G2 |
| 9 | blind-hunter | `updateProject` description-overwrite (duplicate of #2) | medium | Same claim, same evidence as #2. | G3 |
| 10 | blind-hunter | `deferred-work.md`'s migration-not-applied entry contradicts this spec's own later verification note | low | Verified — my own documentation inconsistency (I added the verification note without updating the entry the implementer wrote earlier). Fixed directly in `deferred-work.md`, not routed as a code patch. | self-corrected |
| 11 | blind-hunter | `isValidBody`/`INVALID_REQUEST_MESSAGE`/not-found block duplicated verbatim across `route.ts` and `[id]/route.ts` | low | Verified — near-identical code in both files. Developer-only harm (the two copies can drift as later Epic 2 stories repeat this pattern), no end-user impact. Fix reduces complexity rather than adding it, so it survives the low+non-trivial-fix rejection. | G6 |
| 12 | blind-hunter | I/O Matrix doesn't list "list projects" or `GET /api/projects/[id]` rows, though both are shipped and tested | — | True, but its fix is to edit the `<frozen-after-approval>` block — rejected per the explicit rule against findings whose fix edits the spec. | rejected |
| 13 | blind-hunter | No max-length validation on `name`/`description` | low | Not required by intent (epics.md's AC never mentions it); Postgres `text` handles arbitrary length safely (no crash risk). Unlikely to be hit in everyday use; fix requires a real length-limit decision across 3 layers — more than trivial. | rejected |
| 14 | blind-hunter | No uniqueness constraint on `projects.name` | low | Not required by intent; two projects can legitimately share a name. Fix requires a real product decision (case-sensitivity, scope, UX for the conflict) — more than trivial. | rejected |
| 15 | edge-case-hunter | No optimistic-concurrency check on `PATCH` — concurrent edits are last-write-wins | low | Real but low-likelihood for a name/description field on a single Owner/Admin-managed resource (unlike AD-10's balance-decrement row-locking requirement, which is scoped to financial mutations and doesn't apply here). Fix (version/`updatedAt`-based conflict detection) is a genuine feature addition, not a direct correction. | rejected |
| 16 | edge-case-hunter | `PATCH` description-overwrite (duplicate of #2) | medium | Same claim, same evidence as #2. | G3 |
| 17 | edge-case-hunter | `updateProject` validates `name` before checking the project exists — nonexistent id + empty name returns 400, not 404 | low | Verified in `packages/core/src/project.ts`: `normalizeName(input.name)` runs before `deps.projects.updateProject(id, ...)` (where existence is actually checked). Requires deliberately crafting two simultaneous invalid conditions — unlikely in everyday use. Fix (check existence first) restructures the function (adds a read+branch) — more than trivial. | rejected |
| 18 | edge-case-hunter | Auth-ordering claim on `POST /api/projects` specifically (duplicate of #3) | medium | Same claim, same evidence as #3. | G2 |

**Grouped entries routed to patch** (smallest fix, no new public surface, consistent with already-approved Decisions):
- **G1a** (#4): Add a link from the post-login page to `/projects`.
- **G1b** (#7): Gate the `(dashboard)` route group to `owner_admin` only — redirect any other authenticated role away, since every feature currently behind it requires that role anyway. Update `deferred-work.md`'s existing entry on this topic once patched (the "nav item renders for every role" clause becomes stale; the underlying "API is Owner/Admin-only for viewing too" note stays, as forward context for Story 2.4+).
- **G2** (#3, #8, #18): Reorder both write handlers to call `authorizeScope()` immediately after the session check, before body parsing/validation.
- **G3** (#2, #9, #16): Only overwrite `description` when the request body explicitly includes the key (both the route handler and `packages/core`'s `updateProject`).
- **G4** (#1, auth-relevant part of #5): Add `apps/web/lib/session-guard.test.ts` covering `requireSession()`'s redirect-vs-resolve behavior.
- **G5** (#6): Give the 7 inert nav items `tabIndex={-1}`/`aria-disabled`/non-interactive styling so they read as visibly inert, not broken.
- **G6** (#11): Extract `isValidBody`/`INVALID_REQUEST_MESSAGE`/not-found-UUID-check into one shared helper used by both route files.

No `intent_gap` or `bad_spec` entries — `review_loop_iteration` stays at 0. All patches re-dispatched to the step-03 implementation subagent in one message.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` -- expected: new project domain tests pass
- `pnpm --filter @niveshbook/db test` -- expected: new port tests pass (schema-shape tests, per existing `schema.test.ts` pattern -- no live-DB tests exist yet, per `deferred-work.md`)
- `pnpm --filter @niveshbook/web test` -- expected: new route tests pass, existing tests unaffected
- `pnpm lint` -- expected: clean (incl. `eslint-plugin-security`, `lint:boundaries`)
- `pnpm typecheck` -- expected: clean across all packages
- `pnpm build` -- expected: `apps/web` builds successfully with new routes/pages

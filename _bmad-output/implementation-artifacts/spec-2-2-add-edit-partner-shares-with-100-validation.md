---
title: 'Add & Edit Partner Shares with 100% Validation'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
baseline_commit: 'efcc6ebc5db62e644253b95cc7d82a7ce358bb3a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Project has no way to record who owns it — Owner/Admin needs to add Partners to a Project with a Share %, see a running total against 100%, and edit a Partner's share later without corrupting the historical record of what it was when past transactions happened.

**Approach:** Add a `partner_shares` table (one row per *version* of a Partner's share, never overwritten in place — AD-3), a `packages/core` domain module + port, Owner/Admin-gated nested API routes under `/api/projects/[id]/partner-shares`, and a Partner Shares page composed from the already-built-but-unused `ShareRow`/`ShareList`/`DistributedCheck` components plus a `Dialog` for add/edit.

**Decisions (resolved 2026-09-23):**
- **Percent type:** introduce a branded `Percent` type in `packages/types` now (architecture doc already names it alongside `Money`) and a minimal `packages/core/src/decimal-math.ts` (AD-2's designated arithmetic module) with exactly `toPercent` (validate/normalize a raw string into a `Percent`, 0 < x ≤ 100, up to 4 decimal places) and `sumPercents` (decimal-safe addition via fixed-point integer math, not `parseFloat`/`Number()`). Display-only comparisons (is the total over/under 100, by how much) happen in `apps/web`, which AD-2's `eslint` ban doesn't cover — only `packages/core`/`packages/db` are restricted to the designated module for stored/computed values.
- **AD-3 versioning trigger:** every edit to a Partner's `sharePercent` **always** creates a new versioned row (new `effectiveFrom`, new row id, same stable `partnerId`) — never a conditional "only if transactions exist" check. AD-3's own rule text ("immutable once set for a given effective period") is unconditional, and Epic 3 (the only thing that could create "transactions already recorded") doesn't exist yet, so a conditional check would be untestable dead code today. Editing a Partner's `name` alone also versions the whole row (simpler than column-level partial versioning; still AD-3-compliant since it's a strict superset of "sharePercent is immutable").
- **Save blocking:** the 100%/90%/110% messaging is informational only — computed and displayed live, never blocking an individual Partner's add/edit from saving. Partners are added incrementally over time; a Project legitimately sits below or above 100% mid-process. (`DistributedCheck`'s other documented use case, Epic 4's Withdrawal Destination split, *does* block save — that's a different screen's decision, not this one's.)
- **UI flow:** one page per Project (`/projects/[id]/shares`) listing current Partner Shares via `ShareList`/`ShareRow` + a `DistributedCheck` showing the live total, an "+ Add Partner" button opening a `Dialog` (name + Share % fields), and each row's "Edit" action opening the same `Dialog` pre-filled. Not a separate new/edit page pair like Story 2.1's Projects — shares are naturally viewed together against a running total, and `Dialog`/`ShareRow`/`DistributedCheck` already exist for exactly this composition.
- **Identity model:** there is no separate `partners` table (confirmed absent everywhere) — a Partner exists only as a row (or row-history) in `partner_shares`, keyed by an app-generated stable `partnerId` distinct from each version row's own `id`. `listCurrentPartnerShares` (domain layer) reduces all version rows for a Project down to the latest `effectiveFrom` per `partnerId`.

## Boundaries & Constraints

**Always:** Every `app/api/projects/[id]/partner-shares/**/route.ts` handler calls `authorizeScope()` immediately after the session check, before body parsing (Story 2.1's ordering fix). New `partner_shares` rows follow `schema.ts`'s existing conventions (uuid v7 PK, `text`/`timestamptz` columns) plus a Postgres `numeric(7,4)` column for `sharePercent`. `packages/core` stays zero-DB/zero-HTTP (AD-9); all `sharePercent` arithmetic goes through `decimal-math.ts`, no other file does `+`/`Number()`/`parseFloat` on a percent value (enforced by the existing eslint rule). Reuse `packages/ui`'s `ShareRow`/`ShareList`/`DistributedCheck`/`Dialog`/`Input`/`Label`/`Button` — no new `packages/ui` components needed.

**Never:** No Sub-partner allocation (Story 2.3) — this story is main Partners only, one level, directly against the full Project. No privacy-boundary enforcement (Stories 2.4–2.6) — every Partner Share is visible to every Owner/Admin request, same Owner/Admin-only gate as Story 2.1 (no `ResourceRef` yet). No audit trail for Partner Share edits (pre-existing gap pattern, same as Story 1.6/1.7/2.1). No hard block on save when the total isn't 100% (see Decisions).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add three partners to 100% | Owner/Admin, Project A, Partner A=50%, B=30%, C=20% added in sequence | Each add succeeds (201); after all three, list shows total "100%" | N/A |
| View a partial total | 2 of 3 partners added (50% + 30%) | List response includes computed total "80%" | N/A |
| View an over-allocated total | Partners summing to 110% | List response includes computed total "110%" | N/A |
| Add with 2-decimal share | Owner/Admin, sharePercent = "33.33" | Accepted, stored exactly (no rounding) | N/A |
| Add with out-of-range share | sharePercent = "0" or "150" or "-5" | 400, blocked before save | `{code: "validation_error", message}` naming the field |
| Add with empty name | name = "" | 400, blocked before save | `{code: "validation_error", message}` |
| Add as non-Owner/Admin | Partner role, otherwise-valid body | 403, no row created | `{code: "forbidden"}`, checked before body validation |
| Edit an existing Partner's share | Owner/Admin, existing `partnerId`, new sharePercent | 200, new versioned row created (new `id`, new `effectiveFrom`, same `partnerId`); old row still exists, unchanged | N/A |
| Edit a nonexistent partnerId | Owner/Admin, random UUID | 404 | Same non-leak shape as Story 2.1 |
| Edit as non-Owner/Admin | Partner role, existing `partnerId` | 403, no new version created | `{code: "forbidden"}` |
| List for a project with zero partners | New Project, no shares added yet | 200, empty list, total "0%" | N/A |

</frozen-after-approval>

## Code Map

- `packages/types/src/index.ts` -- add branded `Percent` type (`string & { readonly __brand: "Percent" }`) and `PartnerShare` interface (`id`, `partnerId`, `projectId`, `name`, `sharePercent: Percent`, `effectiveFrom`, `createdAt`, all ISO-string timestamps -- mirrors `Project`'s shape).
- `packages/core/src/decimal-math.ts` -- new, the one designated arithmetic module (eslint-exempted): `toPercent(raw: string): Percent` (validates 0 < x ≤ 100, ≤4 decimal places, throws on bad input), `sumPercents(values: Percent[]): Percent` (fixed-point integer addition, e.g. scale by 10000).
- `packages/core/src/partner-share-port.ts` -- new port interface: `createPartnerShare`, `findLatestByPartnerId` (nullable), `listByProjectId` (all version rows) -- mirrors `packages/core/src/project-port.ts`'s shape.
- `packages/core/src/partner-share.ts` -- new domain module: `addPartnerShare(projectId, input, deps)` (validates, generates a new `partnerId`, creates the first version), `updatePartnerShare(partnerId, input, deps)` (validates, looks up the latest row for 404-vs-not, always creates a new version per the AD-3 Decision), `listCurrentPartnerShares(projectId, deps)` (reduces all versions to latest-per-`partnerId`), `computeShareTotal(shares)` (delegates to `sumPercents`). Dedicated `InvalidPartnerNameError`/`InvalidSharePercentError` classes, mirroring `project.ts`'s `InvalidProjectNameError` pattern.
- `packages/core/src/authorize.ts` -- extend `Action`/`PERMISSIONS` with `partner_shares:create`/`partner_shares:update`/`partner_shares:list` (Owner/Admin-only, `authorizeScope()` only -- no `ResourceRef`, same as Story 2.1's Projects actions).
- `packages/core/src/index.ts` -- barrel-export the new modules.
- `packages/db/src/schema.ts` -- add `partner_shares` table: `id uuid PK`, `partnerId uuid notNull`, `projectId uuid notNull references projects.id`, `name text notNull`, `sharePercent numeric(7,4) notNull`, `effectiveFrom timestamptz notNull defaultNow`, `createdAt timestamptz notNull defaultNow`.
- `packages/db/src/ports.ts` -- add `createPartnerSharePort(database = getDb())`, mirroring `createProjectPort`'s factory pattern; `toPartnerShare` row mapper converts the numeric column to a `Percent` string.
- `apps/web/app/api/projects/[id]/partner-shares/route.ts` -- GET (list current shares + computed total) + POST (add a partner), both `authorizeScope` immediately after the session check -- mirrors `apps/web/app/api/projects/route.ts`'s structure and ordering.
- `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/route.ts` -- PATCH (edit, versions) -- mirrors `apps/web/app/api/projects/[id]/route.ts`.
- `apps/web/app/api/projects/[id]/partner-shares/shared.ts` -- request-body type guard + not-found response builder, mirroring `apps/web/app/api/projects/shared.ts`.
- Route test files for both handlers, mirroring Story 2.1's `route.test.ts` mocking pattern (`vi.mock("@niveshbook/db", ...)`).
- `apps/web/lib/partner-shares.ts` -- client fetch helpers (list, add, update), mirroring `apps/web/lib/projects.ts`.
- `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` -- the Partner Shares page: `ShareList`/`ShareRow` rows, `DistributedCheck` showing the live total message, "+ Add Partner" `Button` opening a `Dialog` with `Input`/`Label` fields, each row's "Edit" opening the same `Dialog` pre-filled. Covers all 4 NFR8 states (loading/error/empty/loaded).

## Tasks & Acceptance

**Execution:**
- [x] `packages/types/src/index.ts` -- `Percent` type + `PartnerShare` interface
- [x] `packages/core/src/decimal-math.ts` + test -- `toPercent`/`sumPercents`
- [x] `packages/core/src/partner-share-port.ts` -- port interface
- [x] `packages/core/src/partner-share.ts` + test -- domain functions, incl. always-version-on-edit
- [x] `packages/core/src/authorize.ts` -- add `partner_shares:*` actions
- [x] `packages/db/src/schema.ts` -- `partner_shares` table
- [x] `packages/db/drizzle/*` -- generate migration
- [x] `packages/db/src/ports.ts` -- `createPartnerSharePort`
- [x] `apps/web/app/api/projects/[id]/partner-shares/route.ts` + test -- list/add -- AC1, AC2, AC3, AC4, AC5, AC6, AC7
- [x] `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/route.ts` + test -- edit/version -- AC8, AC9, AC10
- [x] `apps/web/app/api/projects/[id]/partner-shares/shared.ts` -- shared validation
- [x] `apps/web/lib/partner-shares.ts` -- client fetch helpers
- [x] `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` -- the Partner Shares page

**Acceptance Criteria:**
- Given Project A with no partners yet, when Partner A=50%, B=30%, C=20% are added, then the screen shows "Total Share: 100% ✓".
- Given a running total of 90%, when the screen is viewed, then it shows "Total is 90%. 10% is still remaining."
- Given a running total of 110%, when the screen is viewed, then it shows "Total is 110%. Please reduce by 10%."
- Given a Share % field, when a value like 33.33 is entered, then it's accepted (at least 2 decimal places supported).
- Given an existing Partner Share, when Owner/Admin edits the percentage, then a new versioned row is created with an effective-from date rather than overwriting the old value (AD-3) — past rows are never mutated.

## Implementation Notes

All tasks complete. Full verification run 2026-09-23:
- `pnpm --filter @niveshbook/core test` -- 116 passed (new `decimal-math.test.ts` (23) + `partner-share.test.ts` (17) cases, incl. always-version-on-edit and exact 2/4-decimal-place sums with no float drift)
- `pnpm --filter @niveshbook/db test` -- 13 passed (new `partner_shares` schema-shape assertions in `schema.test.ts`: NOT NULL columns, no implicit default on `id`/`partnerId`, `numeric(7,4)` column type)
- `pnpm --filter @niveshbook/web test` -- 140 passed (new `partner-shares/route.test.ts` (17) + `partner-shares/[partnerId]/route.test.ts` (8) cover every I/O Matrix row; all pre-existing tests unaffected)
- `pnpm typecheck` -- clean across all 6 packages
- `pnpm lint` (incl. `eslint-plugin-security`) and `pnpm lint:boundaries` -- clean; the two `security/detect-object-injection` warnings in `authorize.ts` are pre-existing (same `PERMISSIONS[action]` pattern Story 2.1 already had). One new `security/detect-unsafe-regex` warning on `decimal-math.ts`'s digit-parsing regex was a false positive (two disjoint, non-nested quantified groups, no catastrophic backtracking) -- suppressed with a documented `eslint-disable-next-line`.
- `pnpm build` -- clean; `apps/web` compiles `/api/projects/[id]/partner-shares`, `/api/projects/[id]/partner-shares/[partnerId]`, and `/projects/[id]/shares` alongside all existing routes

Same build-order note as Story 2.1: `packages/core`/`packages/db`/`packages/types` are consumed by `apps/web` via their built `dist/` output, not source -- `pnpm --filter @niveshbook/types build`, `--filter @niveshbook/core build`, and `--filter @niveshbook/db build` were required before the new web route tests could see the new `Action` values/`PartnerSharePort`/`Percent`, otherwise a stale `dist` throws `Cannot read properties of undefined (reading 'has')` in `authorizeScope()`.

**Live verification against a real Postgres instance** (docker-compose Postgres already running): ran `db:migrate` (applied `0004_wooden_champions.sql` cleanly) and `db:seed`, started `next dev`, and exercised the full flow via real HTTP: created a Project, added Partner A/B/C at 50/30/20% in sequence (each 201, final list total `"100"`), listed a zero-partner project (`{"shares":[],"total":"0"}`), listed a partial total (`"80"`) and an over-allocated total (`"110"`), added a 2-decimal share (`"33.33"`, round-trips as `"33.3300"` -- exact, no rounding, see deviation note below), edited Partner A's share (new row id, same `partnerId`, old row still present with its original value, total recomputed), rejected `sharePercent` of `"0"`/`"150"` and an empty name (400 `validation_error`), rejected an edit against a random unknown `partnerId` (404 `not_found`), and confirmed 401 with no session. Fetched `/projects/[id]/shares` with a live session cookie -- 200, page renders "Partner Shares"/"+ Add Partner". The 403-for-non-Owner/Admin path was not re-exercised live (no partner-role user existed in this DB) -- it's covered by 6 passing mocked route tests instead (auth-before-body-validation ordering included).

**Deviation from the Code Map, with rationale:** `packages/core/package.json` gained a new runtime dependency on `uuidv7` (already used identically by `packages/db`) so `addPartnerShare` can generate the stable `partnerId` at the domain layer, per this spec's own Code Map text ("generates a new `partnerId`") -- `packages/core` had no UUID generator before this story since `createProject`'s row `id` is generated at the `packages/db` port layer instead. This is a plain ID-generation utility, not a DB driver, so it doesn't cross AD-9's zero-DB boundary; `lint:boundaries` confirms no violation.

**Addition beyond the Code Map:** Postgres's `numeric(7,4)` column always round-trips at its full declared scale -- a stored `"33.33"` reads back from the DB as `"33.3300"` (exact value, no precision lost, just zero-padded). This satisfies the I/O Matrix's "stored exactly (no rounding)" at the value level, but looked unpolished directly in the UI, so `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` gained a small `formatSharePercent` display-only helper (plain string trailing-zero trim, no `parseFloat`/`Number()`) applied to each row's Share % and the Edit dialog's pre-fill -- never to the value that's actually sent back to the API. Also added, beyond the literal page bullet: a "← Projects" back-link and an in-empty-state "+ Add Partner" button (on top of the always-visible header one), matching `epic-2-context.md`'s explicit empty-state UX rule ("one Glossary-vocabulary sentence plus a single primary action").

**Known risk, not resolved here:** no test drives the actual React page component (`shares/page.tsx`) directly -- consistent with Story 2.1's precedent (no React Testing Library tests exist for any dashboard page yet), verified instead by a live HTTP fetch of the rendered page confirming a 200 and expected copy. The 403-for-non-Owner/Admin scenario for this story's two routes was verified only via mocked unit tests, not against a live non-Owner/Admin session (none existed in the seeded local DB) -- lower risk than an unverified path since the exact same `authorizeScope()` gate and ordering was already live-verified end-to-end for Story 2.1's Projects routes.

**Step-03 orchestrator verification (2026-09-23), beyond the implementer's own pass:** re-ran `pnpm typecheck`/`pnpm turbo run test --force`/`pnpm turbo run lint --force`/`pnpm lint:boundaries`/`pnpm turbo run build --force` independently (not from cache) -- identical results (116/13/140 tests passed, 0 lint errors, clean build). Live-reverified against the already-running Postgres instance: `db:migrate` applied `0004_wooden_champions.sql` cleanly (confirmed table/indexes/FK via `\d partner_shares`); added Partner A/B/C at 50/30/20% in sequence -- final total exactly `"100"` (no float drift); edited Partner A to 60% -- confirmed via direct SQL that the original `50.0000` row is untouched and a new `60.0000` row exists with the same `partner_id`, list total recomputed to `"110"`; rejected `sharePercent="150"` and an empty name (400 `validation_error`); rejected an edit against an unknown `partnerId` (404). Additionally closed the one gap the implementer flagged as unverified: created a real Partner-role user + session and confirmed live 403 on `GET`/`POST /api/projects/[id]/partner-shares`, including the malformed-body case (403, not 400) -- and confirmed via SQL that no row was created. Fetched `/projects/[id]/shares` with a live session -- 200, renders "Partner Shares"/"+ Add Partner". Every I/O Matrix row is now verified twice: once by mocked unit tests, once live end-to-end.

**Step-04 patch verification (2026-09-23):** all 6 patch groups (see Review Triage Log) applied and independently re-verified via a fresh diff read + full re-run of `pnpm typecheck`/`pnpm turbo run test --force`/`pnpm turbo run lint --force`/`pnpm lint:boundaries`/`pnpm turbo run build --force` (116/13/144 tests, 0 errors, clean build -- the +4 web tests are the two new cross-project-PATCH cases and two new project-existence cases). Fixed one cosmetic doc-comment typo myself (a duplicated "A" left over from the PATCH handler's JSDoc edit) rather than looping back for something that small. Live-reverified the actual exploit G1 fixes: created two projects (X, Y) and a partner on X, then attempted `PATCH /api/projects/<Y>/partner-shares/<X's partnerId>` -- now correctly 404s, and a direct SQL check confirmed the partner share's name/percent are unchanged (previously this silently succeeded and edited X's data through Y's URL). Also confirmed `GET /api/projects/<nonexistent>/partner-shares` now 404s instead of silently returning an empty list.

## Spec Change Log

## Review Triage Log

Reviewed by 3 parallel layers (blind-hunter, edge-case-hunter, verification-gap) against the diff since `baseline_commit`. 15 raw findings, verified individually below, then grouped by root cause for routing.

| # | Source | Finding | Verdict | Evidence | Group |
|---|---|---|---|---|---|
| 1 | verification-gap | `PATCH .../[id]/partner-shares/[partnerId]` never reads/validates the URL's project `id` -- edits a partner share by `partnerId` alone | high | Pre-verified by the gap layer, independently confirmed: `RouteContext`'s `params` includes `id`, but the handler destructures only `partnerId`; `updatePartnerShare` (core) takes no `projectId` at all. A request through any project's URL succeeds in editing a different project's Partner Share with no error -- contradicts the route's own JSDoc claim to mirror the id-validating sibling routes, and no test varies `id` (all 8 tests in the file use the default `PROJECT_ID`). | G1 |
| 2 | blind-hunter | Same cross-project PATCH scoping gap (duplicate of #1) | high | Same claim, same evidence as #1. | G1 |
| 3 | edge-case-hunter | Same cross-project PATCH scoping gap (duplicate of #1, x2 -- also framed as a "claim" entry) | high | Same claim, same evidence as #1. | G1 |
| 4 | blind-hunter / edge-case-hunter | `GET`/`POST /api/projects/[id]/partner-shares` never confirm the project itself exists (only format-checked) | medium | Verified: `GET` returns 200 `{shares:[],total:"0"}` for a well-formed but nonexistent project id (indistinguishable from a real empty project); `POST` would hit the `partner_shares_project_id_projects_id_fk` constraint uncaught, surfacing an unhandled 500 instead of a clean 404. Inconsistent with Story 2.1's own `GET/PATCH /api/projects/[id]` precedent, which does check existence. Low real-world reachability today (no project-delete feature exists yet, so a "stale" project id can only be reached by deliberately crafting one), but the fix is small and in-pattern. | G2 |
| 5 | blind-hunter | I/O Matrix has no row for "project id doesn't exist" | -- | True, but the fix is to edit the frozen `<frozen-after-approval>` block -- rejected per the explicit rule against findings whose fix edits the spec. Folded into #4's evidence instead (the behavioral fix, not a matrix edit). | rejected |
| 6 | blind-hunter | No DB-level `CHECK` constraint for `0 < share_percent <= 100` -- app-layer-only | low | Real, but no reachable path today produces an invalid stored value (only the validated domain layer writes to this table). Guards a hypothetical future regression/direct-DB script, not a current defect. Unlikely to be hit in everyday use; the fix (new migration with a CHECK constraint) is more than a direct correction. | rejected |
| 7 | blind-hunter | Add/Edit dialog's `Helper` text says "up to 2 decimal places" but validation/storage actually support 4 | low | Verified: `toPercent` and `numeric(7,4)` support 4 decimal places (the spec explicitly targets `33.3333%` for Epic 3); the UI copy under-promises. Cosmetic, but the fix is a trivial one-line string correction. | G3 |
| 8 | blind-hunter / edge-case-hunter | `handleSubmit` calls `closeDialog()` before `await refresh()` -- if `refresh()` throws after a successful save, the error sets on already-unmounted dialog state, invisible to the user | medium | Verified: `formError`'s render is nested inside `DialogContent`, which stops rendering once `dialog.open` is `false`. A transient failure right after a successful save (e.g. session expiry between calls) leaves the user with a stale list and zero error signal, even though the underlying save succeeded. | G4 |
| 9 | blind-hunter | No delete/remove capability for a Partner Share, and no "Never" line explaining the cut | medium | Real gap -- an Owner/Admin can never retract a fat-fingered add, only overwrite via edit. Not required by epics.md's Story 2.2 AC (intent doesn't mention it either way). Implementing delete is a new feature (soft-delete? interaction with AD-3 versioning philosophy?), not a small patch. | defer |
| 10 | blind-hunter / edge-case-hunter | `updatePartnerShare` has no optimistic-concurrency check -- two concurrent `PATCH`s on the same `partnerId` both read the same "latest" row, second write silently wins | low | Same class as Story 2.1's rejected concurrency finding. Real but low-likelihood for this resource; fix (version-based conflict detection) is a genuine feature addition, not a direct correction. | rejected |
| 11 | blind-hunter | `parseScaled`'s whole-number regex (`\d+`) has no upper bound before the digit-by-digit loop runs | low | Real: a pathologically long digit string is fully looped over before the `scaled > 100*SCALE` check rejects it. Bounded (O(n) in input length, no amplification, ordinary request-size limits apply) -- not a meaningful DoS vector. But the fix is trivial and correctness-improving (tightening `\d+` to `\d{1,3}`, since a valid Percent is always ≤100 -- at most 3 whole digits), not "added" complexity. | G5 |
| 12 | blind-hunter | No uniqueness constraint on `name` within a project -- two Partners could both be "Partner A" | low | Same class as Story 2.1's rejected uniqueness finding. Not required by intent; fix needs a real product decision (case-sensitivity, scope, conflict UX) -- more than trivial. | rejected |
| 13 | edge-case-hunter | `findLatestByPartnerId`'s `orderBy` has no `id`-based tiebreak for same-`effectiveFrom` ties, unlike the domain layer's own `isNewerVersion` helper | low | Real inconsistency between two "find latest" implementations that should never be able to disagree. Only manifests on a microsecond-exact `effectiveFrom` tie (essentially unreachable under normal sequential use) -- but the fix is a one-line addition to an existing `.orderBy()` call, trivial and free of new complexity. | G6 |
| 14 | edge-case-hunter | `updatePartnerShare` validates `name`/`sharePercent` before checking the partner exists -- nonexistent `partnerId` + invalid input returns 400, not 404 | low | Same class as Story 2.1's rejected finding (E3 there). Requires deliberately crafting two simultaneous invalid conditions; unlikely in everyday use. Fix reorders existence-check before validation -- more than trivial (restructures the function). | rejected |
| 15 | verification-gap | `toPercent` doesn't normalize leading zeros (e.g. `"007"` stays `"007"`) | -- | Not filed as a gap by the layer itself (an observation, not a claim of harm) -- no reachable path in the documented flows produces a leading-zero input. No verdict rendered; not routed. | rejected |

**Grouped entries routed to patch:**
- **G1** (#1, #2, #3): Add `id` to the `PATCH` handler's destructured params, validate it, and check `existing.projectId === id` before updating -- 404 on mismatch, mirroring the sibling routes' pattern. Add a test varying `id` independently of `partnerId`.
- **G2** (#4): Add a project-existence check (`findProjectById` + 404) to `GET`/`POST /api/projects/[id]/partner-shares`, mirroring Story 2.1's `GET /api/projects/[id]` precedent.
- **G3** (#7): Fix the Helper text to say "up to 4 decimal places."
- **G4** (#8): Reorder `handleSubmit` to `await refresh()` before `closeDialog()`, or surface a `refresh()` failure via the page-level error state instead of the dialog-scoped one.
- **G5** (#11): Tighten `parseScaled`'s whole-number regex from `\d+` to `\d{1,3}` (a valid Percent is always ≤100).
- **G6** (#13): Add an `id`-based tiebreak to `findLatestByPartnerId`'s `.orderBy()`, matching `isNewerVersion`'s existing tiebreak logic.

**Deferred:** #9 (no delete capability) -- logged to `deferred-work.md`.

No `intent_gap` or `bad_spec` entries -- `review_loop_iteration` stays at 0.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` -- expected: new `decimal-math`/`partner-share` domain tests pass
- `pnpm --filter @niveshbook/db test` -- expected: new schema-shape tests pass
- `pnpm --filter @niveshbook/web test` -- expected: new route tests pass, existing tests unaffected
- `pnpm lint` -- expected: clean (incl. `eslint-plugin-security`, `lint:boundaries`, `noRawMoneyArithmetic`)
- `pnpm typecheck` -- expected: clean across all packages
- `pnpm build` -- expected: `apps/web` builds successfully with the new routes/page

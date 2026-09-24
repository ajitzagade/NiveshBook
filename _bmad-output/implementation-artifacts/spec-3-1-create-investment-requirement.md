---
title: 'Create Investment Requirement'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
baseline_commit: '33a137ab5869ede750912c2b48bcc0631c3c36b2'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owner/Admin has no way to request funding for a Project — every downstream Epic 3 story (Should Pay, Paid Now, Adjustment, Carry Forward) needs a funding round to exist and be readable before any of that math or recording can happen.

**Approach:** New `investment_requirements` table (one row per funding round — never versioned like `partner_shares`; each new round is a genuinely new row, not an edit of a prior one). New `Money` branded type in `packages/types` (doesn't exist yet — only `Percent` has shipped) plus its `decimal-math.ts` counterpart (`toMoney`/`isZeroMoney`), mirroring `toPercent`'s fixed-point, no-float design exactly, just 2 decimal places and no upper bound instead of 4 and a 100 cap. Owner/Admin-gated `POST`/`GET` routes, a minimal Owner/Admin-facing "Add Money" page (list + create dialog, reusing `packages/ui`'s already-built-but-unused `Amount` component — this story is its first real consumer), and the sidebar's already-present but inert "Add Money" nav item stays inert (matches "Partner Shares"' identical precedent — per-Project features are reached via a Project's own action links, not a project-agnostic sidebar click).

**Decisions (resolved 2026-09-24):**
- **No versioning, no edit/update endpoint for requirements themselves.** Unlike `partner_shares` (AD-3's per-edit versioning), a funding requirement is a discrete event — "the project needed ₹10,00,000 on this date" — not a mutable current-value-with-history. Multiple requirements over time are multiple rows, never edits of one row. Editing/cancelling a *requirement* isn't in any Epic 3 AC (only editing/cancelling a *transaction*, Stories 3.7/3.8, is) — out of scope here.
- **`Money` validates `>= 0` with up to 2 decimal places; the stricter `> 0` for a requirement amount is `createInvestmentRequirement`'s own check, not baked into the type.** Story 3.3's Paid Now amount explicitly allows `0` ("no minimum payment enforced") — if `toMoney` itself rejected zero, every future money-handling story would have to work around that. `toPercent`'s `0 < x <= 100` constraint was safe to bake into the type because *every* use of `Percent` shares that exact range; `Money`'s valid range differs by context (a requirement must be positive, a payment may be zero), so the type only enforces the universal constraint (non-negative, 2 decimal places) and callers enforce their own stricter rule.
- **`requirementDate` is a single plain date, not a separate "cycle" numbering entity.** FR-15's "amount and date/cycle" and every AC in `epics.md`/the PRD only ever reference a literal date, never a cycle number or name — a `date` column (no time component) is the simplest reading that satisfies every stated AC, and inventing a cycle-numbering scheme nothing asks for would be scope creep.
- **`investment_requirements:list` is Owner/Admin-only in this story, same as `:create`.** How a Partner/Sub-partner eventually sees their own Should Pay (which needs this data) is Story 3.2's job, not this one's — mirrors Epic 2's incremental-opening pattern (`partner_shares:list` started Owner/Admin-only in 2.2, only opened to a linked Partner once Story 2.4 built a real reason to).
- **The Projects list page's Actions column gains "Shares" and "Add Money" links.** Investigated first: no navigation path anywhere in the app currently reaches the already-shipped `/projects/[id]/shares` page (Story 2.2) — it was never linked from anywhere, only reachable by typing the URL. Since this story needs a working link to its own new `/projects/[id]/add-money` page anyway, adding both in the same place closes the pre-existing `shares` gap incidentally rather than leaving it to a `deferred-work.md` entry nobody would ever pick up. The sidebar's own "Add Money"/"Partner Shares" items stay inert, unchanged — matches the established per-Project-feature pattern exactly.

## Boundaries & Constraints

**Always:** `POST /api/projects/[id]/investment-requirements` and `GET` on the same path require a valid session (401) and `authorizeScope()` for `"investment_requirements:create"`/`"investment_requirements:list"` (Owner/Admin-only), checked immediately after the session check and before body parsing for `POST` — matches every prior Epic 2 write route's ordering. Project existence is checked the same way `partner-shares/route.ts` already does (`findProjectById`, 404 if missing) before touching `investment_requirements`. `amount` is validated via `toMoney()` (non-negative, ≤2 decimal places) plus an explicit `> 0` check specific to this domain function — `"0"` and any negative-looking string are both rejected with a 400 `validation_error`. `requirementDate` must be a well-formed `YYYY-MM-DD` date string.

**Never:** No update/delete endpoint for `investment_requirements` — not required by any AC, and inventing one risks colliding with whatever edit/versioning shape a later story might actually need. No Should Pay calculation, no Partner/Sub-partner-scoped read access, no Paid Now recording — all later stories' jobs. No change to the sidebar's nav item hrefs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Admin creates a requirement | Project A (Partner Shares already set), amount "1000000", date "2026-10-01" | 201, requirement saved, visible via `GET` on the same Project | N/A |
| Non-Owner/Admin attempts to create | Partner/Sub-partner role, direct API call | 403, no row created, checked before body validation | `{code: "forbidden"}` |
| Amount is "0" | `POST` with `amount: "0"` | 400, blocked before save | `{code: "validation_error", message}` |
| Amount is negative | `POST` with `amount: "-500"` | 400, blocked before save (rejected by `toMoney`'s format itself) | `{code: "validation_error", message}` |
| Amount has more than 2 decimal places | `POST` with `amount: "1000.999"` | 400, blocked before save | `{code: "validation_error", message}` |
| Malformed date | `POST` with `requirementDate: "not-a-date"` | 400, blocked before save | `{code: "validation_error", message}` |
| Nonexistent/malformed project id | Any caller | 404 | `{code: "not_found"}` |
| List requirements for a Project with none yet | Fresh Project | 200, empty list | N/A |

</frozen-after-approval>

## Code Map

- `packages/types/src/index.ts` — add `Money = string & { readonly __brand: "Money" }` (mirrors `Percent`'s exact branding shape); add `InvestmentRequirement { id, projectId, amount: Money, requirementDate: string, createdAt }`.
- `packages/core/src/decimal-math.ts` — add `InvalidMoneyError`, `toMoney(raw: string): Money` (non-negative, ≤2 decimal places, no upper bound — reuses the existing `digitValue`/`digitsToInt` helpers unchanged), `isZeroMoney(value: Money): boolean`. No new arithmetic beyond parsing/validation — this story does no money *arithmetic* at all, only validates and stores.
- `packages/core/src/investment-requirement-port.ts` — new port: `createInvestmentRequirement(input): Promise<InvestmentRequirement>`, `listByProjectId(projectId): Promise<InvestmentRequirement[]>`.
- `packages/core/src/investment-requirement.ts` — new domain module: `InvalidRequirementAmountError`, `InvalidRequirementDateError`, `createInvestmentRequirement(projectId, input: {amount: string, requirementDate: string}, deps)` (validates via `toMoney`/`isZeroMoney` + a `YYYY-MM-DD` date-format check, then calls the port), `listInvestmentRequirements(projectId, deps)` (thin pass-through to the port — no reduction/versioning logic needed, unlike Epic 2's share-history reads).
- `packages/core/src/authorize.ts` — add `"investment_requirements:create"`/`"investment_requirements:list"` to the `Action` union and `PERMISSIONS` (both `new Set(["owner_admin"])`, no `SELF_ACCESS_ACTIONS`/`SCOPE_SELF_ACCESS_ACTIONS` entry — no non-Owner/Admin access in this story).
- `packages/core/src/index.ts` — barrel-export the new module/port.
- `packages/db/src/schema.ts` — add `investmentRequirements` table: `id uuid PK`, `projectId uuid notNull references projects.id (cascade)`, `amount numeric(14,2) notNull`, `requirementDate date notNull`, `createdAt timestamptz notNull defaultNow()`, indexed on `projectId`.
- `packages/db/drizzle/*` — generate migration.
- `packages/db/src/ports.ts` — `createInvestmentRequirementPort(database = getDb())`, mirroring `createProjectPort`'s shape.
- `apps/web/app/api/projects/[id]/investment-requirements/route.ts` — `GET` (list) + `POST` (create), mirroring `partner-shares/route.ts`'s exact structure (project-existence check via `findProjectById`, `authorizeScope()` before body parsing on `POST`).
- `apps/web/app/api/projects/[id]/investment-requirements/shared.ts` — request-body type guard + validation-error-message constants, mirroring `partner-shares/shared.ts`'s pattern.
- `apps/web/lib/investment-requirements.ts` — client fetch helpers (`listInvestmentRequirements`, `addInvestmentRequirement`), mirroring `apps/web/lib/partner-shares.ts`.
- `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — new page: lists current requirements (Amount via `packages/ui`'s `Amount` component, Date) in a `Table`, a "+ New Requirement" button opening a `Dialog` (Amount + Date `Field`/`Input`), covering all 4 NFR8 states (loading/error/empty/loaded) — mirrors the Shares page's established shape.
- `apps/web/app/(dashboard)/projects/page.tsx` — Actions column gains "Shares" (`/projects/[id]/shares`, closes the pre-existing unreachable-link gap) and "Add Money" (`/projects/[id]/add-money`) links, alongside the existing "Edit" link.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/types/src/index.ts` — `Money` type, `InvestmentRequirement` interface
- [ ] `packages/core/src/decimal-math.ts` + tests — `toMoney`/`isZeroMoney`/`InvalidMoneyError`
- [ ] `packages/core/src/investment-requirement-port.ts` — port interface
- [ ] `packages/core/src/investment-requirement.ts` + tests — `createInvestmentRequirement`/`listInvestmentRequirements`
- [ ] `packages/core/src/authorize.ts` + tests — `investment_requirements:create/list` actions
- [ ] `packages/db/src/schema.ts` + migration — `investment_requirements` table
- [ ] `packages/db/src/ports.ts` — `createInvestmentRequirementPort`
- [ ] `apps/web/app/api/projects/[id]/investment-requirements/route.ts` + test — GET/POST
- [ ] `apps/web/app/api/projects/[id]/investment-requirements/shared.ts` — shared validation
- [ ] `apps/web/lib/investment-requirements.ts` — client fetch helpers
- [ ] `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — list + create UI
- [ ] `apps/web/app/(dashboard)/projects/page.tsx` — Shares + Add Money action links

**Acceptance Criteria (from epics.md Story 3.1):**
- Given Project A with Partner Shares already set, when Owner/Admin creates a funding requirement of ₹10,00,000, then it's saved and visible on the project.
- Given a non-Owner/Admin user, when they attempt to create a requirement via direct API call, then 403.
- Given a requirement amount of ₹0 or negative, when submitted, then it's rejected with a clear validation message.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (orchestrator, live-reproduced + edge-case-hunter + blind-hunter, triple-corroborated) `toMoney`/`parseMoneyScaled` impose no upper bound on the whole-number part, unlike `toPercent`'s capped `\d{1,3}`. An amount with more whole digits than `numeric(14,2)`'s 12-digit capacity passes all app-layer validation, then fails at the Postgres insert. The route's `catch` only recognizes `InvalidRequirementAmountError`/`InvalidRequirementDateError` and rethrows anything else. | high (confirmed live) | Live-reproduced myself before any reviewer reported: `POST` with `amount: "999999999999999"` returned an empty-body `500`, not the spec's promised `400 validation_error`. Independently found by both edge-case-hunter and blind-hunter reading the same code. | patch |
| 2 | (verification-gap + edge-case-hunter + blind-hunter, triple-corroborated) `add-money/page.tsx`'s `handleSubmit`: after `addInvestmentRequirement` succeeds, `await refresh()` runs before `closeDialog()`. If the create succeeds but the follow-up `refresh()` (a separate GET) fails, the single outer `catch` sets `formError` as if *creation* failed — the row was already saved. Since Story 3.3 (idempotency keys) hasn't shipped yet, a user who reacts by clicking Save again creates a genuine duplicate `investment_requirements` row. | high (real, narrow window, real financial-data consequence) | Confirmed by reading the code directly: the `try` block has no separation between the create call and the refresh call, so any refresh failure is misattributed to the create. Epic-3-context.md itself confirms idempotency protection doesn't exist until Story 3.3, so nothing currently guards against the resulting duplicate. | patch |
| 3 | (edge-case-hunter) Neither `listByProjectId`'s SQL query nor the Add Money page's render logic sorts the requirement list — no `ORDER BY`, no client-side sort. Rows render in incidental DB order, not guaranteed chronological. | medium (real — this story's own UI is a live consumer, not a hypothetical future one) | Verified: `packages/db/src/ports.ts`'s `listByProjectId` has no `.orderBy()`; `add-money/page.tsx` renders `state.requirements` unsorted. Unlike Story 2.7's identical "order not guaranteed" finding (rejected there since no UI consumed it yet), this story ships the actual consuming UI in the same diff — a real, visible UX defect for the screen whose entire purpose is showing funding rounds over time. | patch |
| 4 | (orchestrator, live-observed) A submitted amount like `"1000000"` round-trips through Postgres's `numeric(14,2)` column and reads back as `"1000000.00"` on every subsequent `GET` — confirmed directly in my own live verification. `packages/ui`'s `formatAmount` (the "one shared formatter for every monetary value in the app") renders this verbatim, showing a trailing `.00` for whole-rupee amounts. | low (cosmetic, but real and matches an established fix pattern) | This is the identical DB-side round-trip behavior Story 2.2 already documented and solved for `Percent` (`formatSharePercent` trims trailing zeros for display, never touching the stored value) — `Money`/`Amount` has no equivalent yet. Since `Amount` is explicitly the *shared* formatter and this story is its first real consumer, fixing it now (while single-consumer) is cheaper than letting every future money screen inherit the same cosmetic gap. | patch |
| 5 | (blind-hunter) `investment_requirements` has no `createdBy`/actor column — no way to discover which Owner/Admin created a given funding round. | false (matches established, already-accepted pattern) | Same class of gap as Stories 1.6/1.7/2.1's identically-shaped "no audit trail yet" findings, already recorded and accepted repeatedly in `deferred-work.md`. Not a new deviation this story introduces. | — |
| 6 | (blind-hunter) No idempotency-key protection or server-side dedupe on `POST .../investment-requirements`. | false (explicitly, intentionally sequenced to a later story) | `epic-3-context.md`'s own Technical Decisions state this pattern is "built in Story 3.3/3.7/3.8" and reused, not this story's job. Not a gap — deliberate sequencing already documented in the planning artifacts this spec cites. | — |
| 7 | (blind-hunter) `epic-3-context.md` narrows AD-5 audit-logging to `investment_transactions` only, while `ARCHITECTURE-SPINE.md`'s Capability Map lists AD-5 as binding to the whole "Add Money (FR-15–FR-20)" grouping, including FR-15 (this story). | false (resolved by the more specific compiled artifact) | The Capability Map is a coarse epic-level index (which FRs live under which epic), not an assertion that every FR within a capability independently triggers full audit machinery — `epic-3-context.md`'s detailed AD-5 write-up is the more specific, authoritative synthesis, and explicitly scopes the audit mechanism to `investment_transactions`. Consistent with finding #5's disposition. | — |
| 8 | (edge-case-hunter) `refresh()` (called from `handleSubmit`) has no unmount-cancellation guard, unlike the mount-time `useEffect`'s `cancelled` flag. | false (matches established, pre-existing pattern) | Identical to the Partner Shares page's `refresh()` (Story 2.2 onward) — every prior page in this codebase has this exact same shape (a guarded initial-load `useEffect`, an unguarded reusable `refresh()` called from write-actions). Not new, not a deviation. | — |
| 9 | (blind-hunter) The mount-time `useEffect` reimplements the same fetch-then-`setState` logic as `refresh()` instead of calling it directly. | false (matches established, pre-existing pattern) | Every prior page (Projects, Shares) has this identical structure — a separate initial-load effect and a separate reusable `refresh()`, not a shared implementation. Not new, not a deviation introduced by this story. | — |
| 10 | (blind-hunter) `sprint-status.yaml` (`in-progress`) and the spec's own frontmatter (`in-review`) disagree with each other and with the tracking file's documented enum (`review`). | — (already being resolved) | Confirmed true as a transient, expected state: implementation just completed and review is in progress — both files get synced to their final values (`done`/`review`) as part of the orchestrator's standard end-of-review step, exactly as every prior story in this build has been handled. Not a defect requiring a separate patch. | — |
| 11 | (blind-hunter) No test covers a valid-JSON-but-wrong-type `amount` (e.g. a number) from an *authorized* owner_admin caller — only a non-owner_admin version of this case is tested (proving 403-before-400 ordering). | false (redundant, no functionally distinct code path) | `isValidInvestmentRequirementBody`'s `typeof candidate.amount === "string"` check treats "missing" and "wrong type" identically — both already-tested "missing amount" cases exercise the exact same boolean expression. No new branch would be covered. | — |
| 12 | (blind-hunter) `parseMoneyScaled`'s unbounded `\d+` combined with `digitsToInt`'s manual accumulation has no test approaching JS's safe-integer precision boundary. | — (same root cause as #1) | Subsumed by finding #1's fix — capping the whole-number digit length (the fix for the overflow bug) also closes this precision-boundary concern, since it's never reached once the cap exists. | patch (via #1) |
| 13 | (verification-gap) `apps/web/next-env.d.ts`'s regenerated `/// <reference>` paths changed from `.next/types/*` to `.next/dev/types/*`. | false (expected, documented tooling behavior) | `apps/web/AGENTS.md` explicitly documents this file is "written and re-added by `next dev`" and that committing it "keeps the tree clean" — not a stray change, matches this repo's own stated convention. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `decimal-math.test.ts` covers `toMoney`/`isZeroMoney`; `investment-requirement.test.ts` covers create/list, incl. the `>0` and date-format validation
- `pnpm --filter @niveshbook/db test` — expected: schema-shape assertions for `investment_requirements`
- `pnpm --filter @niveshbook/web test` — expected: route tests cover the full I/O matrix, incl. 403-before-body-parsing ordering
- `pnpm lint` — expected: clean (incl. `noRawMoneyArithmetic` — `toMoney`/`isZeroMoney` are the only place parsing a money string is allowed)
- `pnpm typecheck` — expected: clean across all packages
- `pnpm build` — expected: clean
- **Live verification:** apply the migration; create a Project with Partner Shares, create a requirement via the live API, confirm it's listed; confirm a non-Owner/Admin session gets 403; confirm `"0"`, a negative amount, and a malformed date each get 400.

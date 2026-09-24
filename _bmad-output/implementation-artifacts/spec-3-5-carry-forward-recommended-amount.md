---
title: 'Carry Forward Recommended Amount'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
baseline_commit: 'b686303f9d8092e6b7105dbb3305f98b30500869'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.4's `investment_adjustments` table holds exactly ONE current row per `(partyType, shareId, projectId)` — deliberately, so the *next* round's carry-forward can read the *previous* round's Pending/Extra Paid before it gets overwritten. But that same single-row design creates a real race: Story 3.4's own `GET .../adjustments` endpoint upserts (overwrites) that row on *every authorized view*, including a view of the *new* requirement's own (initially empty) adjustments. If an Owner/Admin opens the new requirement's Add Money panel — which, per Story 3.4's shipped UI, fetches and displays adjustments alongside Should Pay — the single current row is immediately overwritten with the new round's numbers, permanently destroying the previous round's carry-forward source before this story could ever read it.

**Approach:** Carry-forward is captured **exactly once, atomically, at requirement-creation time** — the one moment guaranteed race-free, since the new requirement doesn't exist yet and nothing could have queried/overwritten adjustments for it. A new `recommended_amounts` table (per-requirement, unlike `investment_adjustments`) is populated right after a requirement is created: for every current Partner/Sub-partner, `baseAmount` = their Should Pay against the *new* requirement (Story 3.2), `previousPending`/`previousExtraPaid` = copied straight from `investment_adjustments`' still-intact current row (zero if none exists — first-ever requirement, or a share with no prior adjustment), and `recommendedAmount = baseAmount + previousPending − previousExtraPaid`, clamped to a minimum of `"0"` for display (never suggests a negative payment). This is additive, minimal-footprint wiring on top of Stories 3.1/3.2/3.4's already-shipped code — no existing domain function's behavior changes, only new route-layer steps and a new table.

**Decisions (resolved 2026-09-24):**
- **Carry-forward snapshots at creation time, not on-demand at view time.** Investigated first: an on-demand "compute Recommended Amount whenever Should Pay is viewed" design was considered and rejected — it would have to read `investment_adjustments`' single current row, which Story 3.4's own shipped `GET .../adjustments` endpoint can silently overwrite before this story ever gets a chance to read the *previous* round's values, if a user happens to view the new requirement's adjustments first. Snapshotting once, atomically, at the one moment nothing else can race it (the requirement doesn't exist until this exact call creates it) is the only design that's correct regardless of view order. This matches the AC's own literal framing ("when a new requirement is created, then Recommended Amount shows...") — a creation-time event, not a view-time computation.
- **This requires one small, purely additive touch to two already-shipped routes**: `POST .../investment-requirements` (Story 3.1) gains one extra step *after* the existing `createInvestmentRequirement` call succeeds — snapshot every current Partner/Sub-partner's Recommended Amount for the just-created requirement. `GET .../should-pay` (Story 3.2) gains one extra step — look up this requirement's already-snapshotted `recommended_amounts` row per share (if any) and merge `recommendedAmount` into each entry. Neither existing domain function (`createInvestmentRequirement`, `computeShouldPay`) changes at all — both stay pure/unchanged; the new work lives in new functions the routes additionally call.
- **`recommended_amounts` is keyed `(requirementId, partyType, shareId)`** — deliberately per-requirement (unlike `investment_adjustments`' single-current-row design), since a specific requirement's Recommended Amount must stay stable and readable for as long as that requirement exists, not get overwritten by a later one.
- **`recommendedAmount` is clamped to a minimum of `"0"`** (never negative) since `Money` itself forbids negative values (AD-2) and a negative "recommended payment" isn't a meaningful suggestion — a Partner who's massively overpaid still sees `previousExtraPaid` in the raw breakdown, just not as a negative recommended figure.
- **The first-ever requirement for a Project (no previous requirement, no prior `investment_adjustments` row) gets `previousPending`/`previousExtraPaid` both `"0"`**, so `recommendedAmount === baseAmount` — Recommended Amount and Normal Share coincide exactly when there's nothing to carry forward, matching epic-3-context.md's UX note ("shown alongside the plain Normal Share" — they're only visually distinct once a carry-forward exists).
- **No change to Story 3.3's `investment_transactions:create`/Paid Now recording — any amount can still be entered, Recommended Amount is display-only, never enforced** (AC2, unchanged behavior — no code touches Story 3.3's validation at all).

## Boundaries & Constraints

**Always:** The Recommended Amount snapshot is written in the *same* successful `POST .../investment-requirements` call that creates the requirement — for every current Partner and Sub-partner, one row each. `GET .../should-pay` merges in `recommendedAmount`/`previousPending`/`previousExtraPaid` for the *given* requirement only, read-only, no write. Every `recommendedAmount` value is non-negative.

**Never:** No new write path on `investment_transactions`/`investment_adjustments` — those stay exactly as Stories 3.3/3.4 left them. `GET .../adjustments` (3.4) is untouched — it still upserts on view, exactly as before; this story works *around* that behavior via the creation-time snapshot, not by changing it. No retroactive snapshot for requirements created *before* this story ships (out of scope — only new requirements created after this story's code is live get a `recommended_amounts` row; an old requirement's Should Pay response simply has no `recommendedAmount` to merge, falling back to Normal Share only, same as the first-ever-requirement case).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worked example | Shares A=50%/B=30%/C=20%; previous round: A Extra Paid ₹2,00,000, C Pending ₹2,00,000, B No Adjustment; new requirement ₹10,00,000 created | Recommended Amount: A=₹3,00,000, B=₹3,00,000, C=₹4,00,000 | N/A |
| First-ever requirement for a Project | No prior requirement, no `investment_adjustments` row for any share | `recommendedAmount === baseAmount` for every share (Normal Share only) | N/A |
| A share with a previous "No Adjustment" | `investment_adjustments` row exists with `adjustmentType: "none"` | `previousPending`/`previousExtraPaid` both `"0"`, `recommendedAmount === baseAmount` | N/A |
| Massively overpaid previously | Previous `extra_paid` exceeds the new `baseAmount` | `recommendedAmount` clamps to `"0"`, never negative | N/A |
| Viewing the new requirement's adjustments (3.4) before or after viewing Should Pay | Either order | Recommended Amount is unaffected either way (snapshotted at creation, never re-derived from `investment_adjustments`) | N/A |
| Owner/Admin records an amount different from Recommended Amount | Any amount, higher or lower | Accepted — never enforced, no validation tied to Recommended Amount (Story 3.3 unchanged) | N/A |
| A pre-existing requirement (created before this story shipped) | No `recommended_amounts` row exists for it | `should-pay` response simply omits/nulls `recommendedAmount` for that requirement — no error, no crash | N/A |
| Non-Owner/Admin views Should Pay | Reused from Story 3.2 | 403, unchanged | `{code: "forbidden"}` |

</frozen-after-approval>

## Code Map

- `packages/types/src/index.ts` — add `RecommendedAmount { id, requirementId, projectId, partyType, shareId, baseAmount: Money, previousPending: Money, previousExtraPaid: Money, recommendedAmount: Money, createdAt }`; extend `PartnerShouldPay`/`SubPartnerShouldPay` (or the route's response DTO, whichever keeps `should-pay.ts` itself pure — see Decisions) with optional `recommendedAmount?: Money`.
- `packages/core/src/decimal-math.ts` — no new arithmetic needed; reuse `subtractMoney`/`compareMoney`/`sumMoney` (Stories 3.4/3.2). Add a tiny `clampMoneyToZero(value: Money): Money`-style helper only if `subtractMoney`'s throw-on-negative behavior needs catching cleanly — otherwise inline a `compareMoney` check before subtracting.
- `packages/core/src/recommended-amount-port.ts` (new) — `SnapshotRecommendedAmountInput`, `RecommendedAmountPort { snapshot(input): Promise<RecommendedAmount>; findByRequirementId(requirementId): Promise<RecommendedAmount[]> }`.
- `packages/core/src/recommended-amount.ts` (new) — `snapshotRecommendedAmounts(requirement, partnerShares, subPartnerSharesByPartnerId, previousAdjustmentsByShareKey, deps)`: reuses `computeShouldPay` for `baseAmount` per share, reads `previousAdjustmentsByShareKey` (the route's already-fetched `investment_adjustments` rows, keyed via `should-pay.ts`'s `shareKey`-equivalent) for `previousPending`/`previousExtraPaid`, computes and clamps `recommendedAmount`, calls `deps.recommendedAmounts.snapshot` once per Partner/Sub-partner. `mergeRecommendedAmounts(partners, recommendedAmounts)`: pure function merging a fetched `RecommendedAmount[]` into `computeShouldPay`'s output shape for the `should-pay` route to use.
- `packages/core/src/index.ts` — barrel-export.
- `packages/db/src/schema.ts` — `recommendedAmounts` table: `id` uuid PK, `requirementId` uuid notNull references `investment_requirements.id` cascade, `projectId` uuid notNull references `projects.id` cascade, `partyType` text notNull, `shareId` uuid notNull (no FK, matches precedent), `baseAmount`/`previousPending`/`previousExtraPaid`/`recommendedAmount` numeric(14,2) notNull; UNIQUE on `(requirementId, partyType, shareId)`.
- `packages/db/drizzle/*` — generate migration.
- `packages/db/src/ports.ts` — `createRecommendedAmountPort`: `snapshot` is a plain insert (never an upsert — a requirement's snapshot is written exactly once, at creation); `findByRequirementId` — plain `WHERE`.
- `apps/web/app/api/projects/[id]/investment-requirements/route.ts` (Story 3.1, additive change) — `POST` handler: after `createInvestmentRequirement` succeeds, fetch current Partner/Sub-partner Shares and the *existing* `investment_adjustments` rows (via `InvestmentAdjustmentPort`, a new read-only lookup — check if one is needed, or reuse existing list-by-project-style access) for this Project, call `snapshotRecommendedAmounts`, then return the created requirement unchanged (the snapshot is a side effect, not part of the response body — matches this story's Boundaries: creation's own response shape is untouched).
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/should-pay/route.ts` (Story 3.2, additive change) — `GET` handler: after computing Should Pay, fetch this requirement's `recommended_amounts` rows and merge via `mergeRecommendedAmounts` before returning.
- `apps/web/lib/should-pay.ts` — extend the response type to include the optional `recommendedAmount`/`previousPending`/`previousExtraPaid` fields.
- `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — show "Recommended: ₹X" alongside the existing "Own"/worked-example line whenever `recommendedAmount` differs from the plain Should Pay (per epic-3-context.md's UX note — "Normal Share" and "After Previous Adjustment" shown side by side once a carry-forward exists; when they're equal, showing both would be redundant noise).

## Tasks & Acceptance

**Execution:**
- [x] `packages/types/src/index.ts` — `RecommendedAmount`, extended should-pay response fields
- [x] `packages/core/src/recommended-amount-port.ts` — port interface (`snapshotAll`, atomic, patch round 1)
- [x] `packages/core/src/recommended-amount.ts` + tests — `snapshotRecommendedAmounts`, `mergeRecommendedAmounts`, the worked example, clamp-to-zero, no-previous-requirement case, atomicity
- [x] `packages/db/src/schema.ts` + migration — `recommended_amounts` table
- [x] `packages/db/src/ports.ts` — `createRecommendedAmountPort` (`snapshotAll`, transaction-wrapped)
- [x] `apps/web/.../investment-requirements/route.ts` + test — POST additive snapshot step, best-effort error swallowing
- [x] `apps/web/.../should-pay/route.ts` + test — GET additive merge step
- [x] `apps/web/lib/should-pay.ts` — extended response type
- [x] `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — Recommended Amount display

**Acceptance Criteria (from epics.md Story 3.5):**
- Given Partner A has Extra Paid ₹2,00,000 and Partner C has Pending ₹2,00,000 from the previous round, when a new ₹10,00,000 requirement is created, then Recommended Amount shows A=₹3,00,000, B=₹3,00,000, C=₹4,00,000, alongside each person's plain Normal Share.
- Given the Recommended Amount is shown, when Owner/Admin records the actual Paid Now, then any amount can be entered — it's never enforced.

## Implementation Notes

`differsFromShouldPay`'s equality check (deciding whether `recommendedAmount` is worth surfacing vs. numerically equal to `shouldPay`) lives in `packages/core/src/recommended-amount.ts`, not the Add Money page — the Code Map suggested either `packages/types` or the route's DTO, but a value (non-type) import from `@niveshbook/core`'s barrel into the Client Component pulled in `auth.ts`'s `argon2` native Node addon and broke the Turbopack client build ("Module not found: Can't resolve 'fs'"). Deciding this server-side, using `packages/core`'s own decimal-safe `moneyEquals`, avoids any Money arithmetic in client code entirely.

`PartnerShouldPayWithRecommended`/`SubPartnerShouldPayWithRecommended` (extending Story 3.2's `PartnerShouldPay`/`SubPartnerShouldPay` with the three new optional fields) live in `packages/core/src/recommended-amount.ts` rather than `packages/types`, since they're specific to this story's merge step, not a generally-shared domain type.

The `POST .../investment-requirements` route's snapshot step is intentionally best-effort: it swallows every error, not just `computeShouldPay`'s two precondition errors, so a transient failure never turns an already-successful requirement creation into a client-visible 500 on an endpoint with no idempotency key. `snapshotAll`'s wrapping DB transaction (patch round 1) guarantees this is genuinely all-or-nothing per call, never a silent partial snapshot.

## Spec Change Log

Patch round 1 (Review Triage Log rows 1, 2, 4): `RecommendedAmountPort.snapshot` (single-row) replaced with `snapshotAll` (array, wrapped in one `database.transaction()`), so a requirement's Recommended Amount snapshot is genuinely all-or-nothing rather than a sequential per-share loop that could partially complete on a mid-loop failure. The `POST .../investment-requirements` route's snapshot-step catch broadened from swallowing only the two known precondition errors to swallowing all errors, so an unexpected failure never leaves an already-created requirement returning an uncaught 500 (this endpoint has no idempotency key, so a retry would have created a duplicate). Added tests proving atomicity (a failing write leaves zero rows, not a partial set), `SubPartnerSharesOverAllocatedError` swallowed the same way as the other precondition error, and a genuinely unexpected error also swallowed with 201 still returned.

Independently re-verified after the patch: `pnpm turbo run typecheck lint test build --force` (18/18 green, 336 core + 70 db + 319 web tests), `pnpm lint:boundaries` (clean), `pnpm audit` (clean), and a full live-Postgres verification pass reproducing the AC's exact worked example twice (before and after the patch) — Recommended Amounts A=₹3,00,000/C=₹4,00,000 exactly, and confirmed viewing the new requirement's own `/adjustments` endpoint (which completely overwrites `investment_adjustments` for those shares) leaves the already-snapshotted Recommended Amounts byte-for-byte unchanged.

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (blind-hunter) `snapshotRecommendedAmounts`'s per-share loop calls `deps.recommendedAmounts.snapshot()` sequentially with no wrapping DB transaction — unlike Story 3.3's `recordTransaction`, which explicitly uses `database.transaction(...)` for its multi-insert. If an insert partway through the loop fails (e.g. a transient connection error), earlier rows are already permanently committed while the rest are silently never written, with no retry (this only runs once, at creation) — violates the spec's own "one row each" Boundary, silently indistinguishable from the legitimate first-ever-requirement case. | high (real, violates a stated Boundary, silent data gap) | Confirmed by direct code read: the loop in `packages/core/src/recommended-amount.ts` has no transaction wrapper; `createRecommendedAmountPort.snapshot` in `packages/db/src/ports.ts` is a single plain insert with no batching. | patch |
| 2 | (blind-hunter) The `POST .../investment-requirements` route's snapshot-step catch only swallows the two known precondition errors; any other unexpected error propagates uncaught out of the handler — since the requirement was already committed by `createInvestmentRequirement` above, the client gets a 500 even though the resource exists, and since this endpoint has no idempotency key (unlike Story 3.3's transactions), a retry creates a genuine duplicate requirement. | high (real, matches an established class of bug this codebase has fixed before — e.g. Story 3.1's own amount-overflow 500) | Confirmed by direct code read: the `catch` block's final `else` branch is a bare `throw error;` with nothing downstream to catch it. | patch |
| 3 | (blind-hunter, edge-case-hunter) The double-snapshot/unique-constraint-violation scenario originally probed for doesn't reproduce as literally described — `createInvestmentRequirement` mints a fresh `uuidv7()` per call, so two POSTs never collide on `(requirementId, partyType, shareId)`. The clamp-to-zero logic, `moneyEquals`-based equality check, sub-partner `partyType` correctness, authorization, and cross-project isolation were all independently investigated by both reviewers and confirmed correct. | false (no defect — investigated and confirmed correct) | See each reviewer's report for the specific verification performed. | — |
| 4 | (verification-gap) The POST route's error-swallowing catch has no test for `SubPartnerSharesOverAllocatedError` being swallowed the same way as `SharesNotFullyAllocatedError`, and no test proving an unrelated/unexpected error still propagates rather than being silently absorbed too broadly. | medium (real gap in the exact area finding #2 patches) | Confirmed via `grep` — zero matches for `OverAllocated` in `route.test.ts`; the narrow-vs-broad-catch distinction has no test in either direction. | patch (folded into finding #2's fix — the catch's behavior is changing anyway, so its new tests must cover both) |
| 5 | (verification-gap) `add-money/page.test.tsx` has zero coverage of the new "Recommended: ₹X" UI line. | false (no bug found to regress-test against) | Consistent with Story 3.4's identical disposition for its `AdjustmentChip` — neither reviewer found a defect in this UI surface, matching this project's established pattern of adding tests reactively to confirmed bugs, not proactively for every new working UI. | — |
| 6 | (verification-gap) `packages/db/src/ports.test.ts` has no DB-level test for `createRecommendedAmountPort`'s `snapshot`/`findByRequirementId`. | false (adequately addressed — matches the already-accepted precedent for `createInvestmentAdjustmentPort`, Story 3.4 row 2) | Same reasoning as Story 3.4's Review Triage Log row 2: no Drizzle-mocking precedent exists in this codebase; the orchestrator's live-Postgres verification (recorded below) directly exercised `snapshot`/`findByRequirementId` against real Postgres this round. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `recommended-amount.test.ts` covers the worked example, clamp-to-zero, no-previous-requirement, and previous-"none" cases
- `pnpm --filter @niveshbook/db test` — expected: schema/port-shape assertions for the new table
- `pnpm --filter @niveshbook/web test` — expected: both routes' tests cover the additive steps without regressing their existing I/O matrices
- `pnpm lint` / `pnpm typecheck` / `pnpm build` — expected: clean
- **Live verification:** create a Project with Shares A=50/B=30/C=20; create a first requirement, record transactions producing A=Extra Paid ₹2,00,000, C=Pending ₹2,00,000, B=No Adjustment (view adjustments once to establish the row); create a second ₹10,00,000 requirement; confirm its Should Pay response shows Recommended Amounts A=₹3,00,000, B=₹3,00,000, C=₹4,00,000 exactly; confirm viewing the second requirement's own /adjustments endpoint (which upserts investment_adjustments) does NOT retroactively change the already-snapshotted Recommended Amounts.

---
title: 'Compute Investment Adjustment'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
baseline_commit: 'b724df5f83399500dc0b22b0573c04b824169eb7'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A funding requirement has Should Pay (3.2) and recorded transactions (3.3), but nobody can see whether a person is ahead or behind — the gap between what they owed and what they actually paid.

**Approach:** New `investment_adjustments` table — ONE current row per `(partyType, shareId, projectId)` (AD-4: never `USER.id`), not one row per funding round. `Adjustment = Should Pay − Actual Paid` for the given funding requirement: positive → Pending, negative → Extra Paid (stored as a non-negative magnitude + a `type` discriminator, since `Money` itself can never be negative — mirrors Story 3.2's `ownShouldPay` non-negative design). "Actual Paid" is the sum of every `investment_transactions.amount` recorded against that specific requirement for that share (zero if none recorded yet — covers both "an explicit ₹0 was recorded" and "nothing recorded at all" identically). A `GET` endpoint computes the adjustment for every current Partner/Sub-partner against one funding requirement and **upserts** each into the single-row-per-share ledger — "viewing" the adjustment is also what keeps the ledger current, since nothing in this story's ACs describes a separate user-facing "recompute" action.

**Decisions (resolved 2026-09-24):**
- **`investment_adjustments` is keyed `(partyType, shareId, projectId)` with a UNIQUE constraint — one current row per person per Project, not one per funding round.** This directly matches AD-4's stated keying and epic-3-context.md's Cross-Story Dependencies ("3.4 → 3.5 (Carry Forward) — carry-forward reads the previous cycle's computed adjustment"): Story 3.5 needs to read the row's value BEFORE this story's own upsert overwrites it with the new round's numbers, which only works if there's exactly one row to read, not a new row per round.
- **The `GET` endpoint upserts on every call, rather than requiring a separate write action.** No AC describes a distinct "compute/save the adjustment" user action — Investment Adjustment is inherently a derived value, and epic-3-context.md's UX note says it "surfaces a status chip next to the person's row immediately," implying it's always current when viewed. Treating the ledger as a materialized cache that refreshes on every authorized view keeps this story's scope to exactly what the ACs describe, without inventing a new user-facing action nothing asks for.
- **`amount`/`shouldPay`/`actualPaid` are `Money` (always non-negative); the sign lives in a separate `adjustmentType: "pending" | "extra_paid" | "none"` discriminator**, mirroring Story 3.2's `ownShouldPay`-never-negative precedent exactly, for the identical reason (`Money`'s branded type forbids a negative value by construction — AD-2).
- **Actual Paid sums every transaction recorded against the *specific* funding requirement being evaluated, not all-time across every requirement for that share.** Matches epic-3-context.md's "Investment Adjustment per cycle" framing and the single-row ledger's own upsert-per-round design — the current row always reflects the most recently viewed/computed round, ready for 3.5 to read as "previous" before the next round overwrites it.
- **`investment_adjustments:view` is Owner/Admin-only in this story**, mirroring Story 3.2's `should_pay:view` precedent exactly (the AC's "As a Partner or Sub-partner" persona describes whose money is being tracked, not who calls the API today — no self-service UI exists yet; Epic 5's dashboards are the planned home for that, same reasoning as 3.2's Decisions). Unlike Story 3.3's `investment_transactions:create` (which got self-access because its AC explicitly named "a user... or Owner/Admin on their behalf"), 3.4's AC has no such explicit self-service framing.
- **No new `packages/core` money-arithmetic beyond a `subtractMoney`/`compareMoney` pair in `decimal-math.ts`** (mirrors `subtractPercents`'s throw-on-negative shape, plus a simple three-way comparator so the adjustment's sign can be determined without exceptions-as-control-flow).

## Boundaries & Constraints

**Always:** `GET /api/projects/[id]/investment-requirements/[requirementId]/adjustments` requires a valid session (401) and `authorizeScope()` for `"investment_adjustments:view"` (Owner/Admin-only), checked immediately after the session check and before any DB read — mirrors `should-pay/route.ts`'s ordering exactly. Project and requirement existence (incl. cross-project mismatch) are checked next. Every adjustment computed reuses Story 3.2's `computeShouldPay` (its two precondition errors — Partner Shares not totaling 100%, Sub-partner over-allocation — propagate to the same 409 codes) and sums Story 3.3's `investment_transactions` for that requirement/share. Every write to `investment_adjustments` is an upsert keyed by `(partyType, shareId, projectId)` — never a second row for the same person.

**Never:** No carry-forward into a *new* requirement's Recommended Amount (Story 3.5's job — this story only computes the current round's adjustment). No netting against a Withdrawal Adjustment (AD-4 — that ledger doesn't exist until Epic 4, and netting is explicitly always a separate, later, explicitly-audited action, never automatic). No write path for transactions themselves (Story 3.3's job, untouched here).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Extra Paid | Partner A: Should Pay ₹5,00,000, transactions summing to ₹7,00,000 | `{type: "extra_paid", amount: "200000"}` | N/A |
| Pending | Partner C: Should Pay ₹2,00,000, no transactions recorded | `{type: "pending", amount: "200000"}` | N/A |
| Pending (explicit ₹0 recorded) | Partner C: Should Pay ₹2,00,000, one transaction of `amount: "0"` | `{type: "pending", amount: "200000"}` (identical to no transaction at all) | N/A |
| No Adjustment | Partner B: Should Pay ₹3,00,000, transactions summing to exactly ₹3,00,000 | `{type: "none", amount: "0"}` | N/A |
| Re-viewing the same requirement | Same requirement viewed twice with no new transactions in between | Second call upserts the identical row (no duplicate, no drift) | N/A |
| A new transaction is recorded between two views | View, then a transaction is recorded via 3.3, then view again | Second view's adjustment reflects the new total (Actual Paid changed) | N/A |
| Non-Owner/Admin views adjustments | Partner/Sub-partner role, direct API call | 403, checked before any DB read | `{code: "forbidden"}` |
| Nonexistent/malformed project or requirement id | Any caller | 404 | `{code: "not_found"}` |
| Partner Shares don't total 100% | Reused from Story 3.2 | 409 `shares_not_fully_allocated` | `{code: "shares_not_fully_allocated"}` |

</frozen-after-approval>

## Code Map

- `packages/core/src/decimal-math.ts` — add `subtractMoney(minuend: Money, subtrahend: Money): Money` (throws `NegativeMoneyResultError` if negative, mirrors `subtractPercents`); `compareMoney(a: Money, b: Money): -1 | 0 | 1`.
- `packages/types/src/index.ts` — add `InvestmentAdjustment { id, projectId, partyType: "partner" | "sub_partner", shareId, requirementId, shouldPay: Money, actualPaid: Money, adjustmentType: "pending" | "extra_paid" | "none", adjustmentAmount: Money, updatedAt, createdAt }`.
- `packages/core/src/investment-adjustment-port.ts` (new) — `UpsertInvestmentAdjustmentInput`, `InvestmentAdjustmentPort { upsert(input): Promise<InvestmentAdjustment> }`.
- `packages/core/src/investment-adjustment.ts` (new) — `computeInvestmentAdjustment(requirement, partnerShares, subPartnerSharesByPartnerId, transactionsByShareKey, deps)`: reuses `computeShouldPay` (letting its two precondition errors propagate), sums transactions per `(partyType, shareId)`, computes each `adjustmentType`/`adjustmentAmount` via `compareMoney`/`subtractMoney`, upserts every Partner/Sub-partner's row via the port, returns the nested tree (mirrors `should-pay.ts`'s shape one field richer).
- `packages/core/src/authorize.ts` — add `"investment_adjustments:view"` (Owner/Admin-only, no self/scope-access entry).
- `packages/core/src/index.ts` — barrel-export.
- `packages/db/src/schema.ts` — `investmentAdjustments` table: `id` uuid PK, `projectId` uuid notNull references `projects.id` cascade, `partyType` text notNull, `shareId` uuid notNull (no FK, matches `investment_transactions.shareId`'s precedent), `requirementId` uuid notNull references `investment_requirements.id` cascade, `shouldPay`/`actualPaid`/`adjustmentAmount` numeric(14,2) notNull, `adjustmentType` text notNull, `updatedAt`/`createdAt` timestamptz notNull defaultNow(); UNIQUE on `(partyType, shareId, projectId)`.
- `packages/db/drizzle/*` — generate migration.
- `packages/db/src/ports.ts` — `createInvestmentAdjustmentPort`: `upsert` via Drizzle's `onConflictDoUpdate` keyed on the unique `(partyType, shareId, projectId)` index.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/adjustments/route.ts` (new) — `GET`, mirroring `should-pay/route.ts`'s structure (session → `authorizeScope` → project/requirement 404 → fetch current shares + this requirement's transactions → `computeInvestmentAdjustment` → 200, or map its two precondition errors to 409).
- `apps/web/lib/investment-adjustments.ts` (new) — client fetch helper.
- `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — extend the Should Pay expand panel with an Adjustment status chip per person (`success` for Extra Paid, `danger` for Pending, neutral for No Adjustment — per epic-3-context.md's UX note, paired with a label + amount, never a bare color dot), reusing `packages/ui`'s `StatusChip`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/decimal-math.ts` + tests — `subtractMoney`/`compareMoney`
- [x] `packages/types/src/index.ts` — `InvestmentAdjustment`
- [x] `packages/core/src/investment-adjustment-port.ts` — port interface
- [x] `packages/core/src/investment-adjustment.ts` + tests — `computeInvestmentAdjustment`, all three worked examples
- [x] `packages/core/src/authorize.ts` + tests — `investment_adjustments:view` action
- [x] `packages/db/src/schema.ts` + migration — `investment_adjustments` table
- [x] `packages/db/src/ports.ts` — `createInvestmentAdjustmentPort` (upsert); behavioral test coverage accepted as inspection-plus-live-verified only (Review Triage Log row 2 — no Drizzle-mocking precedent in this codebase)
- [x] `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/adjustments/route.ts` + test — GET, full I/O matrix
- [x] `apps/web/lib/investment-adjustments.ts` — client fetch helper
- [x] `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — status chip display

**Acceptance Criteria (from epics.md Story 3.4):**
- Given Partner A: Should Pay ₹5,00,000, Paid ₹7,00,000, when the adjustment is computed, then it shows Extra Paid ₹2,00,000 immediately.
- Given Partner C: Should Pay ₹2,00,000, Paid ₹0, when computed, then it shows Pending ₹2,00,000.
- Given Partner B: Should Pay ₹3,00,000, Paid ₹3,00,000, when computed, then it shows No Adjustment.
- Given the `investment_adjustments` ledger, when any entry is written, then it's keyed by `(shareId, projectId)` — never `USER.id` (AD-4).

## Implementation Notes

A Partner's own adjustment row compares against the Partner's aggregate `shouldPay` (own + all current Sub-partners' shares), not `ownShouldPay` alone — deliberately consistent with Story 3.3's `buildTransactionSnapshot`, which snapshots the same aggregate for a `partyType: "partner"` transaction. Verified as an accurate precedent claim by two independent reviewers reading Story 3.3's code directly.

## Spec Change Log

No patches needed — all three review agents (blind-hunter, edge-case-hunter, verification-gap) found the implementation correct; the two verification-gap findings (`ports.test.ts` lacking behavioral upsert coverage, the new `AdjustmentChip` UI having no test coverage) were triaged as accepted gaps rather than patched, per the Review Triage Log's reasoning. Independently re-verified: `pnpm turbo run typecheck lint test build --force` (18/18 green), `pnpm lint:boundaries` (clean), `pnpm audit` (clean), and a full live-Postgres verification pass (A=50%/B=30%/C=20% shares, ₹10,00,000 requirement, transactions of ₹7,00,000/₹3,00,000/none recorded — confirmed Extra Paid ₹2,00,000, No Adjustment, and Pending ₹2,00,000 exactly per the frozen ACs; re-viewed twice and confirmed exactly 3 rows in `investment_adjustments`, no duplicates).

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (blind-hunter, edge-case-hunter) Sign/magnitude logic, the Partner-total-vs-`ownShouldPay` design choice, the `onConflictDoUpdate` conflict target, cross-project/auth leakage, all 9 I/O-matrix rows, multi-transaction summing, sibling-share non-contamination, precondition-errors-before-any-upsert ordering, live share-% re-read on every view, and the `AdjustmentChip` variant mapping were all independently investigated by both reviewers and confirmed correct. | false (no defect — investigated and confirmed correct) | See each reviewer's report for the specific verification performed (direct code tracing, cross-file precedent verification against Story 3.3's `buildTransactionSnapshot`, schema/migration cross-checks). | — |
| 2 | (verification-gap) `packages/db/src/ports.test.ts` has zero tests for `createInvestmentAdjustmentPort`'s `onConflictDoUpdate` upsert behavior, despite the spec's own Tasks checklist saying "`packages/db/src/ports.ts` + tests." The "no duplicate row" guarantee is proven at the calling-convention level (mocked-port call-count tests) but not against real Postgres upsert semantics. | false (adequately addressed — matches Story 3.3's precedent for `audit_log` atomicity) | This codebase has no existing pattern for mocking Drizzle's `.insert().values().onConflictDoUpdate()` chain — every other port's behavior is verified via route-level tests with the port mocked, or via live verification (same precedent Story 3.3's review established for its own DB-transaction atomicity claim, row 4 of that spec's Review Triage Log). The orchestrator independently live-verified this exact behavior against real Postgres this round: recorded transactions, viewed adjustments twice, confirmed exactly 3 rows (one per person) with no duplicates after re-viewing. `schema.test.ts` independently confirms the UNIQUE constraint's exact columns match the `onConflictDoUpdate` target list by inspection. | — (documented as an accepted, inspection-plus-live-verified gap, not a code patch) |
| 3 | (verification-gap) The new `AdjustmentChip`/`ADJUSTMENT_VARIANT` UI in `add-money/page.tsx` has zero test coverage. | false (no bug found to regress-test against) | Unlike Story 3.2/3.3's UI test additions (which were regression tests for CONFIRMED bugs a reviewer found), no reviewer found any defect in this UI surface — both blind-hunter and edge-case-hunter explicitly traced the chip's variant-mapping/lookup logic and found it correct. Consistent with this project's established pattern of adding tests reactively when a review finds a real bug, not proactively for every new working UI surface. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `decimal-math.test.ts` covers `subtractMoney`/`compareMoney`; `investment-adjustment.test.ts` covers all three worked examples plus the zero-transactions/explicit-zero-transaction equivalence
- `pnpm --filter @niveshbook/db test` — expected: schema/port-shape assertions for the new table
- `pnpm --filter @niveshbook/web test` — expected: route test covers the full I/O matrix, incl. re-view/upsert-not-duplicate and the "new transaction between two views" case
- `pnpm lint` / `pnpm typecheck` / `pnpm build` — expected: clean
- **Live verification:** apply the migration; record transactions against a real requirement, view adjustments, confirm the three worked-example states; re-view and confirm no duplicate row; record another transaction and confirm the adjustment updates on re-view.

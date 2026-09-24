---
title: 'Auto-Calculate Can Take'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: '70126879e5ecbb5f0bb3d9fc43e44d7fd27b3f21'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 4 needs each Partner's and Sub-partner's normal withdrawal entitlement (Can Take) computed automatically from Share % × the Project's available-to-withdraw amount — nobody should do this math by hand, and it must split exactly with no leftover paise, matching Should Pay's (Story 3.2) established guarantees.

**Approach:** A new, pure `packages/core/src/can-take.ts` module mirrors `should-pay.ts`'s design exactly: one flat largest-remainder split (via the existing `splitMoneyByPercents`) across every leaf percentage in the Project (each Partner's retained % + every current Sub-partner's %), never two independently-rounded splits composed by subtraction. Unlike Should Pay (scoped to one funding requirement), Can Take is Project-scoped per FR21's wording — one figure per Project, not per round. A new Owner/Admin-only `GET /api/projects/[id]/can-take` endpoint resolves the Project's available-to-withdraw amount and current shares, then calls the calc.

**Decisions (resolved 2026-09-24):**
- **`can_take:view` is Owner/Admin-only**, mirroring `should_pay:view`'s identical precedent (Epic 5 is the planned home for a person's own self-service view; no self/scope-access entry yet).
- **`can-take.ts` defines its own local precondition errors** (shares must total exactly 100%; a Partner's Sub-partner shares must not exceed their own), duplicating rather than importing `should-pay.ts`'s — Story 3.2 is already `done`; extending via a new implementation instead of editing stable code (AGENTS.md Open/Closed).
- **No new `decimal-math.ts` primitives** — `splitMoneyByPercents`/`subtractPercents`/`sumMoney` are reused unchanged.
- **"The Project's available-to-withdraw amount" = total actively-invested money to date**: the sum of every non-cancelled `investment_transactions.amount` row for the Project, across all its investment requirements, computed live. Derived directly from the PRD glossary's Can Take definition ("Share % × the Project's amount available for withdrawal") plus FR34's explicit rule that Investment Adjustment is never netted into a withdrawal figure, plus the fact that no other money-in-the-project ledger exists yet (`withdrawal_transactions`/`available_balances` don't land until Stories 4.2/4.9). Nothing is subtracted for withdrawals yet — a later story extends the route's amount-resolution step for that, never `computeCanTake`'s pure signature.
- **This story builds the first Withdraw Money page** — a Project-scoped, read-only screen showing Can Take per Partner/Sub-partner (no Take Now action; that's Story 4.2's job). Reached via a new "Withdraw Money" link on the Projects list page (`apps/web/app/(dashboard)/projects/page.tsx`), mirroring the existing "Add Money"/"Shares" per-row links — not via the top-level sidebar's `withdrawMoney` nav item, which stays intentionally inert (no `href`) per that file's established convention (only Home/Projects get real top-level hrefs; Add Money follows the identical project-row-link pattern already).

## Boundaries & Constraints

**Always:** `GET /api/projects/[id]/can-take` requires a valid session (401) and `authorizeScope()` for `"can_take:view"` (Owner/Admin-only). Project existence is checked before any calculation (404). Every Can Take value is computed exclusively via `decimal-math.ts` — no `+`/`-`/`*` on a money/percent value anywhere else. The sum of every returned Can Take value equals the resolved available-to-withdraw amount exactly. Computed live on every read, never persisted/snapshotted.

**Never:** No write path — read/compute only. Never factors in Investment Adjustment state (FR34: investment and withdrawal adjustments are never automatically netted). No renormalization of an over/under-100% Partner Share total — surfaced as an explicit 409, matching Should Pay's precedent.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Even split | Project available-to-withdraw ₹5,00,000; Shares A=50%, B=30%, C=20% | 200; A=₹2,50,000, B=₹1,50,000, C=₹1,00,000 | N/A |
| Nested split | Same Project; Partner A's Sub-partners Sub1=12.5%, Sub2=12.5% (A's own share still 50%) | 200; A.ownCanTake + Sub1 + Sub2 sum to A's full 50% share of the total | N/A |
| Uneven split (rounding) | Shares 33.33% / 33.33% / 33.34% | 200; three values that sum to exactly the available amount | N/A |
| Partner Shares don't total 100% | Shares sum to 90% or 110% | 409, no calculation returned | `{code: "shares_not_fully_allocated", message}` |
| Sub-partner shares exceed their Partner's own share | Partner=50%, Sub1=30%, Sub2=30% | 409, no calculation returned | `{code: "sub_partner_shares_over_allocated", message}` |
| No money ever invested in the Project | Zero active `investment_transactions` | 200; available-to-withdraw = ₹0; every Can Take value = ₹0 | N/A |
| Non-Owner/Admin attempts to view | Partner/Sub-partner role, direct API call | 403, checked before any DB read | `{code: "forbidden"}` |
| Nonexistent/malformed project id | Any caller | 404 | `{code: "not_found"}` |

</frozen-after-approval>

## Code Map

- `packages/core/src/decimal-math.ts` — reuse unchanged: `splitMoneyByPercents`, `subtractPercents`, `sumMoney`.
- `packages/core/src/can-take.ts` (new) — `PartnerSharesNotFullyAllocatedError`, `SubPartnerSharesOverAllocatedError` (local copies); `PartnerCanTake { partnerId, name, sharePercent, canTake, ownCanTake, subPartners: SubPartnerCanTake[] }`, `SubPartnerCanTake { subPartnerId, name, sharePercent, canTake }`; `computeCanTake(availableToWithdraw: Money, partnerShares, subPartnerSharesByPartnerId)` — mirrors `computeShouldPay`'s flat-split design exactly.
- `packages/core/src/investment-transaction-port.ts` — add `sumActiveAmountByProjectId(projectId: string): Promise<Money>` (sums `amount` across every active, non-cancelled transaction for the Project, across all requirements).
- `packages/core/src/authorize.ts` — add `"can_take:view"` to `Action`/`PERMISSIONS` (`new Set(["owner_admin"])`).
- `packages/core/src/index.ts` — barrel-export `can-take.ts`.
- `packages/db/src/ports.ts` — implement `sumActiveAmountByProjectId` on `createInvestmentTransactionPort` (SQL `SUM` filtered by `projectId` + `status = 'active'`).
- `apps/web/app/api/projects/[id]/can-take/route.ts` (new) — `GET`: session → `authorizeScope("can_take:view")` → project existence (404) → fetch current Partner/Sub-partner Shares (reuse the existing `listCurrentPartnerShares`/`listCurrentSubPartnerShares`-style reduction) + `sumActiveAmountByProjectId` in parallel → `computeCanTake` → 200, mapping its two domain errors to 409.
- `apps/web/lib/can-take.ts` (new) — client fetch helper `getCanTake(projectId)`, mirrors `should-pay.ts`'s `getShouldPay`.
- `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx` (new) — Project-scoped, read-only: fetches current Partner/Sub-partner Shares + `getCanTake`, renders via `Table`/`ShareRow` (Sub-partners indented one level with `↳`), `Amount` for every money value, a worked-example hint line matching Should Pay's copy pattern (`EXPERIENCE.md`), and the 409/404 states as a plain message. No write action.
- `apps/web/app/(dashboard)/projects/page.tsx` — add a "Withdraw Money" link per project row, mirroring the existing "Add Money"/"Shares" links exactly.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/can-take.ts` + tests — `computeCanTake`, both precondition errors, flat-split reassembly, zero-investment case
- [x] `packages/core/src/investment-transaction-port.ts` + `packages/db/src/ports.ts` + tests — `sumActiveAmountByProjectId`
- [x] `packages/core/src/authorize.ts` + tests — `can_take:view` action
- [x] `apps/web/app/api/projects/[id]/can-take/route.ts` + test — GET, full I/O matrix
- [x] `apps/web/lib/can-take.ts` — client fetch helper
- [x] `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx` + test — Can Take display page
- [x] `apps/web/app/(dashboard)/projects/page.tsx` — Withdraw Money link

**Acceptance Criteria (from epics.md Story 4.1):**
- Given Project A has ₹5,00,000 available to withdraw and Share % 50/30/20, when any authorized viewer opens the withdrawal screen, then Can Take shows A=₹2,50,000, B=₹1,50,000, C=₹1,00,000, via the same decimal-math module and largest-remainder rule as Should Pay (AD-2).

## Implementation Notes

- `can-take.ts`'s two local precondition error classes are named `PartnerSharesNotFullyAllocatedError`/`CanTakeSubPartnerSharesOverAllocatedError`, not the Code Map's literal `PartnerSharesNotFullyAllocatedError`/`SubPartnerSharesOverAllocatedError`. Reason: `should-pay.ts` already exports a class named exactly `SubPartnerSharesOverAllocatedError`; reusing that identical name in `can-take.ts` would make `packages/core/src/index.ts`'s two `export * from "./should-pay"` / `export * from "./can-take"` statements ambiguous for that one symbol, which ES module semantics resolve by silently dropping it from the barrel entirely (not a compile error) -- exactly the kind of invisible breakage AGENTS.md's Open/Closed principle is meant to prevent. Both route-facing JSON error `code`s (`shares_not_fully_allocated`/`sub_partner_shares_over_allocated`) and messages remain exactly as specified; only the internal TS class name for the second error differs. See `can-take.ts`'s own doc comments on each class for the full rationale.

## Spec Change Log

Patch round 1 (Review Triage Log rows 1, 13): added `packages/db/src/investment-transaction-port.test.ts`, a live-Postgres integration test for `sumActiveAmountByProjectId` (excludes cancelled rows, sums across two requirements for the same project, scopes strictly by `projectId`, returns `"0"` for zero active rows); added `investment_transactions_project_id_status_idx` composite index on `(projectId, status)` to `packages/db/src/schema.ts` plus its migration (`drizzle/0014_zippy_makkari.sql`) and a `schema.test.ts` assertion. Independently re-verified: `pnpm --filter @niveshbook/core test` (413 passed), `pnpm --filter @niveshbook/db test` (89 passed, incl. the new live-DB test), `pnpm --filter @niveshbook/web test` (422 passed), `pnpm turbo run lint typecheck build --force` (14/14 tasks green), `pnpm lint:boundaries` (clean, 196 modules/349 deps). All 8 I/O & Edge-Case Matrix rows confirmed covered by a passing route-level test. Ten other findings across the three review layers were verified false (artifacts of the review diff's construction, or consistent with established codebase conventions already in use) or deferred as pre-existing patterns inherited unchanged from Story 3.2's `should-pay.ts`/`add-money.tsx` — see Review Triage Log for the full account.

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (blind-hunter, verification-gap, edge-case-hunter — all three independently) `sumActiveAmountByProjectId`'s real SQL (`packages/db/src/ports.ts`, `coalesce(sum(...), 0)` filtered by `projectId`+`status='active'`) is never executed by any test — `route.test.ts` mocks the port entirely, `investment-transaction.test.ts` only exercises a hand-written in-memory fake, and no `packages/db` test calls the real Drizzle query. | high (confirmed, the only new real SQL this story adds ships with zero real coverage; a wrong status filter or scoping bug would silently misstate Can Take in production) | Verified independently: `grep -rn "sumActiveAmountByProjectId"` across the repo shows only the production route and the two mock/fake test sites; `packages/db/src/ports.test.ts` has no reference to it or to any live-DB query. | patch |
| 2 | (blind-hunter) The diff's context lines around `projects/page.tsx` show an unclosed `<Link>`/missing icon+label, and (verification-gap, edge-case-hunter independently) the trailing "NOTE" text isn't valid diff syntax. | false (artifact of the orchestrator's manually-trimmed review diff, not the real code) | Confirmed directly (`sed -n` on the live file) and independently by two reviewers: the actual on-disk `projects/page.tsx` has the Add Money link fully intact and the Withdraw Money link correctly appended after it. | — |
| 3 | (blind-hunter) `Minus` icon import may be missing from `projects/page.tsx`. | false | `grep -n "Minus"` on the live file confirms `import { ..., Minus } from "lucide-react"` at line 5 and its usage at line 128. | — |
| 4 | (blind-hunter) `computeCanTake` throws `PartnerSharesNotFullyAllocatedError` on an empty `partnerShares` array (0% ≠ 100%), so the route can never return `partners: []`, making the Withdraw Money page's "No Partner Shares yet" `EmptyState` branch dead code reachable only via a test mock. | high if novel — but pre-existing (confirmed: `should-pay.ts` has the identical precondition, and `add-money/page.tsx`'s Should Pay panel has the byte-identical dead `shouldPayState.partners.length === 0` branch, already shipped and reviewed in Story 3.2) | `grep`/`sed` on `should-pay.ts` (same `SharesNotFullyAllocatedError` on empty input) and `add-money/page.tsx` (same unreachable `partners.length === 0` empty-state branch, lines ~705-716). | defer |
| 5 | (blind-hunter) The footer copy "A Partner's Sub-partner split is private -- other Partners never see these rows." is misleading on an Owner/Admin-only page with no partner self-access. | false | Copied verbatim from `shares/page.tsx`'s identical, already-shipped precedent (line ~515-516) — also an Owner/Admin-only page under the same `(dashboard)` guard. The copy describes the underlying data-model privacy guarantee (Epic 2's co-partner boundary, which does apply to withdrawal data per the epic-4-context), not a claim about who is currently viewing the page. | — |
| 6 | (blind-hunter) `DistributedCheck` used with a single total `Amount` as `status` may not match its intended two-value "Distributed: X/Y" contract. | false | `packages/ui/src/components/distributed-check.tsx`'s actual props are `{label: string, status: ReactNode}` — a generic label+value bar with no enforced two-value comparison logic; a single `Amount` node is a valid use of its real contract. | — |
| 7 | (blind-hunter) `route.test.ts` sums `canTake` via `Number(p.canTake)` instead of the project's `sumMoney`, inconsistent with AD-2. | false | `noRawMoneyArithmetic` (`packages/config/eslint.base.mjs`) explicitly ignores `**/*.test.ts`/`**/*.test.tsx`; `should-pay/route.test.ts` uses the byte-identical `sum + Number(p.shouldPay)` pattern already. | — |
| 8 | (blind-hunter) `sumActiveAmountByProjectId`'s `sql<string>` + `as Money` cast is a compile-time-only assertion with no runtime guarantee the driver returns a string. | false | `as Money` on a Drizzle numeric-column read is the codebase's pervasive, established convention throughout `ports.ts` (used ~10+ times already for every money-typed field) — `node-postgres` returns `numeric` columns as strings by default; not a risk unique to this story. | — |
| 9 | (blind-hunter, edge-case-hunter — both independently) An orphaned Sub-partner Share (a `partnerId` key in `subPartnerSharesByPartnerId` absent from `partnerShares`) is silently dropped from the split rather than surfaced as a data-integrity error. | high if novel — but pre-existing (confirmed: `should-pay.ts`'s identical `subPartnerSharesByPartnerId[partner.partnerId] ?? []` lookup has the same silent-drop behavior for the inverse case, shipped in Story 3.2) | `grep -n "subPartnerSharesByPartnerId"` on `should-pay.ts` shows the identical lookup-and-default pattern. | defer |
| 10 | (blind-hunter) `## Spec Change Log`/`## Review Triage Log` were blank at time of review. | — (not a code defect) | These sections are explicitly meant to be populated by this review step itself, per the spec template. | — |
| 11 | (blind-hunter) `WithdrawMoneyPage`'s client-side `useEffect` fetch (vs. server-side rendering) risks NFR10's <2s target. | false as a novel regression | `projects/page.tsx` and `add-money/page.tsx` both use the identical `"use client"` + `useEffect` fetch pattern already, established throughout every `(dashboard)` page in this codebase, not introduced by this story. | — |
| 12 | (edge-case-hunter) `apps/web/lib/can-take.ts`'s success-path `response.json()` has no try/catch for a malformed-but-200 body. | defer (pre-existing) | `apps/web/lib/should-pay.ts` has the byte-identical unwrapped `response.json()` on its success path — this story's helper mirrors it exactly, not a new gap. | defer |
| 13 | (edge-case-hunter) No composite index on `(project_id, status)` for `investment_transactions` supports the new `sumActiveAmountByProjectId` aggregate query — the existing `(share_id, project_id)` index doesn't help a project-only filter (`share_id` is the leading column). | low (real, genuinely new query shape with no existing index — should-pay.ts never aggregates over `investment_transactions`; at NFR10's stated scale — hundreds-low-thousands of rows/project — a sequential scan is still fast today, but the fix is a trivial one-line addition matching this table's existing index-array pattern) | Confirmed via `packages/db/src/schema.ts`: only `investment_transactions_requirement_id_idx` and `investment_transactions_share_id_project_id_idx` (leading column `shareId`) exist; neither covers a `projectId`+`status` filter without `shareId`. | patch |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `can-take.test.ts` covers the worked example, both precondition errors, uneven-split, zero-investment
- `pnpm --filter @niveshbook/db test` — expected: `sumActiveAmountByProjectId` covered (excludes cancelled rows, sums across multiple requirements)
- `pnpm --filter @niveshbook/web test` — expected: route test covers the full I/O matrix, incl. 403-before-DB-read ordering
- `pnpm lint` — expected: clean (`noRawMoneyArithmetic`)
- `pnpm typecheck` — expected: clean across all packages
- `pnpm build` — expected: clean
- **Live verification:** open the new Withdraw Money page for a real Project with Partner Shares (incl. one Partner with Sub-partners) totaling 100% and existing investment transactions; confirm the numbers match the worked example on screen (not just the API response); set shares to a non-100% total and confirm the plain-language 409 message renders; confirm the "Withdraw Money" link appears on the Projects list page.

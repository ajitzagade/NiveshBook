---
title: 'Compute Withdrawal Adjustment'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: 'acfd0af2a814547ad32b0d299bc4bb725723c3be'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Can Take (4.1) and Take Now (4.2) exist independently — nobody can see whether a Partner/Sub-partner is under- or over-their-entitlement, and FR23 requires that gap tracked as Keep for Later or Extra Taken.

**Approach:** New `withdrawal_adjustments` table, written via upsert-on-view exactly mirroring `investment_adjustments`' pattern (Story 3.4) — computed and persisted every time it's viewed, keyed by `(partyType, shareId, projectId)` with a UNIQUE constraint driving `onConflictDoUpdate`. Unlike Should Pay/Investment Adjustment (scoped to one funding requirement), Can Take is Project-scoped with no round concept (Story 4.1) — Withdrawal Adjustment mirrors that scoping: no `requirementId` column, "Taken" is the sum of ALL active withdrawal transactions for the Project to date, compared against the current live Can Take. `computeWithdrawalAdjustment` reuses `computeCanTake` (4.1) for the entitlement tree, then per share compares against summed Taken via `compareMoney` (never raw `<`/`>`). Displayed on the Withdraw Money page (4.1/4.2's existing page), mirroring Investment Adjustment's embedded display on Add Money.

**Decisions (resolved 2026-09-24):**
- **Symmetric two-direction computation (Keep for Later / Extra Taken / No Adjustment), not just the under-take case.** FR23 names both directions explicitly ("Keep for Later or Extra Taken"), and Story 4.2 already decided Take Now accepts any amount with no cap — an over-Can-Take amount can already exist in the data before Story 4.5 builds its authorization gate, so this computation must classify it correctly today, not crash or misreport it. Mirrors `investment_adjustment`'s three-way `compareMoney` branch (`pending`↔`extra_paid`↔`none`) exactly, renamed `keep_for_later`↔`extra_taken`↔`none`.
- **No `requirementId`/cycle scoping.** `withdrawal_adjustments` drops the column `investment_adjustments` has for it — Can Take has no funding-round equivalent, so inventing one here would contradict Story 4.1's own Project-scoped design. "Taken" sums every `withdrawal_transactions` row for the Project (no `status` column exists yet per Story 4.2's Decisions, so nothing to filter).
- **`withdrawal_adjustments:view` is Owner/Admin-only**, mirroring `investment_adjustments:view`'s identical precedent (no self-access, despite the AC's "As a Partner" framing describing whose money is tracked, not who calls the API today — Epic 5 owns self-service views).
- **Upsert-on-view, not written at Take Now record time** — mirrors Story 3.4's exact precedent (the adjustment ledger reflects the latest view, recomputed live from current transactions, not maintained incrementally on write).
- **Chip mapping for this page's display**: `extra_taken` → `danger` (mirrors Investment Pending's "concerning, exceeds entitlement" treatment — pre-Story-4.5, an over-take has no authorization trail yet); `keep_for_later` → `violet` (per epic-4-context.md's explicit UX convention: "`violet` marks ... Keep for Later"); `none` → `neutral` (mirrors Investment Adjustment's identical "none" precedent).

## Boundaries & Constraints

**Always:** `GET /api/projects/[id]/withdrawal-adjustments` requires a valid session (401) and `authorizeScope()` for `"withdrawal_adjustments:view"` (Owner/Admin-only), checked before any DB read. Project existence checked before any calculation (404). Every value computed exclusively via `decimal-math.ts` (`compareMoney`, `subtractMoney`, `sumMoney`) — no raw arithmetic elsewhere. Can Take's own preconditions (Partner Shares total 100%, no Sub-partner over-allocation) propagate as the same 409 codes. A successful `GET` upserts exactly one `withdrawal_adjustments` row per current Partner/Sub-partner share (unique on `(partyType, shareId, projectId)`).

**Never:** No netting against `investment_adjustments` — the two ledgers stay fully independent (FR34), enforced by never reading one to compute the other. No write path beyond the upsert-on-view itself — no direct create/edit/delete endpoint. No change to `withdrawal_transactions`/`sharePercent`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under-take | Partner B Can Take ₹1,50,000, Taken ₹0 | `keep_for_later`, amount ₹1,50,000 | N/A |
| Exact match | Partner A Can Take ₹2,50,000, Taken ₹2,50,000 | `none`, no adjustment balance | N/A |
| Over-take | Can Take ₹1,50,000, Taken ₹3,00,000 (accepted per Story 4.2's no-cap decision) | `extra_taken`, amount ₹1,50,000 | N/A |
| Multiple Take Now transactions for one share | Two transactions of ₹50,000 and ₹25,000 | Taken = ₹75,000 (summed) | N/A |
| No transactions yet | Zero withdrawal_transactions for the share | Taken = ₹0, `keep_for_later` = full Can Take | N/A |
| Re-viewed after a new transaction | Adjustment already persisted; a new Take Now recorded since | Row is upserted (updated), not duplicated | N/A |
| Partner Shares don't total 100% | Shares sum to 90% | 409 (reused from Story 4.1) | `{code: "shares_not_fully_allocated"}` |
| Non-Owner/Admin attempts to view | Partner/Sub-partner role, direct API call | 403, before any DB read | `{code: "forbidden"}` |
| Nonexistent/malformed project id | Any caller | 404 | `{code: "not_found"}` |

</frozen-after-approval>

## Code Map

- `packages/core/src/decimal-math.ts` — reuse unchanged: `compareMoney`, `subtractMoney`, `sumMoney`.
- `packages/core/src/withdrawal-adjustment-port.ts` (new) — `UpsertWithdrawalAdjustmentInput`; `WithdrawalAdjustmentPort { upsert(input): Promise<WithdrawalAdjustment>; listByProjectId(projectId): Promise<WithdrawalAdjustment[]> }`, mirroring `InvestmentAdjustmentPort`'s exact contract shape.
- `packages/core/src/withdrawal-adjustment.ts` (new) — `PartnerWithdrawalAdjustment { partnerId, name, sharePercent, canTake, taken, adjustmentAmount, adjustmentType: "keep_for_later" | "extra_taken" | "none", subPartners: [...] }`; `computeWithdrawalAdjustment(availableToWithdraw, partnerShares, subPartnerSharesByPartnerId, takenByShareKey, deps: { withdrawalAdjustments })` — reuses `computeCanTake` for the entitlement tree, `compareMoney`-branches per share, upserts each, returns the persisted rows. `shareKey(partyType, shareId)` helper, mirroring `investment-adjustment.ts`'s.
- `packages/core/src/authorize.ts` — add `"withdrawal_adjustments:view"` (`authorizeScope()`, `new Set(["owner_admin"])`, no self-access).
- `packages/core/src/index.ts` — barrel-export the new module/port.
- `packages/db/src/schema.ts` — `withdrawalAdjustments` table: `id` uuid PK, `projectId` uuid notNull references `projects.id` cascade, `partyType` text notNull, `shareId` uuid notNull (no FK, mirrors `withdrawal_transactions`), `canTake`/`taken`/`adjustmentAmount` numeric(14,2) notNull, `adjustmentType` text notNull, `updatedAt`/`createdAt` timestamptz notNull defaultNow(); unique on `(partyType, shareId, projectId)`.
- `packages/db/drizzle/*` — generate migration.
- `packages/db/src/ports.ts` — `createWithdrawalAdjustmentPort(database = getDb())`: `upsert` via Drizzle `onConflictDoUpdate` targeting the unique constraint, mirroring `createInvestmentAdjustmentPort` exactly; `listByProjectId` — plain `WHERE projectId = ...`.
- `apps/web/app/api/projects/[id]/withdrawal-adjustments/route.ts` (new) — `GET`: session → `authorizeScope("withdrawal_adjustments:view")` → project 404 → fetch current shares + `sumActiveAmountByProjectId`-style aggregate of `withdrawal_transactions.amount` grouped by `(partyType, shareId)` (new `WithdrawalTransactionPort` method `sumAmountByShare(projectId): Promise<Record<string, Money>>`, or fetch-and-group in the route if simpler — implementer's call, matching whichever existing precedent this codebase already uses for `should-pay`'s adjustment equivalent) → `computeWithdrawalAdjustment` → `{partners}`, mapping Can Take's two domain errors to 409.
- `apps/web/lib/withdrawal-adjustments.ts` (new) — client fetch helper `getWithdrawalAdjustments(projectId)`.
- `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx` — add a Withdrawal Adjustment section per Partner/Sub-partner row (mirroring Investment Adjustment's embedded display on Add Money): `StatusChip` per the Decisions' chip mapping, paired with a label + `Amount` (never a bare color dot, per epic-4-context.md's UX convention).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/withdrawal-adjustment.ts` + tests — `computeWithdrawalAdjustment`, all three adjustment types, multi-transaction summing, exact-zero case, upsert-not-duplicate on re-view
- [x] `packages/core/src/withdrawal-adjustment-port.ts` — port interface
- [x] `packages/core/src/authorize.ts` + tests — `withdrawal_adjustments:view` action
- [x] `packages/db/src/schema.ts` + migration — `withdrawal_adjustments` table
- [x] `packages/db/src/ports.ts` + tests (incl. a live-Postgres integration test for the upsert/`onConflictDoUpdate` path) — `createWithdrawalAdjustmentPort`
- [x] `apps/web/app/api/projects/[id]/withdrawal-adjustments/route.ts` + test — GET, full I/O matrix
- [x] `apps/web/lib/withdrawal-adjustments.ts` — client fetch helper
- [x] `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx` — Withdrawal Adjustment display, chips per Decisions

**Acceptance Criteria (from epics.md Story 4.3):**
- Given Partner B: Can Take ₹1,50,000, Taken ₹0, when computed, then it shows Keep for Later ₹1,50,000.
- Given Partner C: Can Take ₹1,00,000, Taken ₹0, when computed, then Keep for Later ₹1,00,000.
- Given Partner A: Can Take ₹2,50,000, Taken ₹2,50,000, when computed, then no Keep for Later balance is created.
- Given the `withdrawal_adjustments` ledger, when any entry is written, then it's keyed by `(shareId, projectId)`, independent from `investment_adjustments` (AD-4).

## Implementation Notes

Did not drive the page through an actual browser session — no browser-automation tool available in this environment, same accepted limitation as Stories 4.1/4.2. Covered instead by React Testing Library tests.

## Spec Change Log

Patch round 1 (Review Triage Log rows 1-3): extended the post-save test to assert `getWithdrawalAdjustments`'s call count and the updated chip render; added Sub-partner adjustment-chip coverage (`findSubPartnerAdjustment`, scoped per-row with `within()`) plus an exact-zero Can Take/Taken case; replaced the mount effect's inline duplicate of `refreshAdjustments`'s body with a direct call to the single implementation.

Orchestrator fix (found during re-verification, not a separate review round): wrapping `refreshAdjustments` in `useCallback([projectId])` to satisfy `react-hooks/exhaustive-deps` on the mount effect's dependency array — the patch round's fix introduced a new lint warning (0 errors, so it wouldn't have failed CI, but was cleaned up rather than left as the first `exhaustive-deps` warning in this codebase). Independently re-verified: `pnpm turbo run test lint typecheck build --force` (18/18 green, no warnings), `pnpm lint:boundaries` (clean, 213 modules/389 deps). One `packages/db` test failed once on a parallel `turbo run`, did not reproduce on an isolated re-run or a second full-suite re-run — a transient flake unrelated to this story's (web-only) fix, not a regression.

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (verification-gap) No test asserts `getWithdrawalAdjustments` is called again (and the chip updates) after a successful Record Withdrawal submission — `handleRecordWithdrawalSubmit` calls `refreshAdjustments().catch(() => {})`, but no test exercises this specific refresh path. | low (real — a regression here would go undetected; trivial fix) | Confirmed via `grep` across `page.test.tsx`: no assertion on `getWithdrawalAdjustments`'s call count after a submit. | patch |
| 2 | (verification-gap) No test exercises the Sub-partner Withdrawal Adjustment chip (`findSubPartnerAdjustment`) at all — every existing test's mocked response only includes a no-subs partner, so a swapped-lookup bug would go undetected. | low (real coverage gap; the lookup logic itself was independently read and confirmed correct — `partner.partnerId` then `sub.subPartnerId`, matching its call site — but untested) | Confirmed via direct read of `findSubPartnerAdjustment` and `grep` across the test file for a `subPartners` entry in any mocked adjustments response — none found. | patch |
| 3 | (blind-hunter) The Withdraw Money page's initial-mount `useEffect` re-implements `refreshAdjustments`'s fetch/setState/error-handling logic inline instead of calling `refreshAdjustments()`, creating two copies of the same behavior — deviates from `add-money/page.tsx`'s established precedent, which calls its own `refreshAdjustments(requirementId)` on mount rather than duplicating it. | low (real DRY deviation from the precedent this story explicitly mirrors; trivial fix) | Confirmed: `add-money/page.tsx` calls `void refreshAdjustments(requirementId)` on mount (line 383); `withdraw-money/page.tsx`'s mount effect duplicates the body instead. | patch |
| 4 | (blind-hunter) Sequential (not `Promise.all`-batched) per-share `await`ed upserts in `computeWithdrawalAdjustment`'s loop mean N sequential DB round-trips per page view. | defer (pre-existing) | `investment-adjustment.ts`'s `resolveAndUpsertAdjustment` loop has the byte-identical sequential `for...of` + `await` structure, confirmed by direct read. | defer |
| 5 | (edge-case-hunter) `route.ts`'s `Promise.all` (shares/available-to-withdraw/transactions fetch) sits outside any `try`/`catch` — a rejection surfaces as a bare 500 instead of this route's JSON error envelope. | defer (pre-existing) | `investment-adjustments/route.ts`'s equivalent `Promise.all` has the identical unwrapped placement, confirmed by direct read. | defer |
| 6 | (edge-case-hunter) `computeWithdrawalAdjustment` throwing anything other than the two known Can Take precondition errors bypasses the route's `{code, message}` contract (falls through to an unhandled rethrow). | defer (pre-existing) | `investment-adjustments/route.ts` wraps `computeInvestmentAdjustment` in the identically-scoped try/catch (only the two known errors handled), confirmed by direct read. | defer |
| 7 | (edge-case-hunter) No cross-share DB transaction wraps the per-Partner/Sub-partner upserts — a mid-loop failure leaves a mix of freshly-updated and stale rows. | defer (pre-existing) | Same sequential, non-transactional loop shape as `investment-adjustment.ts`, confirmed by direct read (see row 4). | defer |
| 8 | (blind-hunter) `WithdrawalAdjustmentPort.listByProjectId` is implemented and live-Postgres-tested, but `route.ts` never calls it — the GET handler always returns the freshly-computed tree. | defer (pre-existing) | `investment-adjustments/route.ts` never calls `InvestmentAdjustmentPort.listByRequirementId` either, confirmed by direct read — the same "port completeness ahead of a second consumer" precedent. | defer |
| 9 | (blind-hunter) The new table's only index (`UNIQUE(party_type, share_id, project_id)`) has `project_id` as a trailing column, so `listByProjectId`'s `WHERE project_id = ...` can't use it as a leading index. | defer (pre-existing) | `investment_adjustments` has the identical trailing-column-only index shape, confirmed by direct read of `schema.ts`. | defer |
| 10 | (blind-hunter) No documented behavior for a `withdrawal_adjustments` row belonging to a Partner/Sub-partner no longer in the current share set (orphaned/stale row). | defer (pre-existing) | `investment-adjustment.ts` has the identical undocumented gap — no orphan-handling logic or comment in either file. | defer |
| 11 | (blind-hunter) Every plain page view re-triggers a full upsert across every current share, even if nothing changed since the last view (no dirty-check/short-circuit). | false (by design, not a defect) | Explicitly decided in this spec's own Decisions ("Upsert-on-view, not written at Take Now record time — mirrors Story 3.4's exact precedent") — the intentional, already-shipped `investment_adjustments` behavior. | — |
| 12 | (blind-hunter) The frozen Acceptance Criteria bullet says the ledger is "keyed by `(shareId, projectId)`," omitting `partyType`, while the rest of the spec/code correctly keys on all three. | false (verbatim quote of epics.md's own AC/AD-4 phrasing, not a spec error) | Confirmed via `grep` on `epics.md` lines 100 and 787 — the source document itself uses this shorthand. | — |
| 13 | (blind-hunter) No test covers a Partner/Sub-partner whose Can Take is exactly zero. | low (real, narrow edge case; trivial fix) | Confirmed absent from both the I/O matrix and the test suite. | patch (folded into the same test-strengthening pass as rows 1-2) |
| 14 | (blind-hunter, edge-case-hunter, verification-gap — corroborating) The route's auth/existence ordering, Can Take precondition propagation, the `compareMoney`/`subtractMoney` branching (incl. `NegativeMoneyResultError` guarding), the `shareKey`→`withdrawalShareKey` collision-avoidance rename, chip variant mapping, and Owner/Admin-only scoping were all independently traced and confirmed correct. | false (no defect) | Edge-case-hunter traced every new call site against its real declaration; verification-gap and blind-hunter independently confirmed the same paths. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `withdrawal-adjustment.test.ts` covers all three adjustment types, multi-transaction summing, exact-zero, upsert idempotency
- `pnpm --filter @niveshbook/db test` — expected: schema assertions plus a live-Postgres integration test for the upsert/conflict path
- `pnpm --filter @niveshbook/web test` — expected: route test covers the full I/O matrix
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm lint:boundaries` — expected: clean
- **Live verification:** apply the migration; view Withdrawal Adjustment for a Project with a mix of under-take, exact-take, and (via a manually-recorded over-Can-Take transaction) over-take Partners; confirm the three adjustment types render with the correct chip colors; confirm re-viewing after a new Take Now updates the row rather than duplicating it.

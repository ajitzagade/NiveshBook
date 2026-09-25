---
title: 'Auto-Linked Cross-Project Movement'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: '5d8fbad871289f92674b59ec2e3c9049c2f74101'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A "project" destination leg (Story 4.7) currently just records `destinationProjectId` + `amount` — it never creates the real linked investment record FR28 requires. Investigation confirmed this is a genuine, undocumented gap: `investment_transactions` requires a non-null `requirementId` + a valid share at that specific requirement, and nothing in the current data captures which funding round or which Partner/Sub-partner share at the destination Project the money should apply to.

**Approach:** Confirmed with the user 2026-09-25: extend the destination-allocation flow so Owner/Admin picks the destination requirement + share at allocation time (mirroring how a manual Add Money entry already works), producing a real `investment_transactions` row — not a `money_movements`-only record — so Should Pay/Investment Adjustment at the destination Project correctly reflect the money (FR18's accuracy). New `packages/core/src/move-withdrawal-to-project.ts` (`moveWithdrawalToProject()`, AD-6) is a pure, dependency-injected orchestration function — reuses `buildTransactionSnapshot`/`computeShouldPay` exactly as a manual Add Money entry would, never a new calculation path. It "accepts and participates in a caller-supplied transaction" (AD-6's exact requirement) by taking already-transaction-bound ports as `deps`, constructed by `packages/db`'s `createWithdrawalDestinationAllocationPort` *inside* its existing `database.transaction()` block (Story 4.7) — the same atomic write now also creates the destination `investment_transactions` row and a new `money_movements` linking row for every "project" leg, or rolls all of it back together (AD-6/AC3).

**Decisions (resolved 2026-09-25):**
- **`withdrawal_destination_allocations` (Story 4.7) gains two new nullable columns**: `destinationRequirementId` (FK → `investment_requirements`), `destinationShareId` + `destinationPartyType` — set only for `"project"` legs. Non-breaking migration (nullable, existing rows unaffected).
- **If the chosen destination Project has zero investment requirements, `"project"` is not a completable destination** — the UI shows a clear inline message ("Project B has no funding requirements yet") and Save stays disabled for that leg, mirroring Story 4.7's own `isAllocationLegComplete` pattern rather than inventing a synthetic requirement (which no story asks for and would be speculative scope).
- **The auto-created `investment_transactions` row's `idempotencyKey` is derived deterministically** from the allocation's shared `idempotencyKey` (e.g. `` `${idempotencyKey}:move:${legIndex}` ``) — no new client-supplied key needed, satisfies that table's own unique constraint, and a replay of the whole allocation batch deterministically replays the same derived key too.
- **AC2's "reachable and mutually navigable" is satisfied at the data level this story** (the destination Project's Add Money view shows the auto-created transaction is a movement, e.g. "Moved from Project A"; the source Project's allocation display already shows "→ Project B" per Story 4.7) — not a clickable cross-project trail UI. A full navigable trail is explicitly Epic 5's job (Story 5.2, "Linked-Transaction Navigation"), per epic-4-context.md's repeated framing that Epic 5 owns trail/navigation visualization.
- **`money_movements` links to the specific `withdrawal_destination_allocations` row** (not directly to the withdrawal transaction), since one withdrawal can have multiple "project" legs to different destinations — the FK chain (`money_movement → allocation leg → withdrawal_transaction`) is what makes the source side of the chain reconstructable.

## Boundaries & Constraints

**Always:** The requirement/share picker only appears once a destination Project is chosen for a `"project"` leg; both must resolve to *current* data (an existing requirement at that Project, a current Partner/Sub-partner share at that Project) at save time, re-validated server-side (never trusting the client's earlier fetch). The auto-created investment snapshot (`sharePercentSnapshot`/`shouldPaySnapshot`) is computed via the exact same `buildTransactionSnapshot`/`computeShouldPay` path a manual Add Money entry uses — never a separate calculation. The whole batch (allocation rows + every "project" leg's investment_transactions + money_movements rows) commits or rolls back as one transaction (AD-6, extending Story 4.7's existing atomicity, not replacing it).

**Never:** No synthetic/auto-created investment requirement. No change to `recordInvestmentTransaction`'s/`buildTransactionSnapshot`'s existing signatures — `moveWithdrawalToProject()` is a new, additive caller (Open/Closed). No cross-project trail/navigation UI (Epic 5). No change to Story 4.7's non-"project" leg types (person/available_balance/other) — unaffected by this story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full worked example (AC1/AC3) | ₹1,50,000 "project" leg → Project B, an existing requirement, Partner X's share | Allocation saves; a new `investment_transactions` row exists at Project B with the correct snapshot; Project B's Add Money view shows it | N/A |
| Destination Project has zero requirements | Chosen Project B has none | "project" leg incomplete — Save blocked, clear inline message | N/A (client-side block, mirrors Story 4.7's completeness gate) |
| Chosen requirement no longer exists at save time | Requirement deleted/changed between fetch and submit | Rejected | `404 not_found` |
| Chosen share no longer current at save time | Share edited/removed between fetch and submit | Rejected | `404 not_found` |
| Multiple "project" legs in one allocation, different destinations | Two legs, two different destination Projects | Both create their own linked investment/movement records, atomically | N/A |
| Idempotent replay of an already-processed "project" leg | Same allocation `idempotencyKey`, identical content | 200 replay — no duplicate investment_transactions/money_movements rows | N/A |
| Partial-batch failure (one leg's snapshot build fails) | E.g. Partner Shares at destination not fully allocated | Entire allocation batch rolls back — no partial investment/movement rows, no partial allocation rows either | 409, matching the underlying `computeShouldPay` precondition error |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema.ts` — extend `withdrawalDestinationAllocations`: add `destinationRequirementId` (uuid, references `investment_requirements.id`, nullable), `destinationShareId` (uuid, nullable), `destinationPartyType` (text, nullable). New `moneyMovements` table: `id` uuid PK, `withdrawalDestinationAllocationId` uuid notNull references `withdrawal_destination_allocations.id` cascade, `sourceProjectId`/`destinationProjectId` uuid notNull references `projects.id`, `destinationInvestmentTransactionId` uuid notNull references `investment_transactions.id`, `amount` numeric(14,2) notNull, `createdAt` timestamptz notNull defaultNow(); index on `withdrawalDestinationAllocationId`.
- `packages/db/drizzle/*` — generate migration.
- `packages/core/src/money-movement-port.ts` (new) — `MoneyMovementPort { record(input): Promise<MoneyMovement> }`.
- `packages/core/src/move-withdrawal-to-project.ts` (new) — `moveWithdrawalToProject(allocationLegId, sourceProjectId, destinationProjectId, requirement, partnerShares, subPartnerSharesByPartnerId, targetPartyType, targetShareId, amount, derivedIdempotencyKey, actorUserId, deps: { investmentTransactions, moneyMovements }): Promise<{investmentTransaction, moneyMovement}>` — calls `buildTransactionSnapshot` (reused unchanged, lets its `ShareNotFoundError`/precondition errors propagate), then `deps.investmentTransactions.recordTransaction(...)`, then `deps.moneyMovements.record(...)`. Pure orchestration, zero Drizzle imports (AD-9).
- `packages/core/src/index.ts` — barrel-export both new modules.
- `packages/core/src/withdrawal-destination-allocation.ts` — extend leg validation: a `"project"` leg now also requires `destinationRequirementId`/`destinationShareId`/`destinationPartyType`.
- `packages/db/src/ports.ts` — `createMoneyMovementPort`; extend `createWithdrawalDestinationAllocationPort`'s `recordAllocation`: inside its existing `database.transaction(async (tx) => {...})`, for every `"project"` leg, construct `createInvestmentTransactionPort(tx)`/`createMoneyMovementPort(tx)` and call `moveWithdrawalToProject()`, threading its two new results into the returned allocation response.
- `apps/web/app/api/projects/[id]/withdrawal-transactions/[transactionId]/destination-allocations/shared.ts` — extend the leg type guard for the three new `"project"`-only fields.
- `apps/web/app/api/projects/[id]/withdrawal-transactions/[transactionId]/destination-allocations/route.ts` — resolve+validate `destinationRequirementId`/`destinationShareId` against the destination Project's *current* data before calling the domain function (404 if either doesn't resolve).
- `apps/web/lib/withdrawal-destination-allocations.ts` — extend the request/response types for the three new fields plus the linked investment/movement info in the response.
- `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx` — when a `"project"` leg's destination Project is chosen, fetch that Project's current investment requirements (`GET .../investment-requirements`, already Owner/Admin-scoped, reused unchanged) and current Partner/Sub-partner Shares, render a Requirement `<select>` and a Share `<select>`; empty-requirements state shows the blocking message; extend `isAllocationLegComplete` accordingly.
- `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — the destination Project's recorded-payments list already renders every `investment_transactions` row (Story 3.3); add a small "Moved from Project A" indicator when a row has a linked `money_movements` entry (a new, minimal read — `GET` the transaction's movement link, or include it in the existing transactions-list response; implementer's call on the lightest-weight approach that doesn't touch Story 3.3's core list contract).

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema.ts` + migration — extend `withdrawal_destination_allocations`, new `money_movements` table
- [x] `packages/core/src/money-movement-port.ts` — port interface
- [x] `packages/core/src/move-withdrawal-to-project.ts` + tests — orchestration, snapshot reuse, error propagation
- [x] `packages/core/src/withdrawal-destination-allocation.ts` + tests — extended "project" leg validation
- [x] `packages/db/src/ports.ts` + tests (incl. live-Postgres integration test for the extended atomic write) — `createMoneyMovementPort`, extended `createWithdrawalDestinationAllocationPort`
- [x] `apps/web/app/api/.../destination-allocations/route.ts` + `shared.ts` + tests — extended I/O matrix
- [x] `apps/web/lib/withdrawal-destination-allocations.ts` — extended types
- [x] `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx` + test — requirement/share pickers, empty-requirements block, extended completeness gate
- [x] `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` + test — "Moved from Project A" indicator (new `apps/web/app/api/projects/[id]/money-movements/route.ts` + `apps/web/lib/money-movements.ts` added to serve it, per this story's "implementer's call on the lightest-weight approach")

**Acceptance Criteria (from epics.md Story 4.8):**
- Given the ₹1,50,000 destined for Project B in Story 4.7, when the destination allocation is saved, then the system automatically creates and links the withdrawal record (Project A), a money-movement record, and an investment record (Project B) as one action (FR28, `moveWithdrawalToProject()`, AD-6).
- Given this linked set, when viewed from either Project A or Project B, then the full chain is reachable and mutually navigable (data-level, per this story's Decisions — full navigation UI is Epic 5's job).
- Given Owner/Admin checks Project B's Add Money history afterward, when they look, then the ₹1,50,000 already appears — never manually re-entered.

## Implementation Notes

- The destination requirement/Partner/Sub-partner-Share snapshot (`DestinationSnapshotInput`) is resolved by the **route layer** (fresh on every request, never client-trusted) and threaded, already-validated, through `recordDestinationAllocation` → the port's `CreateWithdrawalDestinationAllocationLegInput.destinationSnapshotInput` → `moveWithdrawalToProject()`. `packages/db`'s `recordAllocation` itself never re-fetches requirement/share data inside its transaction — it only constructs the two transaction-bound ports (`createInvestmentTransactionPort(tx)`/`createMoneyMovementPort(tx)`) per the Code Map's literal wording. This mirrors the existing precedent for `destinationProjectId`'s own existence check (also route-resolved, not re-checked inside the atomic write).
- Each `"project"` leg's row `id` is pre-generated (`uuidv7()`) before the multi-row insert, rather than read back from `.returning()`, since Postgres/Drizzle don't guarantee `.returning()` preserves input order for a multi-row insert — this keeps `allocationLegId`/`legIndex` (for the derived idempotency key) correctly paired to the right leg regardless.
- `moveWithdrawalToProject()`'s auto-created `investment_transactions` row uses `paymentMode: "other"` and today's date (no caller-supplied equivalent exists for a system-generated movement); the "Moved from Project A" indicator is derived from the linked `money_movements` row, not from any notes text.
- Add Money's indicator needed a new minimal read path: `MoneyMovementPort.listByDestinationProjectId` + `GET /api/projects/[id]/money-movements` (new `"money_movements:list"` action, Owner/Admin-only) + `apps/web/lib/money-movements.ts`. The add-money page also now fetches `listProjects()` (already Owner/Admin-only, reused unchanged) to resolve the source Project's display name.
- Implemented concurrently with an unrelated in-progress background-agent change to `add-money/page.tsx` (a "summary-confirm step" for money-moving actions, uncommitted at the time) — verified via `git diff`/`git log` that all hunks landed correctly and no unrelated work was overwritten in either direction.

## Spec Change Log

## Review Triage Log

3-layer review (blind-hunter, edge-case-hunter, verification-gap), applied in one consolidated patch round:

1. **[Medium, correctness]** Zero-amount `"project"` leg created a permanent phantom `investment_transactions`/`money_movements` record (`toMoney` only rejects negative, not zero). Fixed: new `ZeroAmountProjectLegError` in `withdrawal-destination-allocation.ts`'s `normalizeLeg` (checked via `isZeroMoney`, AD-2), wired to 400 `validation_error` in the route; mirrored client-side in `withdraw-money/page.tsx`'s `isAllocationLegComplete` via `scaleMoneyForCompare(leg.amount) > 0`.
2. **[Low, UI]** Added the zero-Partner/Sub-partner-Shares-but-has-requirements blocking message in `DestinationRequirementAndSharePickers`, mirroring the existing zero-requirements case.
3. **[High, verification gap]** Added `add-money/page.test.tsx` coverage for the "Moved from Project A" indicator (positive/negative cases in one render, plus the source-Project-name-fallback and total-fetch-failure paths) — previously zero coverage despite being claimed tested.
4. **[Medium, verification gap]** Added a live-Postgres test in `withdrawal-destination-allocation-port.test.ts` covering I/O matrix row 5 (two `"project"` legs, two different destination Projects, one `recordAllocation` call) — asserts both linked `investment_transactions`/`money_movements` rows and the per-leg-index derived idempotency keys.
5. **[Medium, verification gap]** Added a `move-withdrawal-to-project.test.ts` case for `SubPartnerSharesOverAllocatedError` propagating uncaught (mirroring the existing `ShareNotFoundError`/`SharesNotFullyAllocatedError` cases), plus route-level `route.test.ts` mapping tests for `SharesNotFullyAllocatedError`/`SubPartnerSharesOverAllocatedError`/`ShareNotFoundError`/`ZeroAmountProjectLegError` (all previously unexercised at the route layer).
6. **[Low, verification gap]** Added a concurrent-double-submit-race variant test in `withdrawal-destination-allocation-port.test.ts` using a `"project"` leg — confirms exactly one `investment_transactions` row and one `money_movements` row survive two simultaneous identical `recordAllocation` calls.

Deferred (logged to `deferred-work.md`, not this round): the route re-validates destination requirement/share before checking for an idempotent replay, theoretically 404-ing a legitimate replay if destination data changed between the original save and a retry — currently unreachable (no deletion path for requirements/shares exists yet).

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `move-withdrawal-to-project.test.ts` covers the worked example, error propagation, snapshot correctness
- `pnpm --filter @niveshbook/db test` — expected: schema assertions plus a live-Postgres integration test for the extended atomic write (allocation + investment_transactions + money_movements, all-or-nothing)
- `pnpm --filter @niveshbook/web test` — expected: route test covers the extended I/O matrix; page tests cover the picker UI and the Add Money indicator
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm lint:boundaries` — expected: clean
- **Live verification:** allocate a "project" leg to a real second Project with an existing requirement and share; confirm the investment_transactions row appears in that Project's Add Money view with the correct snapshot; confirm Should Pay/Investment Adjustment there reflect it; confirm attempting a "project" leg to a Project with zero requirements is blocked; confirm a batch with one bad leg rolls back everything (no partial allocation, no partial investment/movement rows).

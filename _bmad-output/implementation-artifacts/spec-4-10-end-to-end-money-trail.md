---
title: 'End-to-End Money Trail'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: '29b89be8faeb8b7d2a38e5963e0c53ffcdc466f4'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR-30 requires every transaction (investment, withdrawal, movement, balance use) to be reconstructable as one linked chain from any starting point, with totals reconciling exactly. Nothing today walks this chain — every existing read (Add Money's "Moved from Project A" indicator, `GET /api/projects/[id]/money-movements`) is single-hop. There's also no reconciliation check beyond the single-write-boundary `AllocationMismatchError` (a withdrawal's legs must sum to its amount, checked once at save time, never re-verified).

**Approach:** Confirmed with the user 2026-09-25:
1. **Data/API capability only, no dedicated UI this story.** epics.md's own AC for 4.10 has no UI language; the FR list explicitly labels FR-30 (this story) the "write path" and FR-32 (Story 5.2, Linked-Transaction Navigation) the "read path for FR30's trail." The Trail/TraceBanner visual component (`DESIGN.md`'s `trail-node`/`trail-branch`) belongs to Story 5.2's Money History detail screen per `EXPERIENCE.md:70` (the UX spine, authoritative over the compiled `epic-4-context.md`'s stale attribution). Verified via a backing API + tests + live `curl` verification, not a rendered screen.
2. **Owner/Admin-only in practice**, matching every table this reads (`investment_transactions:list`/`withdrawal_transactions:list`/`money_movements:list` are all Owner/Admin-only in `authorize.ts` today, with no `SELF_ACCESS_ACTIONS` entry) and every other Epic 4 story's precedent. "Any authorized viewer" (epics.md's phrasing) is read as forward-looking language matching what Epic 5 will later broaden this to, not a mandate to build self-access now.
3. **Trace only real FK links; pool-level reference at the two places the system doesn't earmark specific rupees.** The app has never earmarked a specific investment to a specific withdrawal, or a specific balance-credit to a specific later spend — Should Pay/Can Take/Available Balance have always been Project- or party-pooled (Epic 3 onward). The trail is honest about this: a withdrawal's *upstream* is a `project_investment_pool` reference (the source Project's current total active-invested amount — a fact, not a specific row); an `"available_balance"` leg's *downstream* and an available-balance spend's *upstream* are both an `available_balance_pool` reference (the current balance for that `(partyType, shareId, projectId)` key). Both pool-reference node types are terminal (informational leaves) — they report an aggregate figure, they don't fan out into every other transaction that ever touched the same pool (that would be a much larger "full pool history" feature no AC asks for).
4. **Every other hop is a real, precise FK edge**, walked recursively via a new `packages/core` orchestration function (`assembleMoneyTrail()`, dependency-injected ports, mirrors `moveWithdrawalToProject()`'s DI shape, AD-9): `withdrawal_transaction` → its `withdrawal_destination_allocation` legs → (for a `"project"` leg) the linked `money_movement` → its destination `investment_transaction`; or (for an `"available_balance"` leg) the `available_balance_pool` reference; or (for `"person"`/`"other"`) a leaf. Backward, the same edges walked in reverse from a `money_movement` or `investment_transaction`.
5. **Reconciliation is a defensive verification pass**, not new business logic — the invariants it checks (a withdrawal's legs sum to its amount; a `money_movement`'s amount matches both its upstream leg/spend and its downstream `investment_transaction`) are already guaranteed by construction at write time (the same `amount` value flows through both writes in one atomic transaction, Stories 4.7-4.9). `reconcileMoneyTrail()` re-derives and re-checks these across the whole assembled tree, existing specifically to catch a future bug, bad migration, or manual DB edit that violates them — matching the AC's own framing ("so that I can trust the system's record").

## Boundaries & Constraints

**Always:** `assembleMoneyTrail()` takes dependency-injected ports (no Drizzle import, AD-9) and is unit-testable with in-memory fakes, mirroring `moveWithdrawalToProject()`'s precedent. Recursion tracks visited node ids and never re-expands one already in the current path (defensive cycle protection, even though the append-only FK structure shouldn't produce real cycles). Every new/extended port method this story adds is a pure, additive interface extension (Open/Closed, ISP) — nothing already-shipped is edited. The trail API is gated by `authorizeScope()` before any data read (AD-1).

**Never:** No new self-access/`SELF_ACCESS_ACTIONS` entries (this story's Decisions #2). No pool-reference node fans out into sibling transactions that share the same pool (this story's Decisions #3 — a pool reference is a terminal fact, not a further traversal). No dedicated Trail/TraceBanner UI or Money History screen (Story 5.2's job). No change to `moveWithdrawalToProject()`, `spendAvailableBalanceToProject()`, `buildTransactionSnapshot`, or any existing write-path function.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full worked example, viewed from the withdrawal | ₹10,00,000 invested → ₹5,00,000 withdrawn, split: ₹3,00,000 → Project B (project leg), ₹1,00,000 → a Person, ₹1,00,000 → Available Balance; later ₹30,000 spent from that balance into Project C | Trail root = the withdrawal; upstream = Project A's pool reference; downstream = 3 legs, the "project" leg's downstream reaches the Project B `investment_transaction`, the `"available_balance"` leg's downstream is the balance pool reference | N/A |
| Same worked example, viewed from the Project C investment_transaction (the later balance spend's destination) | Start at the auto-created Project C row | Upstream chain reaches: money_movement → available_balance_spend → available_balance_pool reference (terminal) | N/A |
| Same worked example, viewed from the original ₹10,00,000 investment (Project A) | Start at a manually-recorded Add Money row | No upstream (true origin); no downstream (pool-level, not FK-level, per Decisions #3) | N/A |
| Reconciliation, healthy chain | The full worked example above | `reconcileMoneyTrail()` returns `{ reconciled: true, discrepancies: [] }` | N/A |
| Reconciliation, a withdrawal with no allocation recorded yet | A withdrawal exists, Story 4.7's allocation was never saved for it | Zero legs is a valid, non-discrepant state (not every withdrawal has been allocated yet) — reconciled, not flagged | N/A |
| Starting entity doesn't exist | A well-formed but nonexistent uuid | Rejected | `404 not_found` |
| Starting entity type param invalid | An unrecognized `type` query value | Rejected | `400 validation_error` |
| Non-Owner/Admin caller | Any other role | Rejected before any data read | `403 forbidden` |
| Cross-Project trail | The worked example spans 3 different Projects | The trail correctly resolves entities across all 3 Projects in one response (the first genuinely cross-Project read in this app) | N/A |

</frozen-after-approval>

## Code Map

- `packages/types/src/index.ts` — new `MoneyTrailNodeType` (`"investment_transaction" | "withdrawal_transaction" | "withdrawal_destination_allocation" | "money_movement" | "available_balance_spend" | "project_investment_pool" | "available_balance_pool"`), `MoneyTrailNode` (recursive: `{ type: MoneyTrailNodeType; id: string; amount: Money; data: <type-specific fields, e.g. the underlying row for a real-entity node, or `{ projectId, totalActiveInvested }`/`{ partyType, shareId, projectId, balance }` for the two pool-reference types>; upstream: MoneyTrailNode[]; downstream: MoneyTrailNode[] }`), `MoneyTrailDiscrepancy`, `MoneyTrailReconciliationResult`.
- Port interface additions (each check-first: only add if genuinely missing — `InvestmentTransactionPort.findById` already exists, do not re-add):
  - `packages/core/src/withdrawal-transaction-port.ts` — add `findById(id: string): Promise<WithdrawalTransaction | null>`.
  - `packages/core/src/withdrawal-destination-allocation-port.ts` — add `findById(id: string): Promise<WithdrawalDestinationAllocation | null>`.
  - `packages/core/src/money-movement-port.ts` — add `findByDestinationInvestmentTransactionId(id: string): Promise<MoneyMovement | null>`, `findByWithdrawalDestinationAllocationId(id: string): Promise<MoneyMovement | null>`, `findByAvailableBalanceSpendId(id: string): Promise<MoneyMovement | null>` (each at-most-one by construction — every leg/spend produces at most one linked movement).
  - `packages/core/src/available-balance-port.ts` — add `AvailableBalancePort.findBalance(partyType, shareId, projectId): Promise<AvailableBalance | null>`; add `AvailableBalanceSpendPort.findById(id: string): Promise<AvailableBalanceSpend | null>`.
- `packages/db/src/ports.ts` — implement each new method above on the corresponding `createXPort()` factory (plain Drizzle `select().where(eq(...))`, mirrors every existing `findById`'s shape exactly).
- `packages/core/src/money-trail.ts` (new):
  - `MoneyTrailDeps` interface bundling every port method this needs (read-only: the `findById`/`findByX` methods above, plus `investmentTransactions.sumActiveAmountByProjectId` and `availableBalances.findBalance` for the two pool-reference node types — reuses existing 4.9 methods unchanged).
  - `assembleMoneyTrail(start: { type: MoneyTrailNodeType; id: string }, deps: MoneyTrailDeps): Promise<MoneyTrailNode>` — recursive async orchestration (AD-9, zero Drizzle imports), building each node type's `upstream`/`downstream` per this spec's Intent #3/#4 edge list exactly (an `investment_transaction`'s downstream is always `[]`; a pool-reference node's upstream/downstream are always `[]`; every other type follows the FK edges via the ports above). Tracks visited `(type, id)` pairs, stops recursing into one already on the current path.
  - Throws a new `MoneyTrailEntityNotFoundError` if `start` doesn't resolve.
- `packages/core/src/money-trail-reconciliation.ts` (new) — `reconcileMoneyTrail(trail: MoneyTrailNode): MoneyTrailReconciliationResult` — pure, synchronous, walks the tree: at a `withdrawal_transaction` node with ≥1 downstream leg, asserts `sumMoney(legs.map(amount))` equals the node's own amount (`moneyEquals`); at a `money_movement` node, asserts its `amount` equals both its single upstream node's and single downstream node's `amount`. Zero legs on a withdrawal is not a discrepancy (this spec's I/O matrix). Collects every failure into `discrepancies` rather than throwing (a caller wants to see all of them, not just the first).
- `packages/core/src/index.ts` — barrel-export both new modules.
- `packages/core/src/authorize.ts` — new action `money_trail:view` (Owner/Admin-only, matching every other Epic 4 read action).
- `apps/web/app/api/money-trail/route.ts` (new, **not** Project-scoped — a trail spans Projects) — `GET`, query params `type`/`id`. `authorizeScope()` first (AD-1), then validate `type` against `MoneyTrailNodeType` (400 if unrecognized), resolve the starting entity via the matching `findById` (404 if missing), then `assembleMoneyTrail()` with every port constructed, then `reconcileMoneyTrail()`, respond `{ trail, reconciliation }`.
- `apps/web/lib/money-trail.ts` (new) — client fetch helper `getMoneyTrail(type, id)`, for tests/live-verification use (no page consumes this yet, per this story's Decisions #1).

## Tasks & Acceptance

**Execution:**
- [x] `packages/types/src/index.ts` — `MoneyTrailNode`/`MoneyTrailNodeType`/`MoneyTrailDiscrepancy`/`MoneyTrailReconciliationResult`
- [x] Port additions (`findById` ×2, `findByX` ×3, `findBalance` ×1) across `withdrawal-transaction-port.ts`/`withdrawal-destination-allocation-port.ts`/`money-movement-port.ts`/`available-balance-port.ts` + `packages/db/src/ports.ts` implementations + tests (live-Postgres)
- [x] `packages/core/src/money-trail.ts` + tests — every node-type edge case from the Intent's edge list, cycle-protection, `MoneyTrailEntityNotFoundError`
- [x] `packages/core/src/money-trail-reconciliation.ts` + tests — healthy chain, zero-leg withdrawal (not a discrepancy), an injected mismatch (each of the two invariants) correctly flagged
- [x] `packages/core/src/authorize.ts` — `money_trail:view`
- [x] `apps/web/app/api/money-trail/route.ts` + tests — full I/O matrix
- [x] `apps/web/lib/money-trail.ts`

**Acceptance Criteria (from epics.md Story 4.10):**
- Given the full worked scenario, when the trail is viewed from any single transaction in the chain, then every linked transaction is reachable, forward and backward.
- Given this trail, when totals are checked at any point, then they reconcile exactly — nothing double-counted or lost.

## Implementation Notes

- **`MoneyMovementPort` has no `findById`-by-its-own-id method, by design.** The Code Map's port-addition list only calls for the three FK-shaped finders (`findByDestinationInvestmentTransactionId`/`findByWithdrawalDestinationAllocationId`/`findByAvailableBalanceSpendId`) — a `money_movements` row is never looked up by its own id anywhere else in this codebase either, only ever reached via one of its neighbors. `MoneyTrailDeps` and `assembleMoneyTrail()` were built around this: a `money_movement` node is only ever produced as part of building a neighboring node, never as a trail's own starting point.
- **`assembleMoneyTrail(start, deps)`'s `start.type` accepts the full `MoneyTrailNodeType` union (as the Code Map specifies) but only 4 of the 7 members resolve to a real lookup**: `investment_transaction`/`withdrawal_transaction`/`withdrawal_destination_allocation`/`available_balance_spend` — the ones with a genuine single-id `findById`. The remaining 3 (`money_movement`, `project_investment_pool`, `available_balance_pool`) throw `MoneyTrailEntityNotFoundError` if ever passed as `start` — defensively, since a pool reference is a derived fact with no single addressable row, and a `money_movement` is only ever reached via a neighbor (see above). The route layer pre-filters `type` against just those 4 startable values (400 `validation_error` for anything else, including these 3 syntactically-valid-but-never-startable type strings) so this defensive branch is never actually reached via the API in normal operation — it exists so `assembleMoneyTrail()` stays a total, correct function on its own regardless of caller discipline (e.g. a future direct `packages/core` caller, or Story 5.2's read path).
- **`MoneyTrailDeps` uses `Pick<>` on each full port interface** (e.g. `Pick<InvestmentTransactionPort, "findById" | "sumActiveAmountByProjectId">`) rather than depending on the full port interfaces the way `MoveWithdrawalToProjectDeps` does — a slightly stricter reading of ISP (AGENTS.md) than that precedent, since this orchestration function is read-only and only ever needs a narrow slice of each port. The route still constructs full `createXPort()` instances (`packages/db`'s factories only produce the full port shape) — the `Pick<>` narrowing is enforced at the type level on the `deps` parameter, not by a different runtime object.
- **`available_balance_pool` node's synthetic `id`** is `` `${partyType}:${shareId}:${projectId}` `` (no real row id exists when the balance was never credited — a missing row is a valid `"0"` pool, not a missing entity) — stable and unique per pool, joined with `:` mirroring `withdrawalShareKey`-style composite-key precedents elsewhere in this codebase.
- **Cycle protection also naturally produces intentional "backward-reference" stub nodes**, not just true-cycle defense: e.g. a `withdrawal_destination_allocation` leg's `upstream` is `[withdrawal_transaction]` — the same withdrawal the trail may have started at — which is exactly what the spec's Intent #4 ("Backward, the same edges walked in reverse...") calls for. When that back-reference is already on the current recursion path, it's returned as a terminal leaf (correct `type`/`id`/`amount`/`data`, but `upstream: []`/`downstream: []`) rather than re-expanded — this is what stops the naturally-bidirectional edge set from recursing forever, and is exercised directly by `money-trail.test.ts`'s cycle-protection test.
- **Live verification (2026-09-25)**: ran the full worked example against local Postgres via the real app API (login → create 3 Projects/funding requirements/100% Partner Shares each → record the ₹10,00,000 origin investment into Project A → record the ₹5,00,000 withdrawal → allocate it 3 ways (₹3,00,000 "project" leg to Project B, ₹1,00,000 "person" leg, ₹1,00,000 "available_balance" leg) → spend ₹30,000 from the resulting Available Balance into Project C) and `curl`'d `/api/money-trail` from the 3 starting points this spec's Verification section calls out. All three matched the I/O matrix's worked-example rows exactly (full node-by-node shapes confirmed, not just top-level fields), and `reconciliation` was `{ reconciled: true, discrepancies: [] }` in every case. Also spot-checked live: 401 (no session), 400 (`type=bogus`), 404 (well-formed-but-nonexistent id and a non-UUID-shaped id, both without hitting the DB for the latter). Test data cleaned up from local Postgres afterward.

## Spec Change Log

## Review Triage Log

3-layer review (blind-hunter, edge-case-hunter, verification-gap) — no functional bugs found. Two independent reviewers hand-traced `assembleMoneyTrail()`'s recursion, including the highest-risk scenario this story's review was specifically asked to scrutinize (a withdrawal with 3 legs, starting from one leg, walking backward to the withdrawal, checking sibling legs B/C aren't hidden by cycle protection) — confirmed correct: path-scoped `Set` copies per recursive branch, never a globally-scoped visited set. All 3 findings were test-coverage gaps, applied in one patch round (2026-09-25):

1. **[High, verification gap] The cycle-protection test didn't actually prove the sibling-survives-backward-traversal guarantee** — it only checked the immediate parent/child bounce, never inspected a leg-first trail's `upstream[0].downstream` for the other legs. Added a test starting from one leg of a 3-leg withdrawal, asserting all 3 legs appear correctly in the parent's downstream (the starting leg as a terminal stub, the other two fully expanded).
2. **[Medium, verification gap] The `"other"` destination-allocation leg type was never exercised.** Added a test confirming it resolves as a leaf, matching `"person"`'s existing fallthrough.
3. **[Medium, verification gap] `available_balance_pool`'s "never credited → 0" fallback was untested at the trail-assembly layer** (only the underlying port's own null-return was tested). Added a test asserting the pool node's amount/balance resolves to `"0"`, not a crash.

Deferred (logged to `deferred-work.md`, not this round): `reconcileMoneyTrail()`'s `visited` set is globally-scoped rather than path-scoped, unlike `assembleMoneyTrail()`'s — confirmed not exploitable under the current schema (no entity in this domain is created by more than one write path, so no genuine lateral convergence is possible today); worth hardening only if a future story changes that.

Post-patch: `pnpm turbo run test lint typecheck build --force --concurrency=1`, `pnpm lint:boundaries`, `pnpm audit` all green (core 546 tests, db 211, web 636).

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `money-trail.test.ts` covers every node type's upstream/downstream shape (in-memory fake ports) incl. both pool-reference terminal cases and cycle-protection; `money-trail-reconciliation.test.ts` covers a healthy tree, a zero-leg withdrawal, and an injected discrepancy at each of the two checked invariants
- `pnpm --filter @niveshbook/db test` — expected: live-Postgres tests for each new `findById`/`findByX`/`findBalance` port method (found + not-found cases)
- `pnpm --filter @niveshbook/web test` — expected: route test covers the full I/O matrix incl. `400`/`404`/`403`
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm lint:boundaries` — expected: clean
- **Live verification:** build the full worked example (invest → withdraw split 3 ways → later spend from Available Balance into a third Project) against local Postgres, then `curl` the trail API from at least three different starting points (the original investment, the withdrawal, the later cross-project investment_transaction) and confirm each correctly reaches every other linked entity forward and backward, and that `reconciliation.reconciled` is `true` throughout.

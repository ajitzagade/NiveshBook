---
title: 'Money History List'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '96fba52249508a431da1c31c6da2f085595f6141'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR-31 asks for one plain-language, filterable transaction log spanning Add Money, Withdraw Money, Movement, and Available Balance activity. Nothing today unifies these 6 source tables (`investment_transactions`, `withdrawal_transactions`, `withdrawal_destination_allocations`, `money_movements`, `available_balances`, `available_balance_spends`) into one list — every existing read is single-table, single-parent-scoped, unfiltered. There's also no existing precedent for cross-Project self-access scoping (every Epic 4 list stayed Owner/Admin-only, with self-access explicitly deferred to "Epic 5" by name in multiple `authorize.ts` comments) or for filtered/paginated multi-table reads.

**Approach:** Confirmed with the user 2026-09-25:
1. **Real self-access, built now.** A new `"money_history:list"` action grants all three roles (`owner_admin`/`partner`/`sub_partner`) — unlike the existing `SELF_ACCESS_ACTIONS`/`SCOPE_SELF_ACCESS_ACTIONS` mechanisms (shaped for "does actor own *this one* target resource"), this story needs "what's actor's own scope across a *list assembly*," a genuinely new shape. A new pure `resolveMoneyHistoryScope()` (packages/core) computes it: unrestricted for `owner_admin`, or the exact set of `(partyType, shareId, projectId)` triples matching the actor's own current Partner/Sub-partner Shares (via `userId`) for `partner`/`sub_partner`. The dashboard shell itself (`requireOwnerAdminSession()`) stays Owner/Admin-gated regardless — reachability via UI is Story 5.4-5.6's job, not this story's; this only means the API is correctly scoped starting now instead of needing retrofitting later.
2. **A cross-Project movement produces two entries, one per Project's own view** — not a merged single row. Project A's history shows the outbound `"moved_to_project"` leg; Project B's history shows an inbound `"money_added"` entry with `from` populated (reusing Story 4.8's exact "Moved from Project A" `money_movements` lookup already built for the Add Money page). This mirrors a bank statement showing a transfer on both accounts — not double-counting, two real events.
3. **"Adjustment" entries are omitted entirely this story.** `investment_adjustments`/`withdrawal_adjustments` are single-current-row upserts, not append-only history (Story 3.4/4.3's design) — showing them as "history" would misrepresent data that silently changes on every recompute. The real AD-4 audited netting-transaction type this label refers to is Story 5.3's job to create; `MoneyHistoryEntryType` simply has no `"adjustment"` member yet, added when that data exists.
4. **Assembly (labeling/filtering/scoping) is a pure `packages/core` function**, not `apps/web`+`packages/db`-only as the architecture spine's capability-map row loosely suggested — this follows the codebase's actual established convention (pure shaping in core, simple fetches in db) rather than a stale architecture-doc row written before Epic 3/4's granular precedents existed.
5. **Filter/sort entirely in-memory in the pure assembly function, not via per-table SQL WHERE clauses.** Each of the 6 tables gets a simple new `listAll()` fetch (mirroring `PartnerSharePort.listAll()`'s existing Story 2.7 precedent), and `assembleMoneyHistory()` filters/sorts the unified, already-labeled list. Matches this app's "small-to-medium data volume" NFR; trades a future performance concern for correctness-in-one-place now.
6. **No pagination this story** — not asked for by the AC, scoped out explicitly rather than silently built.

## Boundaries & Constraints

**Always:** `authorizeScope("money_history:list", ...)` runs before any data fetch (AD-1). `resolveMoneyHistoryScope()` and `assembleMoneyHistory()` are pure (AD-9, no DB imports) and independently unit-testable. A `"project"`-type leg/spend's destination `investment_transactions` row is identified via the existing `money_movements` FK lookups (Story 4.8/4.10's established pattern), never a new heuristic.

**Never:** No new `SELF_ACCESS_ACTIONS`/`SCOPE_SELF_ACCESS_ACTIONS` entries — `money_history:list`'s scoping is a new, separate mechanism (this story's Decisions #1), those two existing sets stay untouched. No `"adjustment"` entries or `MoneyHistoryEntryType` member this story (Decisions #3). No change to `assembleMoneyTrail()`/`reconcileMoneyTrail()` (Story 4.10) — this story reuses only the FK-relationship *knowledge* those functions encode, not a call into them (a per-row recursive trail walk would be one multi-table query per row, not a batched list). No relaxation of `requireOwnerAdminSession()`/the dashboard shell gate (Decisions #1, Story 5.4-5.6's job).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Manual Add Money entry | An `investment_transactions` row with no linked `money_movements` destination | `"money_added"`, `from: null` | N/A |
| Cross-project movement, destination side | An `investment_transactions` row that IS a `money_movements` destination | `"money_added"`, `from: <source Project name>` | N/A |
| Withdrawal | A `withdrawal_transactions` row | `"money_withdrawn"` | N/A |
| "project" leg | A `withdrawal_destination_allocations` row, `destinationType: "project"` | `"moved_to_project"`, `to: <destination Project name>` | N/A |
| "person" leg | `destinationType: "person"` | `"given_to_person"`, `to: <personName>` | N/A |
| "available_balance" leg | `destinationType: "available_balance"` | `"added_to_available_balance"`, `to: "Available Balance"` | N/A |
| "other" leg | `destinationType: "other"` | `"given_to_person"`-shaped entry, `to: "Other"`, `notes` carries the description (no 7th type invented, this spec's Decisions) | N/A |
| Available Balance spend, "project" destination | An `available_balance_spends` row | `"used_from_available_balance"`, `from: "Available Balance"`, `to: <destination Project name>` | N/A |
| Available Balance spend, "person" destination | Same table, `destinationType: "person"` | `"used_from_available_balance"`, `to: <personName>` | N/A |
| Owner/Admin views the list | Any filter combination | Every entry across every Project, filtered only by the query params | N/A |
| Partner views the list | Same | Only entries matching their own current `(partyType, shareId, projectId)` triples — across ALL their Projects | N/A |
| Sub-partner views the list | Same | Only entries matching their own current Sub-partner Share triples | N/A |
| Date/Project/Person filter combined | Multiple filters supplied | Entries matching ALL supplied filters (AND, not OR) | N/A |
| Non-authorized caller | No session, or a role somehow not in `{owner_admin, partner, sub_partner}` | Rejected before any data fetch | `401`/`403` |

</frozen-after-approval>

## Code Map

- `packages/types/src/index.ts` — new `MoneyHistoryEntryType` (`"money_added" | "money_withdrawn" | "moved_to_project" | "given_to_person" | "added_to_available_balance" | "used_from_available_balance"` — no `"adjustment"`), `MoneyHistoryEntry` (`id, type, date, projectId, projectName, partyType, shareId, personName: string | null, amount, paymentMode: PaymentMode | null, from: string | null, to: string | null, notes: string | null`).
- Port additions (each mirrors `PartnerSharePort.listAll()`'s existing shape exactly — plain, unfiltered, no pagination):
  - `packages/core/src/subpartner-share-port.ts` — add `listAll(): Promise<SubPartnerShare[]>`.
  - `packages/core/src/investment-transaction-port.ts` — add `listAll(): Promise<InvestmentTransaction[]>`.
  - `packages/core/src/withdrawal-transaction-port.ts` — add `listAll(): Promise<WithdrawalTransaction[]>`.
  - `packages/core/src/withdrawal-destination-allocation-port.ts` — add `listAll(): Promise<WithdrawalDestinationAllocation[]>`.
  - `packages/core/src/money-movement-port.ts` — add `listAll(): Promise<MoneyMovement[]>`.
  - `packages/core/src/available-balance-port.ts` — add `AvailableBalanceSpendPort.listAll(): Promise<AvailableBalanceSpend[]>`.
- `packages/db/src/ports.ts` — implement each new `listAll()` (plain `select().from(table)`, mirrors `createPartnerSharePort.listAll`'s existing shape).
- `packages/core/src/subpartner-share.ts` — add `listAllCurrentSubPartnerShares(deps): Promise<SubPartnerShare[]>`, mirroring `listAllCurrentPartnerShares()`'s exact shape (`partner-share.ts`) one level down, sourced from the new `subPartnerShares.listAll()`.
- `packages/core/src/money-history.ts` (new):
  - `MoneyHistoryScope = { unrestricted: true } | { unrestricted: false; shareKeys: ReadonlySet<string> }` (`shareKeys` entries are `` `${partyType}:${shareId}:${projectId}` ``, mirroring Story 4.10's `available_balance_pool` synthetic-id precedent).
  - `resolveMoneyHistoryScope(actorRole, actorUserId, allPartnerShares, allSubPartnerShares): MoneyHistoryScope` — pure. `owner_admin` → `{ unrestricted: true }`. `partner`/`sub_partner` → filters both share lists to `userId` case-insensitively matching `actorUserId` (mirrors `authorize.ts`'s existing case-insensitive `ownerId` comparison convention), builds the `shareKeys` set.
  - `MoneyHistoryFilters = { dateFrom?: string; dateTo?: string; projectId?: string; partyType?: PartyType; shareId?: string; personName?: string }`.
  - `MoneyHistoryRawData` — bundles every already-fetched raw row list (`investmentTransactions`, `withdrawalTransactions`, `withdrawalDestinationAllocations`, `moneyMovements`, `availableBalanceSpends`) plus a `projectNamesById: Record<string, string>` lookup.
  - `assembleMoneyHistory(raw: MoneyHistoryRawData, scope: MoneyHistoryScope, filters: MoneyHistoryFilters): MoneyHistoryEntry[]` — pure. Builds a `Set<string>` of `money_movements.destinationInvestmentTransactionId` once, up front, to classify each `investment_transactions` row as a plain add vs. a movement destination (`from` populated via the movement's `sourceProjectId` → `projectNamesById`) — mirrors `add-money/page.tsx`'s existing "Moved from Project A" lookup exactly, one level over. Produces one entry per source row per this spec's I/O matrix, applies `scope` (drop any entry whose own share key isn't in `shareKeys`, when not unrestricted), then `filters` (AND, not OR), then sorts by `date` descending.
- `packages/core/src/index.ts` — barrel-export the new module.
- `packages/core/src/authorize.ts` — new action `"money_history:list"`, `PERMISSIONS` entry `new Set(["owner_admin", "partner", "sub_partner"])` — a plain multi-role grant, not a `SELF_ACCESS_ACTIONS`/`SCOPE_SELF_ACCESS_ACTIONS` entry (this story's Decisions #1; that mechanism only handles "does actor own this one resource," not list-scope resolution).
- `apps/web/app/api/money-history/route.ts` (new, **not** Project-scoped, mirrors `/api/money-trail`'s precedent) — `GET`, query params `dateFrom`/`dateTo`/`projectId`/`partyType`/`shareId`/`personName`. `authorizeScope("money_history:list", ...)` first, then resolve actor's role: `owner_admin` → `{ unrestricted: true }`; else fetch `listAllCurrentPartnerShares()`/`listAllCurrentSubPartnerShares()` and call `resolveMoneyHistoryScope()`. Fetches all 6 `listAll()`s + `listProjects()` (for `projectNamesById`) in parallel, calls `assembleMoneyHistory()`, responds `{ entries }`.
- `apps/web/lib/money-history.ts` (new) — client fetch helper `getMoneyHistory(filters)`.
- `apps/web/app/(dashboard)/layout.tsx` — flip the `moneyHistory` nav item to `href: "/money-history"` (mirrors Withdraw Money/Available Balance's own activation precedent) — but see this story's Decisions #1: the page itself is still unreachable in practice via `requireOwnerAdminSession()` for non-Owner/Admin, this only activates it for Owner/Admin today.
- `apps/web/app/(dashboard)/SidebarNav.tsx` — add the `moneyHistory` case to `isActive()`.
- `apps/web/app/(dashboard)/money-history/page.tsx` (new, not Project-scoped) — `PageHeader`, `EmptyState` (no entries), filter controls (date range, Project `<select>` via `listProjects()`, person text filter), a `Table` of entries (Date/What Happened/Project/Person/Amount/Payment Mode/From/To/Notes per the AC's literal 9 columns — the mockup's compact "arrow-in-one-cell" convention is a visual choice the implementer may apply within the Table component as long as all 9 data fields are present and readable, not omitted).

## Tasks & Acceptance

**Execution:**
- [x] `packages/types/src/index.ts` — `MoneyHistoryEntryType`/`MoneyHistoryEntry`
- [x] 6 port `listAll()` additions + `packages/db/src/ports.ts` implementations + tests (live-Postgres)
- [x] `packages/core/src/subpartner-share.ts` — `listAllCurrentSubPartnerShares` + tests
- [x] `packages/core/src/money-history.ts` + tests — `resolveMoneyHistoryScope`, `assembleMoneyHistory` covering every I/O matrix row, both scope cases, combined filters
- [x] `packages/core/src/authorize.ts` — `money_history:list`
- [x] `apps/web/app/api/money-history/route.ts` + tests — full I/O matrix incl. both scope cases
- [x] `apps/web/lib/money-history.ts`
- [x] `apps/web/app/(dashboard)/money-history/page.tsx` + test — list rendering, filters, empty state
- [x] `apps/web/app/(dashboard)/layout.tsx` + `SidebarNav.tsx` — activate the nav item

**Acceptance Criteria (from epics.md Story 5.1):**
- Given transactions exist across Add Money, Withdraw Money, Movement, and Available Balance actions, when an authorized user opens Money History, then they see Date, What Happened, Project, Person, Amount, Payment Mode, From, To, Notes.
- Given the list, when filtered by date, project, or person, then only matching entries are shown.
- Given a Partner viewing Money History, when the list loads, then it's scoped by the same `authorize()`/`authorizeScope()` gate as everywhere else — no entry outside their permitted scope appears.

## Implementation Notes

- **`MoneyHistoryRawData` widened beyond the original Code Map to resolve the AC's "Person" column.** The Code Map's raw-data list only named `projectNamesById`, but the AC requires a populated "Person" column for every entry, and nothing in the I/O matrix's `personName`/`to` handling gives that for `money_added`/`money_withdrawn`/`moved_to_project`/`added_to_available_balance`/`used_from_available_balance`-to-project entries (a `"given_to_person"` entry's own free-text destination name already fills its own `to` field, per the I/O matrix — reusing it for `personName` too would just duplicate `to`). Resolved by adding `partnerNamesById`/`subPartnerNamesById` (current-share-id → name lookups) to `MoneyHistoryRawData`, populated by `resolvePersonName()` for every entry type via each entry's own `(partyType, shareId)` — i.e. `personName` consistently means "whose Should Pay/Can Take this event is about," never a destination's own free-text name. `GET /api/money-history` now always fetches `listAllCurrentPartnerShares()`/`listAllCurrentSubPartnerShares()` (previously the Code Map only called for this on the non-`owner_admin` scoping branch) — used for both `resolveMoneyHistoryScope()` (unchanged) and this new name-resolution pass, so `owner_admin` gets populated Person names too, not just Partner/Sub-partner viewers.
- **`personName` filter semantics follow from the above:** `MoneyHistoryFilters.personName` is a case-insensitive substring match against the *resolved party name* (the "Person" column), not against a `"given_to_person"`/`used_from_available_balance`-to-person entry's own free-text destination name (that's searchable via the `to` field showing in the UI, but there's no separate `to`-filter query param this story — out of the frozen I/O matrix's scope, not added speculatively).
- **A `withdrawal_destination_allocations` leg's `date`/`partyType`/`shareId`/`paymentMode`/`projectId` are all resolved by joining its parent `withdrawal_transactions` row** (via `withdrawalTransactionId`, against a `Map` built once in `assembleMoneyHistory()`) — a leg row carries none of these directly. A leg whose parent can't be found (a data-integrity edge case, never expected in practice) is silently skipped rather than thrown on, keeping the function total.
- **`available_balance_spends.date` is derived from `createdAt`'s ISO-date prefix** (`.slice(0, 10)`) — that table has no separate `transactionDate` column (a spend is always recorded "now," unlike a manually-dated Add Money/Withdraw Money entry).
- **Every `investment_transactions`/`withdrawal_transactions` row is included in Money History regardless of `status`** (`"active"`/`"cancelled"`) — a cancelled original and its linked reversal row both appear as separate entries. ~~`MoneyHistoryEntry` carries no `status` field this story~~ **Superseded by review round 2** (see below): a cancelled original and its reversal were rendering as pixel-identical, unmarked duplicate rows with zero way to tell one was void — a real trust bug given this story's own persona goal. Fixed by adding `status`/`reversalOfTransactionId` to `MoneyHistoryEntry` after all.

### Review round 2 patch (edge-case-hunter + verification-gap findings)

- **`MoneyHistoryEntry` gained `status: "active" | "cancelled"` and `reversalOfTransactionId: string | null`**, threaded through from the underlying row: `investment_transactions`/`withdrawal_transactions`-derived entries use their own row's `status`/`reversalOfTransactionId` directly; a leg-derived entry (`moved_to_project`/`given_to_person`/`added_to_available_balance`/the `"other"`-shaped `given_to_person`) uses its PARENT withdrawal's `status` (a cancel never touches `withdrawal_destination_allocations`/`money_movements` rows directly, per `WithdrawalTransactionPort.cancelTransaction`'s own doc comment, so there is no separate "leg reversal" — `reversalOfTransactionId` is always `null` for a leg entry); `available_balance_spends`-derived entries are always `status: "active"`/`reversalOfTransactionId: null` (no cancel capability exists for spends anywhere in this codebase). The page renders the exact same `StatusChip` "Cancelled"/"Cancelled (reversal)" convention already established on `RecordedPayments`/`RecordedWithdrawals` (Story 3.7/3.8/4.11) inline in the "What Happened" cell — no new visual convention invented, no new column added (the frozen AC's 9 columns are unchanged).
- **Logged, not fixed this round:** a cancelled `"available_balance"` leg's `debitBalance()` reverses the `available_balances` pool in place with zero append-only trail — Money History has no read path onto `available_balances` at all (only `available_balance_spends`), so the original "Added to Available Balance" entry stays displayed as if still live. The `status` fix above at least marks that leg's own entry as "Cancelled" (via the parent withdrawal's status), which partially mitigates this, but the deeper pool-level invisibility is a separate, larger gap (no audit trail for balance-pool mutations at all) — deferred to `deferred-work.md`, not built here.
- **Fixed a real name-collapse bug:** `partnerNamesById`/`subPartnerNamesById` (and `resolvePersonName()`'s lookup) are now keyed by `` `${shareId}:${projectId}` `` (via the new exported `moneyHistoryPersonNameKey()`) instead of `shareId` alone — `PartnerShare.name`/`SubPartnerShare.name` are stored per-row (per Project), so the same stable `partnerId` can legitimately carry a different name on a different Project's Share row; a `shareId`-only key silently collapsed to whichever row `Object.fromEntries` iterated last, showing that one name for every entry regardless of which Project it actually came from.
- **Added test coverage for 4 previously-untested scope branches:** the 4 leg-derived entry types and the `available_balance_spends`-derived type were only ever exercised under `UNRESTRICTED` scope in `money-history.test.ts` — added restricted-scope tests for each, proving in-scope legs/spends survive and out-of-scope ones are dropped.
- **Strengthened the route test (`apps/web/app/api/money-history/route.test.ts`)** with one comprehensive fixture populating all 6 source-table mocks in a single pass (a manual Add Money entry, a full cross-project movement — leg + linked movement + auto-created destination investment row — and an Available Balance spend), proving the route's DB-port wiring end to end rather than relying on `core`'s already-exhaustive pure-function coverage alone.
- **Added a multi-row `listAll()` live-Postgres test** (`money-history-ports.test.ts`, `investmentTransactionPort`) seeding 2 rows across 2 different requirements/Projects and asserting both come back from one `listAll()` call — derisks the identical one-line `select().from(table)` pattern shared by all 6 new port methods (a prior single-row-seeded test per port couldn't have caught a `LIMIT 1` or a stray filter).
- **Added tests proving the new cancelled/reversal display behavior** — both at the `assembleMoneyHistory()` level (5 new tests: investment/withdrawal cancel pairs, an active entry, a leg inheriting its parent's cancelled status, and a spend always `"active"`) and at the page level (one new render test confirming the `StatusChip` actually appears in the DOM, both rows marked, only the reversal carrying the "(reversal)" suffix).

- **Live verification performed** (local Postgres reachable via the project's existing docker-compose service): seeded two Projects with a cross-project movement (a Withdrawal on Project Alpha with a `"project"` destination leg into Project Beta, plus an `"available_balance"` leg and a subsequent Use-Balance-to-Person spend) and a Partner Share linked to the same `userId` on both Alpha and Beta. Confirmed via `assembleMoneyHistory()` directly against live-fetched data that Alpha's filtered view shows the outbound `moved_to_project` entry (`to: "MH Verify Beta"`) and Beta's filtered view shows the inbound `money_added` entry (`from: "MH Verify Alpha"`) — the two-sided, not-double-counted shape spec-5-1's Decisions #2 calls for. Confirmed date/person filters each narrow correctly (person filter matches the resolved party name, per the note above). Then started `next dev`, logged in via real `/api/auth/login` sessions for a seeded `owner_admin`, `partner` (linked on both Projects), and `sub_partner` (unlinked) user, and curled `GET /api/money-history` directly: owner_admin got every entry across every Project (31, including pre-existing data from other stories' own live-verification runs); the linked partner got exactly the 6 entries belonging to their own shares across both Projects; the unlinked sub_partner got 0. All fixtures were cleaned up afterward (verified via a direct Postgres count that no `mh-verify-*`-prefixed rows remain).

## Spec Change Log

## Review Triage Log

3-layer review (blind-hunter, edge-case-hunter, verification-gap) — blind-hunter confirmed the self-access scoping architecture itself is sound (the filter applies uniformly post-build across all entry types, structurally ruling out a "one branch forgot to filter" bug class), but edge-case-hunter surfaced a real cross-story interaction with Story 4.11's cancel/reverse feature, and verification-gap found real test-coverage gaps. All 7 findings applied in one patch round (2026-09-25), detailed in Implementation Notes' "Review round 2 patch" section above:

1. **[Medium-High, real UX/trust bug]** Cancelled transactions and their Story 3.8/4.11 reversal rows rendered as pixel-identical, unmarked duplicate entries — actively misleading for a cross-project cancel, since the withdrawal and destination investment both doubled while the allocation leg stayed singular, breaking reconciliation. Fixed: `MoneyHistoryEntry` gained `status`/`reversalOfTransactionId`, rendered via the established `StatusChip` "Cancelled"/"Cancelled (reversal)" convention.
2. **[Medium, real gap, deferred not fixed]** `available_balances` pool debit-reversals have zero append-only trail — logged to `deferred-work.md`, needs a new ledger table, out of scope for a display patch.
3. **[Low, real bug]** `partnerNamesById`/`subPartnerNamesById` collapsed per-project name variation to one arbitrary value (keyed by `shareId` alone). Fixed: keyed by `${shareId}:${projectId}` composite.
4. **[High, verification gap]** Scope filtering was untested for 4 of 8 entry-type branches (legs and spends). Fixed: added restricted-scope tests for each.
5. **[Medium, verification gap]** Route test's "full I/O matrix" claim was overstated (only 1 of 6 source tables populated in any test). Fixed: strengthened with one comprehensive 6-table fixture.
6. **[Medium, verification gap]** Live-Postgres `listAll()` tests only proved "at least one," not "all." Fixed: added a multi-row test.
7. **[Medium, verification gap]** No test proved the cancelled/reversal display behavior. Fixed: added core-level and page-level tests.

Post-patch: `pnpm turbo run test lint typecheck build --force --concurrency=1`, `pnpm lint:boundaries`, `pnpm audit` all green (core 625 tests, db 244 tests, web 689 tests).

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `money-history.test.ts` covers every I/O matrix row's label/from/to mapping, both `resolveMoneyHistoryScope` branches, combined-filter AND semantics
- `pnpm --filter @niveshbook/db test` — expected: live-Postgres tests for each new `listAll()`
- `pnpm --filter @niveshbook/web test` — expected: route test covers the full I/O matrix incl. both scope cases; page test covers rendering, filters, empty state
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm lint:boundaries` — expected: clean
- **Live verification:** as Owner/Admin, build a cross-project movement (withdrawal → "project" leg → destination) and an Available Balance spend, confirm both Projects' filtered views show the correct two-sided entries; confirm date/project/person filters each narrow correctly; confirm `authorizeScope`'s role grant is correct for all three roles even though the UI itself remains unreachable for non-Owner/Admin today (curl the API directly with a partner/sub_partner session to confirm scoping).

---
title: 'Adjust Next Time Page'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '2e1459bb9f1be5103b85f803274bece2ab966af4'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR-33/FR-34 ask for one page showing carried-forward Investment and Withdrawal Adjustments in plain language, never auto-netted, plus an explicit Owner/Admin netting action recorded as its own audited transaction type (AD-4) and visible in Money History as "Adjustment" — the exact entry type Story 5.1 deliberately left unbuilt, naming this story as its source. No worked example for netting's actual mechanics exists anywhere in the PRD/epics/architecture docs, unlike every other calculation in this app.

**Approach:** Confirmed with the user 2026-09-25:
1. **Netting is a pure audit record, with zero computed effect on either ledger.** A new `adjustment_nettings` table records "Owner/Admin declares ₹X netted between this person's Investment Adjustment (at a specific funding requirement) and Withdrawal Adjustment (at this Project)" — `investment_adjustments`/`withdrawal_adjustments` themselves are NEVER written to by this action, stay exactly as freshly recomputed from Should Pay/Can Take (AD-4's literal "never a side effect of either cycle's calculation"). The record's only effect is existing, permanently, as a transparent, audited fact — visible in Money History as "Adjustment" — documenting an out-of-band business decision, not a recalculation.
2. **Netting is anchored to a specific investment requirement, not just a Project.** ~~`investment_adjustments` is keyed by `(partyType, shareId, projectId, requirementId)` — a person can have several across different funding rounds within one Project~~ **[Corrected 2026-09-25, see Spec Change Log — factual error found during review]:** `investment_adjustments` has exactly ONE current row per `(partyType, shareId, projectId)` (Story 3.4's unique constraint does not include `requirementId`) — a person cannot have multiple simultaneous rows at the same Project; `requirementId` records only which funding round that single row's numbers were *last* computed against, and gets silently overwritten (along with `shouldPay`/`actualPaid`/`adjustmentAmount`/`adjustmentType`) whenever a later requirement's calculation runs. `withdrawal_adjustments` is likewise Project-scoped, one row per person. A netting record still references the specific `investment_adjustments` row's `requirementId` at netting time (an explicit, permanent fact about what was netted then, even if that row is later overwritten) alongside that same person's `withdrawal_adjustments` row at that Project — but the real, reachable ambiguity this design must guard against is a person having *independent* current rows at *different* Projects (each Project has its own single row), not multiple rows within one Project.
3. **Real self-access, matching Story 5.1/5.2's established precedent.** New `"adjust_next_time:view"` action (plain multi-role grant: `owner_admin`/`partner`/`sub_partner`, mirrors `money_history:list`'s exact shape) — reuses `resolveMoneyHistoryScope()` (Story 5.1) UNCHANGED for scope resolution, since the scoping shape (which `(partyType, shareId, projectId)` triples the actor may see) is identical. `"adjustment_nettings:create"` stays Owner/Admin-only (no self-access — matches the AC's "an Owner/Admin explicitly performs" framing).
4. **"Adjustment" entries are Money-History-visible but NOT trail-startable.** A netting record has no linked money movement to trace (nothing moved) — `MoneyTrailNodeType`/`assembleMoneyTrail()` (Story 4.10, frozen) are NOT extended; the Money History page simply omits the trace/click affordance for `"adjustment"`-type rows, which is the correct behavior for a fact with no chain to follow, not a workaround.
5. **`investment_adjustments`/`withdrawal_adjustments` gain `listAll()`**, mirroring every other port's identical Story 5.1 precedent (`PartnerSharePort.listAll()`'s original shape) — no filtered/paginated query, filter/sort happens in a pure `packages/core` assembly function exactly like `assembleMoneyHistory()`.

## Boundaries & Constraints

**Always:** `authorizeScope("adjust_next_time:view", ...)` runs before any data fetch (AD-1); `adjustment_nettings:create` likewise. The netting write is one DB transaction + one `audit_log` row + a client idempotency key (AD-5), mirroring every other financial write in this codebase. Investment and Withdrawal Adjustment sections are always rendered/fetched independently — never combined, summed, or displayed as one net figure anywhere on the page (AC3, frozen). The plain-language labels (`ADJUSTMENT_LABEL` for both `extra_paid`/`pending`/`none` and `keep_for_later`/`extra_taken`/`none`) are reused verbatim from `add-money/page.tsx`/`withdraw-money/page.tsx` — never reworded.

**Never:** No write path anywhere touches `investment_adjustments.adjustmentAmount`/`adjustmentType` or `withdrawal_adjustments`' equivalents as a result of netting — both stay upsert-from-computation-only, exactly as Story 3.4/4.3 built them. No change to `assembleMoneyTrail()`/`reconcileMoneyTrail()`/`MoneyTrailNodeType` (Story 4.10) — "Adjustment" entries are display-only in Money History, never a trail node. No new `SELF_ACCESS_ACTIONS`/`SCOPE_SELF_ACCESS_ACTIONS` entry — `adjust_next_time:view` is a plain role-table grant like `money_history:list`, not an override.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Investment section, multiple people (AC1) | Partner A: Extra Paid ₹2,00,000; Partner C: Pending ₹2,00,000 | Each shown clearly — "Next time reduce by ₹2,00,000" (Extra Paid) / "Next time add ₹2,00,000" (Pending) — no formula | N/A |
| Withdrawal section (AC2) | Partner B: Keep for Later ₹1,50,000 | Shown in the Withdrawal section, separate from Investment | N/A |
| Both sections never netted (AC3) | Any state | No combined/summed figure anywhere on the page | N/A |
| One person, investment adjustments at multiple Projects | Two different Projects, each with its own single current investment_adjustments row for that person | Two separate Investment section rows for that person (one per Project) — never merged; the netting dialog for each clearly identifies which Project it's netting (corrected scenario — see Spec Change Log; same-Project multiple rows is not a reachable state) | N/A |
| Owner/Admin performs a netting action (AC4) | A specific investment_adjustments row (requirement) + that person's withdrawal_adjustments row, an amount, optional notes | A new `adjustment_nettings` row recorded, one `audit_log` row, one DB transaction; `investment_adjustments`/`withdrawal_adjustments` themselves UNCHANGED | N/A |
| Netting appears in Money History | After the above | A new `"adjustment"` entry, labeled "Adjustment", no trace/click affordance (nothing to trail) | N/A |
| Non-Owner/Admin attempts to net | Any other role | Rejected before any write | `403 forbidden` |
| Partner/Sub-partner views the page | Any state | Only their own current share's Investment/Withdrawal Adjustment rows across all their Projects — reuses `resolveMoneyHistoryScope()` unchanged | N/A |
| Idempotent replay of a netting action | Same idempotencyKey, identical content | 200 replay, no duplicate row | N/A |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema.ts` — new `adjustmentNettings` table: `id` uuid PK, `projectId` uuid notNull references `projects.id`, `partyType` text notNull, `shareId` uuid notNull, `investmentRequirementId` uuid notNull references `investment_requirements.id`, `amount` numeric(14,2) notNull, `notes` text nullable, `idempotencyKey` text notNull unique, `actorUserId` uuid notNull references `users.id`, `createdAt` timestamptz notNull defaultNow().
- `packages/db/drizzle/*` — generate migration.
- `packages/types/src/index.ts` — new `AdjustmentNetting` type; extend `MoneyHistoryEntryType` with `"adjustment"`.
- Port additions (mirror `PartnerSharePort.listAll()`'s exact shape):
  - `packages/core/src/investment-adjustment-port.ts` — add `listAll(): Promise<InvestmentAdjustment[]>`.
  - `packages/core/src/withdrawal-adjustment-port.ts` — add `listAll(): Promise<WithdrawalAdjustment[]>`.
  - `packages/core/src/adjustment-netting-port.ts` (new) — `AdjustmentNettingPort { recordNetting(input, idempotencyKey, actorUserId): Promise<{ netting: AdjustmentNetting; created: boolean }>; listAll(): Promise<AdjustmentNetting[]> }` — mirrors `WithdrawalTransactionPort.recordTransaction`'s exact idempotent-write contract (check-first-then-insert, one `audit_log` row, AD-5).
- `packages/db/src/ports.ts` — implement the 3 new/extended port methods (plain fetch/insert, mirrors every existing precedent).
- `packages/core/src/adjust-next-time.ts` (new) — pure `MoneyHistoryScope`-typed scope filter (reuses `resolveMoneyHistoryScope()` from `money-history.ts` unchanged, imported not re-derived) applied to `investmentAdjustments`/`withdrawalAdjustments` lists; no new scope-resolution logic.
- `packages/core/src/money-history.ts` — extend `assembleMoneyHistory()` with a new `buildAdjustmentNettingEntries()` branch (type `"adjustment"`, `from`/`to`: `null`, `notes` carries the netting's own notes, `personName`/`partyType`/`shareId`/`projectId` from the netting row directly).
- `apps/web/lib/money-trail-view.ts` (Story 5.2) — `ENTRY_TYPE_LABELS` gains `adjustment: "Adjustment"` (TypeScript's `Record<MoneyHistoryEntryType, string>` forces this — compile error otherwise, confirming the exhaustiveness guard works as designed).
- `apps/web/app/(dashboard)/money-history/page.tsx` — the row-click-to-trace affordance is conditionally omitted for `"adjustment"`-type entries (no `MONEY_HISTORY_ENTRY_TYPE_TO_TRAIL_NODE_TYPE` mapping exists for it — `getTrailStartFromEntry`'s existing `Record` type will force this to be handled, not silently ignored).
- `packages/core/src/authorize.ts` — new actions `"adjust_next_time:view"` (`new Set(["owner_admin", "partner", "sub_partner"])`, mirrors `money_history:list` exactly) and `"adjustment_nettings:create"` (`new Set(["owner_admin"])`).
- `apps/web/app/api/adjust-next-time/route.ts` (new, not Project-scoped) — `GET`, `authorizeScope()` first, role-based scope resolution (reuses Story 5.1's exact pattern), fetches `investmentAdjustments.listAll()`/`withdrawalAdjustments.listAll()` + Project/Partner/Sub-partner names, applies scope, responds `{ investmentAdjustments: [...], withdrawalAdjustments: [...] }`.
- `apps/web/app/api/adjustment-nettings/route.ts` (new) — `POST`, `authorizeScope("adjustment_nettings:create")`, body validates `{ projectId, partyType, shareId, investmentRequirementId, amount, notes, idempotencyKey }` (re-resolves the referenced investment/withdrawal adjustment rows exist and belong together, 404 otherwise, mirrors every other create route's existence-check convention), calls `recordNetting()`.
- `apps/web/lib/adjust-next-time.ts` (new) — client fetch helpers `getAdjustNextTime()`, `recordAdjustmentNetting(input)`.
- `apps/web/app/(dashboard)/adjust-next-time/page.tsx` (new, not Project-scoped) — `PageHeader`, `EmptyState`, two independent sections (`AdjustPersonCard`-style, per `packages/ui`'s existing component — reuse, don't hand-roll) for Investment and Withdrawal Adjustment, each row using the exact existing `ADJUSTMENT_LABEL`/StatusChip-variant conventions from `add-money/page.tsx`/`withdraw-money/page.tsx`, plus the AC's literal "Next time reduce/add by ₹X" phrasing. A "Net Adjustment" action (Owner/Admin-only — hidden for other roles, the API itself gates the rest) on each Investment row opens a dialog showing that same person's Withdrawal Adjustment figure for context, amount + notes fields, calling `recordAdjustmentNetting()`.
- `apps/web/app/(dashboard)/layout.tsx` — activate the (currently inert) `adjustNextTime` nav item, mirroring every prior story's identical activation pattern.
- `apps/web/app/(dashboard)/SidebarNav.tsx` — add the `adjustNextTime` case to `isActive()`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db/src/schema.ts` + migration — `adjustment_nettings`
- [ ] `packages/types/src/index.ts` — `AdjustmentNetting`, extended `MoneyHistoryEntryType`
- [ ] Port additions (`listAll()` ×2, new `AdjustmentNettingPort`) + `packages/db/src/ports.ts` implementations + tests
- [ ] `packages/core/src/adjust-next-time.ts` + tests — scope reuse, no new resolution logic
- [ ] `packages/core/src/money-history.ts` — `buildAdjustmentNettingEntries` + tests
- [ ] `apps/web/lib/money-trail-view.ts` — `ENTRY_TYPE_LABELS` extension (compile-enforced)
- [ ] `apps/web/app/(dashboard)/money-history/page.tsx` — omit trace affordance for `"adjustment"` rows + test
- [ ] `packages/core/src/authorize.ts` — 2 new actions
- [ ] `apps/web/app/api/adjust-next-time/route.ts` + tests — full I/O matrix incl. both scope cases
- [ ] `apps/web/app/api/adjustment-nettings/route.ts` + tests — idempotency, 403, existence checks
- [ ] `apps/web/lib/adjust-next-time.ts`
- [ ] `apps/web/app/(dashboard)/adjust-next-time/page.tsx` + test — both sections, netting dialog, Owner/Admin-only visibility
- [ ] `apps/web/app/(dashboard)/layout.tsx` + `SidebarNav.tsx` — activate nav item

**Acceptance Criteria (from epics.md Story 5.3):** see the frozen I/O matrix above — all 4 epics.md ACs are represented as matrix rows 1-2 (Investment/Withdrawal sections), row 3 (never netted automatically), row 5 (netting recorded as its own audited transaction type, visible in Money History as "Adjustment").

## Implementation Notes

- **`MoneyHistoryRawData.adjustmentNettings` is optional** (`readonly AdjustmentNetting[] | undefined`, defaulting to `[]` inside `buildAdjustmentNettingEntries`), not a new required field — this keeps every pre-Story-5.3 construction of `MoneyHistoryRawData` (chiefly `money-history.test.ts`'s own fixtures) compiling unchanged, mirroring this codebase's established non-breaking-additive-field convention (e.g. `withdrawal_destination_allocations`' Story 4.8 columns). `GET /api/money-history`'s route is the one real caller that now always supplies it (`createAdjustmentNettingPort().listAll()`, fetched in parallel with the other 6 source tables) — this route file wasn't explicitly named in the frozen Code Map, but is a necessary, direct implication of extending `assembleMoneyHistory()` per the frozen AC ("visible in Money History as 'Adjustment'"): without this wiring, the new branch would exist but never actually surface a netting record anywhere.
- **`moneyHistoryShareKey` was exported** from `money-history.ts` (previously module-private) so `adjust-next-time.ts`'s `filterAdjustNextTimeByScope` can build the identical `(partyType, shareId, projectId)` scope key `resolveMoneyHistoryScope`/`assembleMoneyHistory` already use, without re-deriving a second, duplicate key-builder. No other change to `money-history.ts`'s existing exports/behavior.
- **`personName`/`projectName` enrichment for `GET /api/adjust-next-time` lives at the route layer**, not in `packages/core`'s `adjust-next-time.ts` — that module stays a pure scope filter only, per the frozen Code Map ("no new scope-resolution logic"). The route mirrors `GET /api/money-history`'s own `partnerNamesById`/`subPartnerNamesById` map-building convention exactly, reusing the same `moneyHistoryPersonNameKey` key-builder. Response types (`AdjustNextTimeInvestmentEntry`/`AdjustNextTimeWithdrawalEntry`, each `InvestmentAdjustment`/`WithdrawalAdjustment` widened with `personName`/`projectName`) live in `apps/web/lib/adjust-next-time.ts`, the client-facing home for this shape — no new `packages/types` type was needed for this display-only widening.
- **`canNet` is a server-computed boolean** on `GET /api/adjust-next-time`'s response (`true` only for an `owner_admin` actor), not a new client-side session-role primitive. This codebase has no existing mechanism for a client component to learn "my own role" (every dashboard page today is reachable only via the Owner/Admin-gated shell, `requireOwnerAdminSession()`), so inventing one purely for this one flag would be a wider change than the story calls for. `canNet` is a UX convenience only — `POST /api/adjustment-nettings`'s own `authorizeScope("adjustment_nettings:create", ...)` (Owner/Admin-only, no self-access) is the real, authoritative gate either way, exercised directly by this story's route tests (403 for a Partner, before any DB read).
- **The AC's literal "Next time reduce/add by ₹X" phrasing is Investment-section-only.** The Withdrawal section deliberately does NOT get an invented equivalent sentence — its own frozen I/O matrix row (AC2) only requires visibility, separate from the Investment section; the reused-verbatim `AdjustmentChip` (label + amount) already satisfies that. Inventing new Withdrawal-side wording risked colliding with the instruction to reuse `ADJUSTMENT_LABEL` verbatim and never invent new labels.
- **A person's multiple Investment Adjustment rows (across funding requirements) are not annotated with the requirement's own date/number** on the Adjust Next Time page — the frozen Code Map for `GET /api/adjust-next-time` only calls for fetching Project/Partner/Sub-partner names, not `InvestmentRequirement` rows. Each row already renders as its own separate `AdjustPersonCard` (never merged, satisfying the frozen "never merged" requirement), but two such cards for the same person at the same Project are currently visually distinguishable only by their differing Should Pay/Actual Paid/Adjustment figures, not by an explicit "which funding round" label. A follow-up could fetch requirement dates for a friendlier label if this proves confusing in practice.
- **`AdjustmentNettingPort.recordNetting`'s idempotent-write shape mirrors `AvailableBalanceSpendPort.recordSpend`** (separate `idempotencyKey`/`actorUserId` parameters, not fields on `input`) rather than `WithdrawalTransactionPort.recordTransaction`'s shape (idempotencyKey embedded in `input`) — the frozen Code Map's own port signature (`recordNetting(input, idempotencyKey, actorUserId)`) specifies this exact shape.
- Extending `InvestmentAdjustmentPort`/`WithdrawalAdjustmentPort` with a new required `listAll()` method broke every existing hand-typed mock port object across `packages/core`'s own test suite (`investment-adjustment.test.ts`, `withdrawal-adjustment.test.ts`, `investment-transaction.test.ts`, `recommended-amount.test.ts`) — a mechanical, expected consequence of a port-interface extension, fixed by adding the missing method to each mock (a plain `vi.fn()`/`async () => []`/`async () => [...store.values()]`, matching each file's existing mocking style). No test's actual assertions/logic changed.

## Spec Change Log

**2026-09-25, found during edge-case-hunter review:** Decision #2 and I/O matrix row 4 contained a factual error about `investment_adjustments`' schema — I (the orchestrator) had claimed it's keyed by `(partyType, shareId, projectId, requirementId)`, allowing multiple simultaneous rows per person per Project across funding requirements. This is wrong: Story 3.4's own unique constraint is `(partyType, shareId, projectId)` only — there is exactly ONE current row per person per Project, always upserted in place; `requirementId` just records whichever requirement was computed most recently, and a later requirement's calculation silently overwrites the prior one's numbers. Corrected both sections in place above (struck through, with the correction inline) rather than reverting implementation — the actual shipped code (rendering however many rows the API returns) is not wrong, it just never encounters more than one row per Project in production; the real, reachable version of this scenario is the SAME person having independent single rows at DIFFERENT Projects, which the review's patch round addresses (see Review Triage Log).

## Review Triage Log

3-layer review (blind-hunter, edge-case-hunter, verification-gap) — blind-hunter found no bugs: the story's core AD-4 invariant (a netting write never touches `investment_adjustments`/`withdrawal_adjustments`) is correctly implemented and independently proven by a live-Postgres byte-for-byte before/after comparison test. Edge-case-hunter found a factual error in the spec itself (not the implementation) — see Spec Change Log above. All findings applied in one patch round (2026-09-25):

1. **[Spec correction, no code impact]** Decision #2 and I/O matrix row 4 wrongly claimed `investment_adjustments` allows multiple simultaneous rows per person per Project across funding requirements — Story 3.4's actual unique constraint is `(partyType, shareId, projectId)` only, one current row per person per Project. Corrected in place in the frozen section (struck through with inline correction), logged in Spec Change Log. The real reachable ambiguity is a person having independent rows at *different* Projects, not multiple rows at one Project.
2. **[Medium, real UX gap]** The netting dialog showed only the person's name, not which Project — genuinely ambiguous if the same person has same-looking adjustments at two different Projects. Fixed: dialog title now includes `projectName`.
3. **[Medium, verification gap]** IDOR-style validation (`POST /api/adjustment-nettings`) was only tested against empty result sets, never a genuine mismatched-row scenario — an empty list can't distinguish a correct `.find()` predicate from one missing a comparison field. Added 4 tests with non-empty lists containing a wrong-but-present row (mismatched shareId/requirementId/partyType).
4. **[Medium, replacement test]** Added a genuine multi-Project netting-dialog test (two rows for the same person at different Projects, opening the second row specifically, asserting the correct project-scoped payload is sent) — replaces the now-invalid same-Project multi-row scenario as the real-world proof of correct per-row disambiguation.
5. **[Low]** Annotated the now-synthetic same-Project fixture test with a comment explaining it tests defensive/generic handling of an input shape not reachable via any real write path, plus added the real cross-Project counterpart alongside it.

Post-patch: `pnpm turbo run test lint typecheck build --force --concurrency=1`, `pnpm lint:boundaries`, `pnpm audit` all green (core 640 tests, db 253 tests, web 758 tests).

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `adjust-next-time.test.ts` covers scope reuse; `money-history.test.ts` extended for the new `"adjustment"` entry type
- `pnpm --filter @niveshbook/db test` — expected: live-Postgres tests for the 3 new/extended port methods incl. `recordNetting`'s idempotent replay
- `pnpm --filter @niveshbook/web test` — expected: both new routes' full I/O matrix incl. both scope cases; page tests for both sections, the netting dialog, and Owner/Admin-only visibility of the netting action
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm lint:boundaries` — expected: clean
- **Live verification:** as Owner/Admin, confirm both sections display correctly with the exact AC-specified phrasing, perform a netting action, confirm `investment_adjustments`/`withdrawal_adjustments` are byte-for-byte unchanged afterward (query directly), confirm the netting appears in Money History as "Adjustment" with no trace affordance; as a Partner, confirm only their own rows appear.

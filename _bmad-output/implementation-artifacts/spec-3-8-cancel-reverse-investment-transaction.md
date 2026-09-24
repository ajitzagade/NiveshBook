---
title: 'Cancel/Reverse an Investment Transaction'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
baseline_commit: '724351d4566196cc45a8adcb5a3d624fc593c824'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A transaction recorded by mistake can be corrected (Story 3.7) but never removed — FR42 requires a way to void one without ever hard-deleting financial history.

**Approach:** `investment_transactions` gains two new columns — `status` (`'active' | 'cancelled'`, default `'active'`) and `reversalOfTransactionId` (nullable, self-referencing). Cancelling: (1) flips the **original** row's `status` to `'cancelled'` in place — every other field untouched, "the original record is preserved" per FR42's literal wording; (2) inserts a **new** row — the "linked reversal record" — carrying the same `requirementId`/`projectId`/`partyType`/`shareId`/`paymentMode`/`amount` as the original for a self-explanatory audit trail, `status: 'cancelled'` too (so it never counts toward Paid Now either — no double-void, no confusion), and `reversalOfTransactionId` pointing back to the original. Both writes plus one `audit_log` entry happen atomically (AD-5, reusing Story 3.7's exact atomic-write pattern and its `audit_log.idempotencyKey` idempotency mechanism unchanged). Story 3.4's `computeInvestmentAdjustment` itself is **not modified** — a new pure filter excludes `status: 'cancelled'` rows *before* the existing (unchanged) summing logic ever sees them, so "the cancelled amount no longer counts toward Paid Now" is true the next time anyone views the ledger, with zero new arithmetic.

**Decisions (resolved 2026-09-24):**
- **`computeInvestmentAdjustment`/`should-pay.ts`/`recommended-amount.ts` stay unmodified.** Investigated first: those functions only ever receive a pre-built `Record<string, Money[]>` of amounts to sum — they have no concept of "status" and shouldn't need one. A new pure `filterActiveTransactions(transactions): InvestmentTransaction[]` helper is called by the *routes* that build that map (`adjustments/route.ts`, `my-investment-status/route.ts`) before grouping — Open/Closed: extend via a new function, never edit the stable calculation. `GET .../transactions` (the plain recorded-payments list, Story 3.3) is deliberately **not** filtered — Owner/Admin needs to *see* that a transaction was cancelled (and its reversal), not have it silently vanish.
- **The reversal row gets `status: 'cancelled'` too, not a distinct third status.** Simpler state machine — every non-counting row is `'cancelled'`, whether it's an original that got voided or the reversal record explaining it; `reversalOfTransactionId` (present only on the reversal row) is what distinguishes "this is the reversal" from "this was cancelled."
- **Cancelling is Owner/Admin-only, no self-access** — mirrors Story 3.7's `investment_transactions:edit` exactly; the AC's persona and its explicit "Given a non-Owner/Admin... Then 403" leave no ambiguity.
- **A cancelled transaction can no longer be edited (Story 3.7).** Investigated first: leaving `editInvestmentTransaction` unaware of `status` would let someone edit a voided record's amount after the fact — a real, foreseeable data-integrity gap, not a hypothetical. This is a small, additive guard to Story 3.7's already-shipped function (checked before any other validation), not a redesign of it.
- **No separate `audit_log` "create" entry for the reversal row.** One `"cancel"` entry (on the *original* transaction's `entityId`) fully explains both writes — `oldValue`/`newValue` show the original's status flip, and the reversal row's own id is discoverable via the cancel endpoint's response and `reversalOfTransactionId` on the row itself. Adding a second audit entry for the reversal row would be redundant bookkeeping nothing asks for.
- **Idempotency reuses `audit_log.idempotencyKey` unchanged** (Story 3.7's mechanism) — a duplicate cancel request returns the already-cancelled state rather than double-voiding or creating two reversal rows.
- **Cancelling an already-cancelled transaction (not a replay — a genuinely new attempt) is rejected**, not silently a no-op — distinguished from the idempotent-replay case by the same `idempotencyKey`-match check Story 3.7 established.

## Boundaries & Constraints

**Always:** `POST .../transactions/[transactionId]/cancel` requires a valid session (401) and `authorizeScope()` for `"investment_transactions:cancel"` (Owner/Admin-only). Project/requirement/transaction existence (incl. cross-requirement/cross-project mismatch) are checked before any write. The original row's `status` flip, the reversal row's insert, and the paired `audit_log` entry happen inside one DB transaction (AD-5) — never a subset. `PATCH .../transactions/[transactionId]` (Story 3.7) now additionally rejects editing a transaction whose current `status` is `'cancelled'`.

**Never:** No `DELETE` — ever. No modification to `computeInvestmentAdjustment`/`should-pay.ts`/`recommended-amount.ts`'s own logic. No change to `GET .../transactions`' existing behavior (still lists every row, cancelled or not — this story only adds a `status` field to what's already returned).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Admin cancels a transaction | A previously recorded, active transaction | 200; original row's `status` → `'cancelled'`, a new linked reversal row created, one `audit_log` `"cancel"` entry | N/A |
| Adjustment reflects the reversal | After the cancel above | Next `GET .../adjustments` (or `/should-pay`, `/my-investment-status`) excludes both the original AND its reversal row from the Paid Now sum — no separate action needed | N/A |
| Non-Owner/Admin attempts to cancel | Partner/Sub-partner session, direct API call | 403, before any write | `{code: "forbidden"}` |
| Duplicate cancel request, same `idempotencyKey` | Two identical cancel requests | Exactly one reversal row created, one `audit_log` entry; both responses return the same result | N/A |
| Cancelling an already-cancelled transaction (genuinely new attempt, different key) | A transaction whose `status` is already `'cancelled'` | 409, no second reversal row | `{code: "already_cancelled"}` |
| Editing a cancelled transaction | `PATCH` on a `status: 'cancelled'` transaction | 409, no changes applied | `{code: "already_cancelled"}` |
| Nonexistent/malformed transaction id, or belongs to a different requirement/project | Any caller | 404 | `{code: "not_found"}` |
| `GET .../transactions` after a cancel | Any authorized caller | Returns both the original (`status: "cancelled"`) and the reversal row, never hard-deleted | N/A |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema.ts` — add `status: text("status").notNull().default("active")` and `reversalOfTransactionId: uuid("reversal_of_transaction_id").references((): AnyPgColumn => investmentTransactions.id)` (self-referencing, nullable) to `investmentTransactions`.
- `packages/db/drizzle/*` — generate migration.
- `packages/types/src/index.ts` — extend `InvestmentTransaction` with `status: "active" | "cancelled"` and `reversalOfTransactionId: string | null`.
- `packages/core/src/investment-transaction-port.ts` — add `CancelInvestmentTransactionInput`, `CancelTransactionResult { originalTransaction: InvestmentTransaction; reversalTransaction: InvestmentTransaction; cancelled: boolean }` (`cancelled: false` on an idempotent replay, mirrors `EditTransactionResult`'s `edited` flag), `cancelTransaction(input): Promise<CancelTransactionResult>` on `InvestmentTransactionPort`.
- `packages/core/src/investment-transaction.ts` — add `AlreadyCancelledError`; `cancelInvestmentTransaction(transactionId, input: {idempotencyKey, reason}, actorUserId, deps)`; add `filterActiveTransactions(transactions: readonly InvestmentTransaction[]): InvestmentTransaction[]` (pure, `status === "active"`); extend `editInvestmentTransaction` with an early guard — if the current transaction's `status` is `"cancelled"`, throw `AlreadyCancelledError` before any other validation.
- `packages/core/src/authorize.ts` — add `"investment_transactions:cancel"` (Owner/Admin-only, `authorizeScope()`, no self-access — mirrors `:edit`).
- `packages/core/src/index.ts` — barrel-export.
- `packages/db/src/ports.ts` — implement `cancelTransaction`: check existing `audit_log` entry by `idempotencyKey` first (replay); else, inside one `database.transaction()`: `SELECT ... FOR UPDATE` the original row, reject if already `'cancelled'` (unless this exact idempotencyKey matches — defense in depth), `UPDATE` original `status = 'cancelled'`, `INSERT` the reversal row, `INSERT` the `audit_log` `"cancel"` entry; catch-unique-violation-and-recover mirroring `editTransaction`'s pattern.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/transactions/[transactionId]/cancel/route.ts` (new) — `POST`: session → project/requirement/transaction 404 (incl. mismatch) → `authorizeScope()` for `"investment_transactions:cancel"` (403) → body validation (idempotencyKey required, reason optional) → `cancelInvestmentTransaction` → 200, mapping `AlreadyCancelledError` to 409 `already_cancelled`.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/transactions/[transactionId]/route.ts` (Story 3.7, additive change) — map the (new) `AlreadyCancelledError` from `editInvestmentTransaction` to 409 `already_cancelled`.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/adjustments/route.ts` (Story 3.4, additive change) — call `filterActiveTransactions` on the fetched transaction list before `groupTransactionsByShareKey`.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/my-investment-status/route.ts` (Story 3.6, additive change) — same additive filter step.
- `apps/web/lib/investment-transactions.ts` — add `cancelInvestmentTransaction` client fetch helper.
- `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — extend the recorded-payments list with a "Cancelled" indicator per row (reusing `packages/ui`'s `StatusChip`) and a "Cancel" affordance (Owner/Admin-facing, confirmation before firing — this is a genuinely destructive-feeling action from the user's perspective even though nothing is hard-deleted), disabled/hidden for rows already `status: "cancelled"`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema.ts` + migration — `status`/`reversalOfTransactionId` columns
- [x] `packages/types/src/index.ts` — extended `InvestmentTransaction`
- [x] `packages/core/src/investment-transaction-port.ts` — `cancelTransaction` port method
- [x] `packages/core/src/investment-transaction.ts` + tests — `cancelInvestmentTransaction`, `filterActiveTransactions`, `editInvestmentTransaction`'s new already-cancelled guard
- [x] `packages/core/src/authorize.ts` + tests — `investment_transactions:cancel` action
- [x] `packages/db/src/ports.ts` + tests — atomic `cancelTransaction` (incl. idempotency, already-cancelled rejection), plus the patch-round fix moving `editTransaction`'s already-cancelled check inside its own `FOR UPDATE` lock
- [x] `apps/web/.../transactions/[transactionId]/cancel/route.ts` + test — POST, full I/O matrix
- [x] `apps/web/.../transactions/[transactionId]/route.ts` + test — PATCH now 409s on a cancelled transaction, end-to-end (patch round)
- [x] `apps/web/.../adjustments/route.ts` + `.../my-investment-status/route.ts` + tests — active-only filtering
- [x] `apps/web/lib/investment-transactions.ts` — client fetch helper
- [x] `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — Cancel affordance + status indicator, Edit button gated on `status === "active"` (patch round)

**Acceptance Criteria (from epics.md Story 3.8):**
- Given a recorded Add Money transaction, when Owner/Admin cancels/reverses it, then the original record is preserved with status "cancelled" and a linked reversal record is created — no row is hard-deleted (FR42).
- Given a cancelled transaction, when the Investment Adjustment ledger is next viewed, then it reflects the reversal — the cancelled amount no longer counts toward Paid Now.
- Given a non-Owner/Admin user, when they attempt to cancel/reverse any transaction, then 403.

## Implementation Notes

- **Reversal row's `idempotencyKey` is freshly system-generated, not derived from the cancel request's key.** The cancel request's own `idempotencyKey` is used for the `audit_log` "cancel" entry (so a replayed cancel request is detected the normal way), but the reversal transaction row itself gets its own new `idempotencyKey` at insert time. This is intentional: the reversal row is a `investment_transactions` row like any other, and that table's `idempotencyKey` uniqueness constraint exists to dedupe *client-submitted write requests*, not to link a generated side-effect row back to the request that caused it (that linkage is `reversalOfTransactionId`'s job). Deriving the reversal's key from the cancel request's key would work for the simple case but has no clean answer for what a *second* reversal-adjacent write should use, so a fresh key was the simpler, more defensible choice. Flagged by verification-gap in review (row 7 of the Review Triage Log below) as a real but harmless judgment call — documented here per the Spec Change Log discipline rather than patched.
- **The TOCTOU fix's layering**: `packages/core`'s `editInvestmentTransaction` keeps its early already-cancelled check (a `findById` read before calling the port) — it's a fast-fail optimization for the common non-racing case, not the authoritative guard. The authoritative check now lives in `packages/db/src/ports.ts`'s `editTransaction`, immediately after its `SELECT ... FOR UPDATE` lock is acquired, mirroring `cancelTransaction`'s own already-correct pattern. This two-layer shape (cheap early check + authoritative locked check) is the same one Story 3.7 already used for the `editTransaction`-vs-`editTransaction` race; Story 3.8's patch extends it to close the `editTransaction`-vs-`cancelTransaction` race too.
- **Independent live-Postgres re-verification** (orchestrator, post-patch): recorded a real transaction via the live API, cancelled it, then attempted a PATCH edit against the now-cancelled original — confirmed `409 already_cancelled` end-to-end, confirmed the audit log for that transaction shows only `create` and `cancel` entries (no spurious `edit` entry from the rejected attempt), and confirmed the original row's `amount`/`reference_number` in the database exactly match what was recorded at creation, not the rejected edit's values. All scratch test data (projects, users, sessions) was deleted afterward.

## Spec Change Log

- Patch round (post-review): fixed a TOCTOU race in `editTransaction` (Review Triage Log row 1, high severity) by moving the already-cancelled check inside the port's `FOR UPDATE` lock; gated the Edit button in `add-money/page.tsx` on `status === "active"` (row 2); added `schema.test.ts` assertions for the `status`/`reversalOfTransactionId` columns (row 3); fixed Story 3.7's PATCH route test to exercise the real end-to-end already-cancelled guard instead of a mocked-away error (row 4); added narrow Cancel-UI regression tests (row 5). No spec-level (frozen Intent/Decisions/Boundaries/IO-Matrix) changes were needed — all fixes were implementation-level.

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (blind-hunter) A TOCTOU race lets an edit slip through onto an already-cancelled transaction. `editInvestmentTransaction`'s already-cancelled guard (`packages/core/src/investment-transaction.ts`) is a plain, non-locking `findById` check executed in a separate round trip *before* the port's own `editTransaction` call, which does its own independent `SELECT ... FOR UPDATE` later. Concrete race: A starts editing T (status check passes, T is `active`); before A's request reaches the port, B cancels T (flips status, inserts reversal, commits, uncontended since A hasn't locked anything yet); A's request then proceeds to the port's `FOR UPDATE` read (finds `status: "cancelled"`, but nothing checks it there) and unconditionally applies the `UPDATE` — corrupting the "original record is preserved" guarantee this exact story exists to protect, and silently diverging the cancelled original's fields from its own reversal row's snapshot. | high (real, undermines this story's core guarantee) | Confirmed by direct code read: `editTransaction`'s `FOR UPDATE` block has no status check, unlike `cancelTransaction`'s own analogous block, which correctly checks `originalRow.status === "cancelled"` right after acquiring the lock. | patch |
| 2 | (edge-case-hunter) The "Edit" button in `add-money/page.tsx`'s recorded-payments list isn't gated on `transaction.status === "active"` the way the "Cancel" button correctly is — a user can open the Edit dialog for an already-cancelled or reversal transaction and only discover the 409 on save. | medium (real UX gap; more significant now that finding #1 shows the backend guard it depends on has a real hole to close) | Confirmed by direct code read — the Cancel button two lines below has the exact gate the Edit button is missing. | patch |
| 3 | (verification-gap) `schema.test.ts` has zero assertions for the two new `investment_transactions` columns (`status`, `reversalOfTransactionId`), despite every other table in that file having a dedicated schema-assertion block, and despite this story's own `investment_transactions table schema (Story 3.3)` block not being extended. | medium (real regression against an established, consistently-applied codebase testing convention — same class of gap patched in Story 3.7's row 3) | Confirmed via grep — zero matches. | patch |
| 4 | (verification-gap) Story 3.7's PATCH route test for the `AlreadyCancelledError` → 409 mapping mocks `editTransaction` to reject directly, without ever setting up `findById` to return a `status: "cancelled"` transaction — so it only proves the route's `catch` block maps the error correctly, never that a real PATCH against a genuinely-cancelled transaction drives the actual guard end-to-end. Given finding #1, this gap is exactly why the TOCTOU race went undetected by any existing test. | high (directly relevant to finding #1 — the missing test is why the bug shipped) | Confirmed by direct code read: the route test's `EXISTING_TRANSACTION` fixture has no `status` field at all. | patch |
| 5 | (verification-gap) The new Cancel UI (confirmation dialog, Cancel button, "Cancelled"/reversal `StatusChip` — 161 insertions in `add-money/page.tsx`) has zero test coverage. | medium (a real bug — finding #2 — was found in this exact new UI surface, so a regression test is now warranted per this project's established pattern, unlike Stories 3.4-3.6's UI additions where no bug was found) | Confirmed via `git diff --stat` — `page.test.tsx` untouched by this diff. | patch (narrow — regression tests for findings #1/#2's UI-visible symptoms) |
| 6 | (verification-gap, blind-hunter, edge-case-hunter) Cancel-vs-cancel concurrency (two genuinely different concurrent cancel attempts), reversal-row field-by-field construction, `authorize.ts`'s Owner/Admin-only shape, both routes' `filterActiveTransactions` application, `GET .../transactions`' deliberate non-filtering, cancelling a reversal row's implicit safe handling, and the self-referencing FK's correctness were all independently investigated and confirmed correct. | false (no defect — investigated and confirmed correct) | See each reviewer's report for the specific verification performed. | — |
| 7 | (verification-gap) The reversal row's fresh, system-generated `idempotencyKey` (rather than reusing/deriving one from the cancel request) is a real, defensible judgment call, explained only in an inline code comment. | — (harmless, will be documented) | Logged in Implementation Notes at finalization per the Spec Change Log discipline. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `investment-transaction.test.ts` covers `cancelInvestmentTransaction`, `filterActiveTransactions`, the edit-a-cancelled-transaction guard
- `pnpm --filter @niveshbook/db test` — expected: schema/port-shape assertions for the new columns, `cancelTransaction`'s atomicity contract
- `pnpm --filter @niveshbook/web test` — expected: new cancel route's full I/O matrix, PATCH's new 409, adjustments/my-investment-status routes' active-only filtering
- `pnpm lint` / `pnpm typecheck` / `pnpm build` — expected: clean
- **Live verification:** record a transaction, confirm it counts toward Paid Now, cancel it, confirm `GET .../transactions` shows both rows (original `cancelled` + reversal), confirm `GET .../adjustments` no longer counts it, confirm attempting to edit the cancelled original gets 409, confirm a duplicate cancel request doesn't create a second reversal row, confirm a non-Owner/Admin gets 403.

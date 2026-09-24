---
title: 'Edit an Investment Transaction (Audited)'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
baseline_commit: '336969bc6617d71ba78c2fab2391896233e555de'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A recorded transaction (Story 3.3) can't be corrected — a typo'd amount or wrong payment mode is permanent. FR41 requires editing while preserving exactly what changed, who changed it, and when.

**Approach:** A new `PATCH .../transactions/[transactionId]` endpoint, Owner/Admin-only, updates the mutable fields (`amount`, `transactionDate`, `paymentMode`, `referenceNumber`, `notes`) **in place** — never a new versioned row (unlike Epic 2's `partner_shares` AD-3 pattern; a transaction has one identity, corrected over time, not a history of "current value" swaps). Reuses Story 3.3's exact atomic-write-plus-audit-log pattern (AD-5): the update and its paired `audit_log` row (`action: "edit"`, `oldValue` = the full previous row, `newValue` = the full new row) happen in one DB transaction. **`sharePercentSnapshot`/`shouldPaySnapshot` are never touched by an edit** — AD-3's guarantee that a transaction's historical Should Pay is frozen at creation time applies just as much to edits as to a later Share % change; only the fields a human actually corrects (amount, date, mode, reference, notes) are editable. Story 3.4's Investment Adjustment needs **no new recompute trigger at all** — it already reads live, current transaction amounts on every view (3.4's own "viewing is what keeps the ledger current" design), so an edited amount is automatically reflected the next time anyone views `/adjustments`, `/should-pay`, or `/my-investment-status`. A new `GET .../transactions/[transactionId]/audit-log` endpoint exposes the before/after trail, visible to Owner/Admin and to the transaction's own linked Partner/Sub-partner (self-access, mirroring Story 3.6's precedent).

**Decisions (resolved 2026-09-24):**
- **Editing is Owner/Admin-only — no self-access**, unlike Story 3.3's `investment_transactions:create`. The AC's persona is explicitly "As an Owner/Admin," with no "(or the transaction's own Partner/Sub-partner)" qualifier — that qualifier appears only on AC3 (viewing the audit trail), a deliberately different, narrower permission.
- **No recompute of `sharePercentSnapshot`/`shouldPaySnapshot` on edit.** AD-3 states a transaction's historical Should Pay is frozen once created; an edit corrects what was *actually paid* (amount) or *how*/*when* (date, mode, reference, notes) — it never re-asks "what should this person have owed." If a Share % changed since the original transaction, the snapshot still reflects what was true when the transaction was first recorded, exactly as designed.
- **No new "recompute adjustment" action or endpoint.** Investigated first: Story 3.4's `computeInvestmentAdjustment` already sums every transaction's *current* `amount` for a share+requirement on every view — an in-place `UPDATE` to `amount` is automatically picked up the next time anyone views the adjustment ledger. Building a separate explicit recompute step would duplicate logic 3.4 already provides and risk the two falling out of sync.
- **Idempotency reuses AD-5's established mechanism, via a new nullable `idempotencyKey` column on `audit_log`** (not a new column on `investment_transactions`, which already has its own `idempotencyKey` tied specifically to the original *create* action). `audit_log` is the natural home since it's the table Stories 3.8/Epic 4 will also write edit/cancel-shaped entries to — a nullable, UNIQUE-when-present column lets `create` entries (which don't need one) coexist with `edit`/`cancel` entries (which do), without forcing every audit entry to carry a key it doesn't need. A duplicate `PATCH` with the same `idempotencyKey` returns the already-applied edit's result rather than re-applying (or double-logging) it.
- **A `reason` for the edit is optional**, matching `audit_log.reason`'s existing nullable design (Story 3.3) — no AC requires one, and forcing it would be scope creep.
- **The audit-trail view endpoint returns every `audit_log` entry for a transaction** (currently just the one `"create"` entry plus, after this story ships, any `"edit"` entries) — not filtered to only edits, since "the audit trail" naturally includes the transaction's origin too.

## Boundaries & Constraints

**Always:** `PATCH .../transactions/[transactionId]` requires a valid session (401) and `authorizeScope()` for `"investment_transactions:edit"` (Owner/Admin-only). Project, requirement, and transaction existence (incl. cross-requirement/cross-project mismatch) are checked before any write. `amount`/`transactionDate`/`paymentMode` are validated identically to Story 3.3's create validation (reusing the same normalization functions — `"0"` still explicitly valid for `amount`). The update and its paired `audit_log` row happen in one DB transaction (AD-5) — never one without the other. `GET .../transactions/[transactionId]/audit-log` requires a valid session (401) and `authorize()` for `"investment_transactions:view_audit"` — Owner/Admin, or the transaction's own linked Partner/Sub-partner (self-access, resolved from the transaction's `partyType`/`shareId` against *current* Shares, mirroring Story 3.6).

**Never:** `sharePercentSnapshot`/`shouldPaySnapshot` are never part of the `PATCH` body and never change. No versioned row — this is a true in-place `UPDATE`, not an `INSERT` of a new row with the same stable id (transactions have no AD-3-style version history). No change to Story 3.4's `computeInvestmentAdjustment`/`should-pay.ts`/`recommended-amount.ts` — zero new recompute logic. No `DELETE` — this story only edits; cancellation is Story 3.8's job.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Admin edits amount | A previously recorded transaction, `PATCH` with a corrected `amount` | 200; new value saved; `audit_log` gains one `"edit"` entry with old/new full row snapshots, actor, timestamp | N/A |
| Investment Adjustment reflects the correction | After the edit above | Next `GET .../adjustments` (or `/should-pay`, `/my-investment-status`) for that requirement sums the *new* amount — no separate action needed | N/A |
| Audit trail visible to Owner/Admin | `GET .../transactions/[transactionId]/audit-log` | 200; every entry (the original `"create"` plus any `"edit"`s), each with before/after values | N/A |
| Audit trail visible to the transaction's own Partner/Sub-partner | Self-access session matching the transaction's `shareId` | 200; same as above | N/A |
| Audit trail denied to a co-Partner | A different Partner's session, not Owner/Admin | 403 | `{code: "forbidden"}` |
| Non-Owner/Admin attempts to edit | Partner/Sub-partner session, direct API call | 403, before any write | `{code: "forbidden"}` |
| Duplicate `PATCH`, same `idempotencyKey` | Two identical edit requests | Exactly one `audit_log` entry created; both responses return the same updated transaction | N/A |
| Edit with invalid amount/date/paymentMode | Reused from Story 3.3's validation | 400 `validation_error`, no write | `{code: "validation_error"}` |
| Nonexistent/malformed transaction id, or belongs to a different requirement/project | Any caller | 404 | `{code: "not_found"}` |
| `sharePercentSnapshot`/`shouldPaySnapshot` after an edit | Any edit | Unchanged from the original creation-time values | N/A |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema.ts` — add nullable `idempotencyKey: text("idempotency_key")` to `auditLog`, with a UNIQUE constraint (Postgres allows multiple `NULL`s under a UNIQUE constraint, so `"create"` entries needing none coexist with `"edit"`/`"cancel"` entries that do).
- `packages/db/drizzle/*` — generate migration.
- `packages/core/src/investment-transaction-port.ts` — add `findById(id: string): Promise<InvestmentTransaction | null>`; add `EditInvestmentTransactionInput` and `editTransaction(input): Promise<EditTransactionResult>` (mirrors `CreateInvestmentTransactionInput`/`RecordTransactionResult`'s shape: `{transaction, edited: boolean}`, `edited: false` on an idempotent replay); add `findAuditLogByTransactionId(transactionId: string): Promise<AuditLogEntry[]>`.
- `packages/types/src/index.ts` — add `AuditLogEntry { id, entityType, entityId, action, actorUserId, oldValue, newValue, reason, createdAt }` (a thin, generic read type over `audit_log`).
- `packages/core/src/investment-transaction.ts` — add `editInvestmentTransaction(transactionId, input: {amount, transactionDate, paymentMode, referenceNumber, notes, idempotencyKey, reason}, actorUserId, deps)`: validates fields via the same `normalizeAmount`/`normalizeTransactionDate`/`normalizePaymentMode`/`normalizeOptionalText`/`normalizeIdempotencyKey` helpers already in this file, calls the port's `editTransaction`. Add `listAuditLogForTransaction(transactionId, deps)` (thin pass-through).
- `packages/core/src/authorize.ts` — add `"investment_transactions:edit"` (Owner/Admin-only, `authorizeScope()`, no self-access) and `"investment_transactions:view_audit"` (self-access + Owner/Admin, `authorize()`, mirrors `investment_status:view`'s exact shape).
- `packages/core/src/index.ts` — barrel-export.
- `packages/db/src/ports.ts` — implement `findById`, `editTransaction` (atomic update + audit_log insert in one `database.transaction()`, idempotency-key check-then-update-or-recover mirroring `recordTransaction`'s exact pattern, applied to the new `audit_log.idempotencyKey` column), `findAuditLogByTransactionId`.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/transactions/[transactionId]/route.ts` (new) — `PATCH`: session → project/requirement/transaction 404 (incl. mismatch) → `authorizeScope()` for `"investment_transactions:edit"` (403) → body validation (400) → `editInvestmentTransaction` → 200/replay-200.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/transactions/[transactionId]/audit-log/route.ts` (new) — `GET`: session → project/requirement/transaction 404 → resolve the transaction's target share (for self-access) → `authorize()` for `"investment_transactions:view_audit"` (403) → `listAuditLogForTransaction` → 200.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/transactions/shared.ts` — extend with `PATCH` body validation (reuses `PAYMENT_MODES`) and the two new routes' shared not-found response.
- `apps/web/lib/investment-transactions.ts` — add `editInvestmentTransaction`/`getAuditLog` client fetch helpers.
- `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — extend the recorded-payments list with an "Edit" affordance per transaction (Owner/Admin-facing, matching this story's Decisions), opening a dialog pre-filled with the transaction's current values.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema.ts` + migration — nullable `audit_log.idempotencyKey` UNIQUE column
- [x] `packages/types/src/index.ts` — `AuditLogEntry`
- [x] `packages/core/src/investment-transaction-port.ts` — `findById`, `editTransaction`, `findAuditLogByTransactionId`
- [x] `packages/core/src/investment-transaction.ts` + tests — `editInvestmentTransaction`, `listAuditLogForTransaction`, snapshot-fields-never-touched, real idempotency-replay coverage
- [x] `packages/core/src/authorize.ts` + tests — `investment_transactions:edit` (Owner/Admin-only) / `:view_audit` (self-access) actions
- [x] `packages/db/src/ports.ts` + tests — `findById`, atomic `editTransaction` (`SELECT ... FOR UPDATE`, incl. idempotency), `findAuditLogByTransactionId`
- [x] `apps/web/.../transactions/[transactionId]/route.ts` + test — PATCH, full I/O matrix, real replay test
- [x] `apps/web/.../transactions/[transactionId]/audit-log/route.ts` + test — GET, self-access vs. co-partner 403
- [x] `apps/web/lib/investment-transactions.ts` — client fetch helpers
- [x] `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — Edit affordance

**Acceptance Criteria (from epics.md Story 3.7):**
- Given a previously recorded Add Money transaction, when Owner/Admin edits its amount or details, then the new values are saved and the previous values, who changed it, and when, are preserved in the audit trail (FR41).
- Given an edit that changes the amount, when saved, then the transaction's Investment Adjustment (Story 3.4) is recomputed to reflect the correction.
- Given the audit trail for an edited transaction, when Owner/Admin (or the transaction's own Partner/Sub-partner) views it, then the before/after values are visible.

## Implementation Notes

The domain-layer raw/unvalidated edit input type is named `EditInvestmentTransactionRequest`, distinct from the port-layer's validated `EditInvestmentTransactionInput` — mirrors Story 3.3's established `RecordInvestmentTransactionInput` (domain) / `CreateInvestmentTransactionInput` (port) naming split exactly, not a deviation from that precedent even though it differs from the spec's Code Map wording.

## Spec Change Log

Patch round 1 (Review Triage Log rows 1-4): fixed a real concurrency bug where `editTransaction`'s pre-edit read used a plain `SELECT` instead of `SELECT ... FOR UPDATE`, letting the audit trail's `oldValue` go stale under two genuinely concurrent edits of the same transaction (silently hiding an intervening edit) — the implementer reproduced this live against real Postgres before applying the fix, then reconfirmed the fix resolves it. Added real (not hand-mocked) idempotency-replay test coverage at both the core layer (a stateful fake port tracking applied edits by key) and the route layer (two genuine PATCH calls against a stateful mock). Added the missing `authorize.test.ts` describe blocks for `investment_transactions:edit`/`:view_audit` (matching this file's established per-action depth) and a `schema.test.ts` assertion for the new `audit_log.idempotencyKey` column's nullable-but-unique-when-present shape. Corrected a test doc comment that overclaimed 8 protected fields when only 7 are runtime-asserted (the 8th, `idempotencyKey`, isn't exposed on the `InvestmentTransaction` type at all, by design).

Independently re-verified after the patch: `pnpm turbo run typecheck lint test build --force` (18/18 green, 375 core + 80 db + 380 web tests), `pnpm lint:boundaries` (clean), `pnpm audit` (clean). A full live-Postgres pass was already completed before the review round (record → edit → audit trail with correct before/after values → adjustment auto-recompute with zero new code → duplicate-PATCH dedup → Owner/Admin-only edit 403 for the transaction's own Partner → self-access audit-trail view 200); the patch round's own concurrency fix was independently live-reproduced-and-confirmed by the implementer, so a second live pass by the orchestrator was not required.

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (blind-hunter) `editTransaction`'s (`packages/db/src/ports.ts`) `database.transaction()` block reads `previousRow` via a plain `SELECT` (not `SELECT ... FOR UPDATE`) before the `UPDATE`. Under two concurrent, genuinely-different edits of the SAME transaction (not a duplicate/replay), the second request's `audit_log` "edit" entry can record a stale `oldValue` (from before the first request committed) instead of the true immediately-prior state — silently hiding that an intervening edit happened, undermining FR41's audit-trail-accuracy guarantee under concurrency. | high (real, financial-audit-integrity concern) | Confirmed via Postgres MVCC/READ COMMITTED semantics: a plain `SELECT` doesn't re-check after waiting for a lock, but a `SELECT ... FOR UPDATE` does. | patch |
| 2 | (verification-gap) The idempotency-replay guarantee (I/O matrix row 7 — arguably this story's most operationally risky behavior) is unverified by any test exercising REAL replay logic, at any layer: the core-level fake port's `editTransaction` has no idempotency check at all (every call unconditionally applies the edit); the route-level "repeated PATCH" test hand-feeds the mock `{edited: false}` rather than calling PATCH twice and observing real dedup; the DB-level `editTransaction`'s actual check-then-update-or-recover logic has zero test coverage beyond its pure sub-helpers. | high (the mechanism AD-5 exists to guarantee is effectively unverified) | Confirmed via direct file read of `investment-transaction.test.ts`'s fake port, `route.test.ts`'s mock setup, and `ports.test.ts`'s coverage scope. | patch |
| 3 | (verification-gap) `authorize.test.ts` has zero test cases for the two new actions (`investment_transactions:edit`, `investment_transactions:view_audit`), breaking this codebase's otherwise-universal convention of a dedicated `describe` block with full `it.each` role coverage per action. `schema.test.ts`'s `audit_log` describe block (still labeled "Story 3.3") has no assertion at all for the new nullable/UNIQUE-when-present `idempotencyKey` column. Route-level tests provide partial indirect coverage for the authorize actions (missing Sub-partner/project_admin/ghost-actor cases) but zero coverage for the schema column. | medium (real regression against an established, consistently-applied codebase testing convention) | Confirmed via grep — zero matches in both files. | patch |
| 4 | (verification-gap) The "byte-identical snapshot fields" test's doc comment claims 8 protected fields but only asserts 7 — `idempotencyKey` is silently excluded because `InvestmentTransaction` (the returned/API type) never exposed that field to begin with (a write-only, internal field, consistent with Story 3.3's original design). Not a functional gap (confirmed by blind-hunter: the `UPDATE`'s `SET` clause structurally cannot touch a field not in its input type), but the comment overclaims. | low (documentation accuracy only) | Confirmed via direct read of `investment-transaction.test.ts` and `InvestmentTransaction`'s type definition. | patch (narrow — fix the comment) |
| 5 | (verification-gap) `add-money/page.tsx`'s new ~209-line Edit dialog/handler has zero test coverage (`page.test.tsx` untouched). | false (no bug found to regress-test against) | Consistent with this project's established pattern (Stories 3.4/3.6) of adding UI tests reactively when a review finds a real defect, not proactively for every new working surface — edge-case-hunter explicitly traced the pre-fill and idempotency-key lifecycle and found both correct. | — |
| 6 | (blind-hunter, edge-case-hunter, verification-gap) No self-access path exists for editing (Owner/Admin-only, confirmed structurally and by test), `sharePercentSnapshot`/`shouldPaySnapshot`/identity fields never touched by the `UPDATE`, `matchesEditRequest`'s cross-transaction collision rejection, self-access resolved against current (not stale) shares, cross-requirement/cross-project 404s, `amount: "0"` accepted with no floor, invalid `paymentMode` 400, optional `reason` correctly landing in `audit_log`, and the Story 3.4 zero-new-recompute-code claim were all independently investigated and confirmed correct. | false (no defect — investigated and confirmed correct) | See each reviewer's report for the specific verification performed. | — |
| 7 | (verification-gap) The core-layer domain type `EditInvestmentTransactionRequest` (raw/unvalidated input) vs. the port-layer `EditInvestmentTransactionInput` (validated) naming deviates from the spec's Code Map, which named both `EditInvestmentTransactionInput`. | — (harmless, mirrors an existing precedent) | Matches the established `RecordInvestmentTransactionInput` (domain)/`CreateInvestmentTransactionInput` (port) naming split from Story 3.3 exactly. Logged here per the Spec Change Log discipline. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `investment-transaction.test.ts` covers `editInvestmentTransaction`'s validation, snapshot-fields-unchanged guarantee, and `listAuditLogForTransaction`
- `pnpm --filter @niveshbook/db test` — expected: schema/port-shape assertions for the new `audit_log` column and the new port methods
- `pnpm --filter @niveshbook/web test` — expected: both new routes' tests cover the full I/O matrix incl. idempotent-replay and self-access vs. co-partner 403
- `pnpm lint` / `pnpm typecheck` / `pnpm build` — expected: clean
- **Live verification:** record a transaction, edit its amount via `PATCH`, confirm the audit trail shows both the create and edit entries with correct before/after values, confirm `GET .../adjustments` reflects the new amount without any extra action, confirm a duplicate `PATCH` with the same idempotencyKey doesn't create a second audit entry, confirm a non-Owner/Admin gets 403 on edit but the transaction's own linked Partner can view its audit trail.

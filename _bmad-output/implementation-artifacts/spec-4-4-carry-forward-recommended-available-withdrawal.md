---
title: 'Carry Forward Recommended Available Withdrawal'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: 'b702164224ea9b1269f376f4185218ccd7a7ba2b'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR24 requires each cycle's Recommended Available Withdrawal to already account for what was kept for later last time — but nothing currently surfaces this as an explicit, forward-looking recommendation.

**Approach:** No new backend mechanism (confirmed with the user 2026-09-24). Story 3.5's carry-forward is a snapshot written at each discrete new funding requirement; withdrawals have no such event — Can Take (4.1) and Withdrawal Adjustment (4.3) are both continuous, cumulative, Project-scoped totals with no round boundary (already shipped, explicit decisions in both stories). Algebraically, since Can Take and Taken are both running lifetime totals, `Can Take − Taken` already equals the AC's formula (`new Base Entitlement + Previous Keep For Later`) — Story 4.3's `keep_for_later` value already **is** the recommendation, continuously. This story is UI-only, in `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx`: add a `recommendedWithdrawalFor(adjustment: AdjustmentChipInfo | null): Money | null` helper — `null` when the adjustment hasn't loaded yet (never render a misleading ₹0); `adjustmentAmount` when `adjustmentType === "keep_for_later"`; `"0"` for `"extra_taken"`/`"none"` (nothing further recommended until back under entitlement, matching AC3's "no Keep for Later balance is created" case) — derived entirely from the existing `getWithdrawalAdjustments` response already fetched by Story 4.3, no API/type change. Render "Recommended Available Withdrawal: {Amount}" per Partner/Sub-partner row next to the existing Withdrawal Adjustment chip, worked-example style (NFR13) — distinct in framing (forward-looking suggestion) from the chip (current status), mirroring Investment's separate "Recommended: ₹X" line next to its Adjustment chip. Add matching test cases to `page.test.tsx` for all three `adjustmentType` values plus the not-yet-loaded case.

**Verified, not assumed:** checked Add Money's actual `openRecordPaymentDialog` directly — it always resets `recordAmount` to `""`, never pre-fills from `recommendedAmount`. Recommended Amount is informational display text only. This story mirrors that exactly — no pre-fill of the Record Withdrawal dialog's Amount field. Per the AC's "any amount can be entered — never enforced," already true via Story 4.2's no-cap decision; nothing further needed there.

</frozen-after-approval>

## Implementation Notes

Implemented exactly per Intent -- UI-only, no backend/API/type changes.

**Files changed:**
- `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.tsx`:
  - Added `import type { Money }` from `@niveshbook/types`.
  - Added `recommendedWithdrawalFor(adjustment: AdjustmentChipInfo | null): Money | null` -- `null` when not loaded, `adjustment.adjustmentAmount` for `keep_for_later`, `"0" as Money` for `extra_taken`/`none`. Pure function, no new fetch, derived entirely from the `AdjustmentChipInfo` already produced by Story 4.3's `getWithdrawalAdjustments` fetch.
  - Added a `RecommendedWithdrawal` component rendering `"Recommended Available Withdrawal: {Amount}"` (renders nothing when the helper returns `null`).
  - Rendered `<RecommendedWithdrawal>` next to `<AdjustmentChip>` for both the Partner row and the Sub-partner row, in a shared `flex flex-wrap` container so the chip and the recommendation line sit side by side (matches the Intent's "next to the existing Withdrawal Adjustment chip").
- `apps/web/app/(dashboard)/projects/[id]/withdraw-money/page.test.tsx`: added a new `describe("WithdrawMoneyPage -- Recommended Available Withdrawal (Story 4.4)")` block with 4 tests covering `keep_for_later` (recommends the adjustment amount), `extra_taken` (recommends `0`), `none` (recommends `0`, AC3's case), and the not-yet-loaded case (renders nothing, never a misleading ₹0).

**Surprise / pre-existing-test fallout (not a scope change, just a ripple):** because the new Recommended line and the existing Withdrawal Adjustment chip now legitimately show the *same* amount text in two cases --
- `keep_for_later`: chip amount and Recommended amount are numerically identical by the Intent's own algebra, so both render e.g. "₹90,000" on the same row;
- `none`: the Recommended line now legitimately renders "₹0" (AC3's case), where before this story no "₹0" ever appeared anywhere on the page for a `none` adjustment --

four pre-existing Story 4.3 tests that queried `screen.getByText("₹X")`/`screen.queryByText("₹0")` page-wide became ambiguous or falsely-failing. Fixed by scoping those specific assertions to the chip element itself (`within(chip)`, where `chip` is the `StatusChip`'s own `<span>` found via its label text) rather than the whole page/row -- this preserves each test's original intent (the chip carries its own correct amount / carries no spurious amount) without asserting something no longer true now that a second, legitimately-duplicate or legitimately-zero amount exists elsewhere on the row. No production behavior was changed to make tests pass; only the test scoping was corrected. All 478 web tests pass, `pnpm --filter web typecheck` and `pnpm --filter web lint` are clean.

No intent gaps or scope growth found -- the algebraic equivalence the Intent describes (`Can Take − Taken == new Base Entitlement + Previous Keep For Later`) held exactly as stated, so no new computation, type, or API was needed.

**Review round 2 (orchestrator-directed fixes, 2026-09-24):**
- `recommendedWithdrawalFor`'s zero case now uses `toMoney("0")` (imported from `@niveshbook/core`, already resolved by the file's `packages/core` import path) instead of the raw `"0" as Money` cast.
- `findPartnerAdjustment(partner.partnerId)`/`findSubPartnerAdjustment(...)` are now each computed once per row (`partnerAdjustment`/`subAdjustment` local consts, inside block-bodied `.map()` callbacks) and passed to both `<AdjustmentChip>` and `<RecommendedWithdrawal>`, instead of being called twice per row.
- **Orchestrator-authorized refinement to the frozen Intent** (not something I decided unilaterally): `recommendedWithdrawalFor` now returns `null` (renders nothing) for `adjustmentType === "none"`, matching Add Money's "Recommended: ₹X" line, which suppresses itself rather than restating a figure the chip already implies. `"extra_taken"` still recommends `toMoney("0")` -- that zero is informative (nothing further recommended until back under entitlement), unlike `"none"`'s "nothing to say at all". Updated the `"none"`-case test to assert the line renders nothing (previously asserted it rendered "₹0").
- Added a Sub-partner-row test for `RecommendedWithdrawal` (sub1 `keep_for_later` recommends ₹20,000, sub2 `extra_taken` recommends ₹0, never swapped), mirroring Story 4.3's existing `findSubPartnerAdjustment` chip test.
- Two doc-comment additions requested as optional polish, both included: `recommendedWithdrawalFor`'s doc now explains why `extra_taken` can't reuse `Can Take − Taken` directly (would be negative); `RecommendedWithdrawal`'s doc now explains the missing `ml-1 mt-1` margin is intentional (spacing now owned by the parent flex container's `gap-x-3`).
- Re-verified after these fixes: `pnpm --filter web typecheck` clean, `eslint` on both changed files clean, and the file's own test suite (23 tests, up from 22) passes. Did not re-run the full web suite per the coordinator's instruction to scope verification to the edited files.

## Review Triage Log

- `recommendedWithdrawalFor`'s zero case used a raw `"0" as Money` cast instead of `toMoney("0")` (already available via `@niveshbook/core`, which the file already imports from) — real, bypasses validated construction for no benefit. **patch, then reverted by the orchestrator**: applying this patch broke `next build` — `@niveshbook/core` has no subpath exports, so any *runtime* (non-type-only) import from it pulls in the whole barrel (`index.ts`'s `export * from "./auth"`), including `auth.ts`'s `argon2` native-module dependency, into this `"use client"` page's browser bundle (`Module not found: Can't resolve 'fs'`, traced directly to this import). Reverted to the original `"0" as Money` cast with a comment explaining why, since `"0"` is a static literal here, not untrusted input — the validation `toMoney` would perform was never actually needed. The original finding's "no benefit" framing was itself the error: the cast had a real, load-bearing benefit (client-bundle safety) the reviewer didn't check for.
- `findPartnerAdjustment`/`findSubPartnerAdjustment` were each called twice per row (once for the chip, once for the new Recommended line) instead of computed once into a local and passed to both — real DRY/perf regression introduced by this diff, not pre-existing. **patch**
- No test exercises `RecommendedWithdrawal` on a Sub-partner row (all 4 new tests use partner-level fixtures only), unlike Story 4.3's own sub1/sub2-row chip coverage — real coverage gap. **patch**
- The Recommended line always renders "₹0" next to a `"none"` (No Adjustment) chip, unlike Add Money's mirrored "Recommended: ₹X" line, which `mergeRecommendedAmounts` suppresses entirely when it wouldn't add information beyond the plain figure already shown — a real, if minor, consistency gap against the precedent this story explicitly mirrors (not a data-correctness issue; the frozen Intent explicitly specified this behavior, so the fix is a small, orchestrator-authorized refinement, not a unilateral spec reinterpretation). **patch**
- No single test asserts the chip and Recommended line together on one row — rejected: both are independent pure-function outputs with no shared mutable state: the separate describe blocks already cover each correctly. **low, rejected** (would add a test with no additional bug it could catch beyond what's already covered)
- The JSDoc doesn't spell out why `extra_taken` can't reuse the "Can Take − Taken" framing directly (would be negative) — cosmetic doc-clarity nit, folded into the patch above rather than a separate round. **low, folded into patch**
- The new `<p>` doesn't carry its siblings' `ml-1 mt-1` margin (intentional — spacing now owned by the parent flex container's `gap-x-3`) — cosmetic, worth a one-line comment to prevent a future "fix," folded into the patch above. **low, folded into patch**
- (orchestrator, caught during full-suite re-verification after the patch round) One `packages/db` live-Postgres test (`withdrawal-transaction-port.test.ts`'s `recordTransaction` idempotency test) failed twice more this session on a parallel `pnpm turbo run` (3rd occurrence overall, across Stories 4.3 and 4.4), always on a unique-constraint collision, always passing cleanly in isolation (127/127) on immediate retry — a genuine, reproducible flake under `turbo`'s parallel package execution, not caused by this story's (web-only) changes. **defer** — logged to `deferred-work.md` for a future look at this suite's isolation under parallel runs.

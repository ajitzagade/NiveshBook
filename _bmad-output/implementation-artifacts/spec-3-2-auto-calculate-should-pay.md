---
title: 'Auto-Calculate Should Pay'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
baseline_commit: '395fb2f54fcbb875b029b8b87d04b59bed53e000'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A funding requirement (Story 3.1) has an amount, but nobody can see what each Partner/Sub-partner owes from it — Should Pay must be computed automatically from Share % (never manual math), split exactly across everyone with no leftover paise, and shown with a worked-example hint.

**Approach:** A pure `packages/core` calculation module (`should-pay.ts`) computes Should Pay for every current Partner and, one level down, every current Sub-partner, against a specific funding requirement's amount. The split is done as **one single largest-remainder allocation across a flattened list** of every leaf percentage in the Project (each Partner's *retained* percent — their own share minus their current Sub-partners' shares — plus every Sub-partner's percent), not as two independently-rounded splits (Partner-level, then Sub-partner-level) composed by subtraction. This is the key design decision this story makes: composing two independent roundings can make a Partner's computed "retained" amount go negative by a paisa even when their Sub-partner allocation is legitimately within their own share (flooring isn't additive) — a single flat split avoids that class of bug entirely by construction, since every entry (Own + every Sub) comes from the same allocation and the partner's own row total is simply the exact sum (`ownShouldPay + Σ subShouldPay`), never a subtraction. New `decimal-math.ts` primitives: `splitMoneyByPercents` (general largest-remainder split, requires its percent list to sum to exactly 100%), `subtractPercents` (throws if the result would go negative), `sumMoney`. A new Owner/Admin-only `GET .../should-pay` endpoint per funding requirement, and an expand affordance on the existing Add Money page (Story 3.1) showing the breakdown, reusing `ShareRow`/`ShareList`/`DistributedCheck`/`Amount`.

**Decisions (resolved 2026-09-24):**
- **Should Pay requires the current Partner Shares to total exactly 100%, and each Partner's current Sub-partner Shares to not exceed that Partner's own share.** FR16's formula (`Share % × requirement amount`) only has a coherent, exact-sum-to-`amount` meaning (AC3) when the underlying shares are fully and validly allocated. Epic 2 deliberately never blocks saving an over/under-100% state (informational-only, `DistributedCheck`'s messaging), but Should Pay is *money that must reconcile exactly* — unlike a percentage running-total, there's no sensible non-error answer for "who owes the missing/extra 10%". When the precondition fails, the endpoint returns 409 with a plain-language message ("Should Pay isn't available until Partner Shares total 100%.") rather than computing a nonsensical or negative split. This is a narrower, calculation-specific gate — it changes nothing about what Epic 2 lets Owner/Admin *save*.
- **The two-level split (Partner retained % + each Sub-partner %) is computed as ONE flat largest-remainder allocation, not two nested ones.** Investigated first: composing an independent Partner-level split with an independent Sub-partner-level split and taking `ownShouldPay = partnerShouldPay − Σ(subShouldPay)` can produce a negative `ownShouldPay` purely from two separate roundings disagreeing by a paisa, even when the Sub-partner allocation is legitimately ≤ the Partner's own share — flooring a whole isn't the same as flooring its parts separately. Flattening every Project's leaf percentages (retained-per-Partner + every Sub-partner) into one `splitMoneyByPercents` call sidesteps this: every leaf is independently exact-summed with the *rest of the Project*, and a Partner's own row is a plain, always-non-negative addition of its own leaves — never a subtraction that could go negative.
- **`should_pay:view` is Owner/Admin-only in this story**, mirroring Story 3.1's identical `investment_requirements:list` precedent ("how a Partner/Sub-partner eventually sees their own Should Pay is [a later] story's job"). The AC's "As a Partner or Sub-partner" framing describes whose money is being calculated, not who calls this API today — Epic 5 (`5-5-partner-dashboard`, `5-6-sub-partner-dashboard`) is the planned, purpose-built home for a person's own self-service view; opening scoped API access now, before that consuming UI exists, would be speculative capability this codebase has consistently avoided building ahead of a real consumer (e.g. `Amount`/`Checkbox` were flagged exactly for this before Story 3.1/2.6 gave them one). The calculation itself is fully correct and testable regardless of who's authorized to view it yet.
- **`SubPartnerSharePort` gains a `listByProjectId` method**, mirroring `PartnerSharePort`'s existing one. `subpartner_shares` already has a `projectId` column; without this, computing Should Pay for a whole Project would require an N+1 fan-out (one `listByPartnerId` call per Partner) that the existing per-Partner-expand UI can afford lazily but a single server-side calculation endpoint shouldn't need to.
- **`splitMoneyByPercents` internally validates its percent list sums to exactly 100% and throws if not**, rather than trusting callers. Defense in depth matching this codebase's established style (e.g. Story 3.1's `parseMoneyScaled` 12-digit cap existing independently of any caller-side check) — `should-pay.ts` already guarantees this by construction before calling it, so this should never fire in practice, but a `packages/core` arithmetic primitive silently producing a wrong total for a malformed input would be a much worse failure mode than an explicit throw.

## Boundaries & Constraints

**Always:** `GET /api/projects/[id]/investment-requirements/[requirementId]/should-pay` requires a valid session (401) and `authorizeScope()` for `"should_pay:view"` (Owner/Admin-only), checked immediately after the session check. Project and requirement existence are checked before any calculation runs (404 for either missing, or for a `requirementId` that doesn't belong to the given `projectId`). Every Should Pay value returned is a `Money` computed exclusively via `decimal-math.ts`'s new `splitMoneyByPercents`/`subtractPercents`/`sumMoney` — no `+`/`-`/`*` on a money or percent string anywhere else. The sum of every Should Pay value returned (every Partner's `ownShouldPay` plus every Sub-partner's `shouldPay`) always equals the requirement's `amount` exactly.

**Never:** No write path — this story only reads/computes, never records a payment (Story 3.3) or persists a Should Pay value anywhere (it's always computed live from current shares, never stored/snapshotted — snapshotting onto a transaction row is Story 3.3's job per AD-3). No change to `should_pay:view`'s Owner/Admin-only scope in this story (see Decisions). No renormalization or silent correction of an over/under-100% Partner Share total — that state is surfaced as an explicit 409, never guessed around.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Even split | Requirement ₹10,00,000; Shares A=50%, B=30%, C=20% | 200; A=₹5,00,000, B=₹3,00,000, C=₹2,00,000 | N/A |
| Nested split | Same requirement; Partner A's Sub-partners Sub1=12.5%, Sub2=12.5% (A's own share still 50%) | 200; A.ownShouldPay=₹2,50,000, Sub1=₹1,25,000, Sub2=₹1,25,000, A.shouldPay (total)=₹5,00,000 | N/A |
| Uneven split (rounding) | Requirement ₹10,00,000; Shares 33.33% / 33.33% / 33.34% | 200; three values that don't each divide evenly but sum to exactly ₹10,00,000 | N/A |
| Partner Shares don't total 100% | Shares sum to 90% or 110% | 409, no calculation returned | `{code: "shares_not_fully_allocated", message}` |
| A Partner's Sub-partners exceed their own share | Partner A=50%, Sub1=30%, Sub2=30% (sums to 60% > 50%) | 409, no calculation returned | `{code: "sub_partner_shares_over_allocated", message}` |
| Non-Owner/Admin attempts to view | Partner/Sub-partner role, direct API call | 403, checked before any DB read | `{code: "forbidden"}` |
| Nonexistent/malformed project or requirement id | Any caller | 404 | `{code: "not_found"}` |
| Requirement exists but belongs to a different Project | Mismatched `projectId`/`requirementId` in the URL | 404 | `{code: "not_found"}` |
| Project has no Partner Shares yet | Fresh Project | 409 (0% ≠ 100%) | `{code: "shares_not_fully_allocated", message}` |

</frozen-after-approval>

## Code Map

- `packages/core/src/decimal-math.ts` — add `splitMoneyByPercents(amount: Money, percents: readonly Percent[]): Money[]` (largest-remainder split via `BigInt` fixed-point math — the amount×percent product can exceed `Number`'s safe-integer range, unlike `parseMoneyScaled`'s own bounded values; validates the percent list sums to exactly `"100"`, throws `SplitPercentTotalError` otherwise); `subtractPercents(minuend: Percent, subtrahend: Percent): Percent` (throws `NegativePercentResultError` if the result would be negative); `sumMoney(values: readonly Money[]): Money` (mirrors `sumPercents`, plain fixed-point addition).
- `packages/core/src/should-pay.ts` (new) — `SharesNotFullyAllocatedError`, `SubPartnerSharesOverAllocatedError`; `PartnerShouldPay { partnerId, name, sharePercent, shouldPay, ownShouldPay, subPartners: SubPartnerShouldPay[] }`, `SubPartnerShouldPay { subPartnerId, name, sharePercent, shouldPay }`; `computeShouldPay(requirement, partnerShares, subPartnerSharesByPartnerId, deps?)` — validates the two preconditions, builds the flattened leaf-percent list (retained-per-Partner + every Sub-partner), calls `splitMoneyByPercents` once, reassembles into the nested `PartnerShouldPay[]` shape with each Partner's `shouldPay` as `sumMoney([ownShouldPay, ...subShouldPay])`.
- `packages/core/src/subpartner-share-port.ts` — add `listByProjectId(projectId: string): Promise<SubPartnerShare[]>`, mirroring `PartnerSharePort`'s existing method.
- `packages/core/src/investment-requirement-port.ts` — add `findById(id: string): Promise<InvestmentRequirement | null>`; fix the stale `listByProjectId` doc comment (already ordered as of Story 3.1's patch, comment still says "no particular guaranteed order").
- `packages/core/src/authorize.ts` — add `"should_pay:view"` to the `Action` union and `PERMISSIONS` (`new Set(["owner_admin"])`, no self/scope-access entry — see Decisions).
- `packages/core/src/index.ts` — barrel-export `should-pay.ts`.
- `packages/db/src/ports.ts` — implement `listByProjectId` on `createSubPartnerSharePort`; implement `findById` on `createInvestmentRequirementPort`.
- `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/should-pay/route.ts` (new) — `GET`: session → `authorizeScope("should_pay:view")` → project/requirement existence (incl. cross-project mismatch → 404) → fetch current Partner Shares + current Sub-partner Shares (reduced via the existing `listCurrentPartnerShares`/`listCurrentSubPartnerShares`-style reduction, grouped by `partnerId`) → `computeShouldPay` → 200, or map its two domain errors to 409.
- `apps/web/lib/should-pay.ts` (new) — client fetch helper `getShouldPay(projectId, requirementId)`.
- `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — add a per-requirement expand affordance (mirrors the Shares page's per-Partner expand): fetches and renders the Should Pay breakdown (`ShareRow`/`ShareList` per Partner, Sub-partners indented one level with `↳`, `Amount` for every money value, a worked-example hint line, and the 409 states rendered as a plain message rather than a number).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/decimal-math.ts` + tests — `splitMoneyByPercents`/`subtractPercents`/`sumMoney`
- [x] `packages/core/src/should-pay.ts` + tests — `computeShouldPay`, both precondition errors, the flat-split reassembly
- [x] `packages/core/src/subpartner-share-port.ts` + `packages/db/src/ports.ts` — `listByProjectId`
- [x] `packages/core/src/investment-requirement-port.ts` + `packages/db/src/ports.ts` — `findById`
- [x] `packages/core/src/authorize.ts` + tests — `should_pay:view` action
- [x] `apps/web/app/api/projects/[id]/investment-requirements/[requirementId]/should-pay/route.ts` + test — GET, full I/O matrix
- [x] `apps/web/lib/should-pay.ts` — client fetch helper
- [x] `apps/web/app/(dashboard)/projects/[id]/add-money/page.tsx` — Should Pay expand/breakdown UI, incl. a distinct "Own" line (patch round 1) and a focused regression test

**Acceptance Criteria (from epics.md Story 3.2):**
- Given the ₹10,00,000 requirement and Share % 50/30/20 for A/B/C, when any authorized viewer opens the funding round, then Should Pay shows A=₹5,00,000, B=₹3,00,000, C=₹2,00,000, computed via the single decimal-math module (AD-2).
- Given Partner A's internal split (Own 25%, Sub1 12.5%, Sub2 12.5%), when the same requirement is viewed, then Should Pay shows Own=₹2,50,000, Sub1=₹1,25,000, Sub2=₹1,25,000.
- Given a percentage split that doesn't divide evenly, when Should Pay is calculated, then the remainder is allocated via the largest-remainder method (AD-2), and the sum of all Should Pay values equals the requirement amount exactly.

## Implementation Notes

`computeShouldPay` omits the Code Map's suggested `deps?` parameter — the function is genuinely pure (no port calls), so an unused `deps` parameter would be dead signature surface (Review Triage Log row 6).

## Spec Change Log

Patch round 1 (findings 1-5 of the Review Triage Log): fixed `ownShouldPay` never rendering in the Add Money page's Should Pay breakdown (added a distinct "Own" line, corrected the worked-example hint to use `ownShouldPay`); fixed a stuck-"Loading…" bug in `toggleShouldPay`'s collapse handling; strengthened `should-pay/route.test.ts` to cover every I/O-matrix row at the HTTP boundary (Partner C's value, both Sub-partners' exact values, the uneven-split row, the over-100% row, `body.code`/`body.message` on 404s/409s); added a `decimal-math.test.ts` case proving `BigInt` is load-bearing (a plain-`Number` equivalent misallocates the leftover paisa at the same input scale); added a focused `add-money/page.test.tsx` regression test for the two UI fixes. Independently re-verified: `pnpm turbo run typecheck lint test build --force` (18/18 green, 252 core + 269 web tests), `pnpm lint:boundaries` (clean), `pnpm audit` (clean).

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (blind-hunter) `add-money/page.tsx`'s Should Pay breakdown never renders `partner.ownShouldPay` anywhere — the `ShareRow` action amount and the worked-example hint both use `partner.shouldPay` (the combined total, `ownShouldPay + Σ subShouldPay`), so a Partner with Sub-partners shows the same pooled total a Partner with no Sub-partners would, with their actual retained ("Own") amount displayed nowhere. | high (confirmed, contradicts a frozen AC verbatim) | `grep -n "ownShouldPay" add-money/page.tsx` → zero matches. Directly contradicts AC2's explicit wording ("Should Pay shows Own=₹2,50,000, Sub1=₹1,25,000, Sub2=₹1,25,000") and diverges from this story's own Code Map, which says to mirror the Shares page's established Own/retained-vs-total split (`retainedMessage()` in `shares/page.tsx`) — that precedent already solves this exact ambiguity one screen over. | patch |
| 2 | (edge-case-hunter) `toggleShouldPay`'s collapse branch resets `expandedRequirementId`/`expandedRequirementIdRef` but never resets `shouldPayByRequirement[requirementId]`. If a user collapses a panel while its fetch is still in flight, the in-flight response is correctly dropped by the stale-response guard, but the state stays stuck at `{status:"loading"}` forever — re-expanding later reads that stale `"loading"` state and (per the `if (!existing \|\| existing.status === "error")` guard) never re-triggers a fetch, so the panel shows "Loading Should Pay…" permanently with no recovery short of a full page reload. | high (real, no recovery path, live-reproducible from the code) | Confirmed by direct read of `toggleShouldPay`/`refreshShouldPay` (`add-money/page.tsx`): the collapse branch (lines ~150-153) never touches `shouldPayByRequirement`, and the re-expand guard treats leftover `"loading"` state as "already fetching." No test currently exercises this interaction. | patch |
| 3 | (verification-gap) Route-level tests under-verify several I/O-matrix rows the spec's own Verification section claims are covered: AC1's route test never asserts Partner C's `shouldPay`; AC2's route test never asserts `subPartners[0]/[1].shouldPay`'s exact values; the "uneven split / largest-remainder" row and the "Partner Shares sum OVER 100%" row (spec explicitly lists both 90% and 110%) have no route-level test at all (only core-level); malformed-id 404 tests check status but not `body.code`; the two 409 tests check `body.code` but never `body.message`. | medium (real coverage gap vs. the spec's own Verification claim) | Confirmed by reading `route.test.ts` against the I/O matrix row-by-row; core-level tests (`should-pay.test.ts`) do cover the underlying logic, so this is a route/HTTP-boundary-only gap, not a logic gap. | patch |
| 4 | (verification-gap) `splitMoneyByPercents`'s existing test with a 12-digit amount (`decimal-math.test.ts`, `"999999999999"` / `33.3333`/`33.3333`/`33.3334`) does not actually exercise the precision this story's Decisions cite as the reason `BigInt` is required — hand-simulating a plain-`Number` version of the function against that exact input produces a byte-identical result, so the test would still pass if `BigInt` were reverted to `Number`. | medium (real — the stated justification for a design decision is currently unverified) | Verified independently by the reviewing agent via hand computation of the raw numerator/precision-loss magnitude at that input's scale. | patch |
| 5 | (verification-gap) `add-money/page.tsx` has zero automated test coverage. | — (pre-existing, not introduced by this story) | Confirmed via `git log`: the page was created test-free in Story 3.1 (`395fb2f`); no `(dashboard)` route page in this codebase has ever had a `.test.tsx`. Not a new gap — but since this review round is patching two real bugs in this exact file (findings #1, #2), a focused regression test for those two fixes is now in scope (see patch dispatch), without taking on full-page coverage as a separate, disproportionate task. | patch (narrow — regression tests for #1/#2 only) |
| 6 | (verification-gap) The Code Map's suggested `computeShouldPay(requirement, partnerShares, subPartnerSharesByPartnerId, deps?)` signature includes a `deps?` parameter the actual implementation omits. | false (harmless, correctly justified) | `computeShouldPay` is genuinely pure (no port calls, confirmed by both verification-gap and blind-hunter independently reading its imports/body) — an unused `deps` parameter would be dead signature surface. Logged here per the Spec Change Log discipline rather than left as a silent, unexplained deviation. | — |
| 7 | (verification-gap) The spec's "Tasks & Acceptance" checkboxes were left unchecked despite the work being complete. | — (documentation hygiene, not a code gap) | Corrected directly by the orchestrator at finalization — no implementer patch needed. | — |
| 8 | (blind-hunter, edge-case-hunter, verification-gap) `splitMoneyByPercents`'s BigInt arithmetic, `computeShouldPay`'s flattened single-split design, the route's authorization/existence-check ordering, 403/404/409 responses never leaking should-pay data, `subtractPercents`'s equal-value/mixed-decimal-place cases, `computeShouldPay`'s missing-vs-empty-array sub-partner handling, and the cross-project `requirementId` 404 case were all independently investigated by at least one reviewer and confirmed correct. | false (no defect — investigated and confirmed correct) | See each reviewer's report for the specific verification performed (BigInt overflow/sign analysis, algebraic proof of the flat-split's always-non-negative composition, live code-path tracing of the route's ordering, hand-simulated arithmetic for edge percents). | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `decimal-math.test.ts` covers `splitMoneyByPercents` (even split, uneven/largest-remainder split, non-100%-total throw), `subtractPercents`, `sumMoney`; `should-pay.test.ts` covers both ACs' worked examples plus both precondition errors
- `pnpm --filter @niveshbook/db test` — expected: schema/port-shape assertions unaffected, or updated for the two new port methods
- `pnpm --filter @niveshbook/web test` — expected: route test covers the full I/O matrix, incl. 403-before-DB-read ordering and the 404-on-cross-project-mismatch case
- `pnpm lint` — expected: clean (`noRawMoneyArithmetic`: only `decimal-math.ts` touches a money/percent string with `+`/`-`/`*`)
- `pnpm typecheck` — expected: clean across all packages
- `pnpm build` — expected: clean
- **Live verification:** apply against a real Project with Partner Shares (incl. one Partner with Sub-partners) totaling 100%; confirm the should-pay endpoint's numbers match AC1/AC2 exactly; temporarily set shares to a non-100% total and confirm the 409; confirm a non-Owner/Admin session gets 403.

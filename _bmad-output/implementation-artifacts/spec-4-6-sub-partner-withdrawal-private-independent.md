---
title: 'Sub-partner Withdrawal (Private, Independent)'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: '30dc846d13a44e5a232aef0df0568b8d3d43bbcd'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 4.1–4.3's calculation logic already computes Can Take/Taken/Withdrawal Adjustment for every current Partner *and* Sub-partner independently (per-share, never aggregated across siblings) — the AC's worked example is arithmetic the codebase can already produce exactly, unchanged. What's actually missing is *access*: `withdrawal_transactions:list`/`withdrawal_adjustments:view` are still Owner/Admin-only (Stories 4.2/4.3's deliberate, documented deferral) — today, AC2 ("Partner B attempts to view it → 403") is only *vacuously* true, since no Partner (including the legitimate owner) can view any withdrawal data at all.

**Approach:** Mirrors Story 3.6's exact precedent — its own fork, resolved the same way. Add ONE new, narrow, self-access-gated endpoint, `GET /api/projects/[id]/my-withdrawal-status?partyType=X&shareId=Y` (Project-scoped, no `requirementId` segment, matching Story 4.1/4.3's flat withdrawal-domain URL shape, not investment's per-requirement nesting). It reuses `computeCanTake`/`computeWithdrawalAdjustment` exactly as-is (zero changes to Stories 4.1–4.4's core logic), computes the full tree server-side, then returns only the one requested party's entry — a Partner's own entry includes their nested current Sub-partners; a Sub-partner's own entry is theirs alone. `authorize()`'s single-resource self-access idiom (Story 4.2's `withdrawal_transactions:create` precedent) gates it — the target share's current `userId` is resolved before authorizing, so a co-Partner requesting someone else's `shareId` gets 403, reusing Story 2.4's privacy mechanism unchanged.

**Decisions (resolved 2026-09-25), pre-applying lessons Story 3.6's own review round had to discover the hard way:**
- **No client fetch helper.** Story 3.6 shipped one, then deleted it in its own patch round as dead code with zero consumers, contradicting its own "don't build ahead of a real consumer" principle. Skipped from the start here — Epic 5 adds it when it has a real consuming screen.
- **No redesign of `withdrawal-transactions`/`withdrawal-adjustments`'s existing broad endpoints.** They stay Owner/Admin-only, unchanged (Open/Closed — extend via a new implementation).
- **`shared.ts`'s query-param helper returns the *trimmed* `shareId`**, not just validates its trimmed length (Story 3.6 shipped this bug — validated-trimmed-but-returned-untrimmed — and had to patch it; avoided here from the start).
- **`GET .../withdrawal-adjustments` already upserts `withdrawal_adjustments` on every view (Story 4.3, unchanged) — this new self-access endpoint does the same upsert too**, since it also calls `computeWithdrawalAdjustment` internally. Consistent, not a new side-effect class.
- **Test coverage baked in from the start** (Story 3.6 had to add these in its own patch round): Owner/Admin viewing a `sub_partner` target; a Partner with zero Sub-partners returning `subPartners: []`; a Sub-partner attempting to view their own parent Partner's status (403).

## Boundaries & Constraints

**Always:** `GET /api/projects/[id]/my-withdrawal-status` requires a valid session (401). The target share (`partyType`+`shareId` query params) is resolved against the Project's *current* Partner/Sub-partner Shares (404 if no match) before `authorize()` is called for a new `"withdrawal_status:view"` action with `resourceRef.ownerId` set to that share's `userId` — self-access allowed; Owner/Admin always allowed; anyone else 403. Project existence is checked before any share/computation work.

**Never:** No change to `withdrawal-transactions`/`withdrawal-adjustments` routes' existing rules. No new write path — pure `GET`. No exposing a Sub-partner's sibling data, or another Partner's data, under any circumstance. No new schema/table — every value is already computed by Stories 4.1/4.3's existing functions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worked example, independent siblings | Partner A Can Take ₹1,25,000 (takes it all); Sub1 Can Take ₹62,500 (takes ₹0); Sub2 Can Take ₹62,500 (takes it all) | Sub1's own view: `keep_for_later` ₹62,500; Sub2's own view: `none` — recorded independently, neither blocks/forces the other | N/A |
| Sub-partner's own view | Sub1's own linked session | 200; Sub1's own single entry only, no sibling/parent data | N/A |
| Partner's own view (includes nested subs) | Partner A's own linked session | 200; A's entry incl. nested current Sub-partners | N/A |
| Partner with zero Sub-partners | Any Partner with none currently | 200; `subPartners: []` | N/A |
| Co-Partner attempts to view Partner A's status | Partner B's session, `shareId=<Partner A>` | 403 | `{code: "forbidden"}` |
| Sub-partner attempts to view their own parent Partner's status | Sub1's session, `shareId=<Partner A>` | 403 | `{code: "forbidden"}` |
| Owner/Admin views any share, incl. `partyType=sub_partner` | Owner/Admin session | 200 | N/A |
| Unlinked share (`userId: null`) | Any non-Owner/Admin caller | 403 | `{code: "forbidden"}` |
| `shareId` doesn't match any current share | Nonexistent/malformed `shareId` | 404 | `{code: "not_found"}` |
| Partner Shares not fully allocated | Reused from Story 4.1 | 409 `shares_not_fully_allocated` | `{code: "shares_not_fully_allocated"}` |
| Nonexistent/malformed project id | Any caller | 404 | `{code: "not_found"}` |

</frozen-after-approval>

## Code Map

- `packages/core/src/authorize.ts` — add `"withdrawal_status:view"` to `Action`/`PERMISSIONS` (`new Set(["owner_admin"])`) and to `SELF_ACCESS_ACTIONS`, mirroring `withdrawal_transactions:create`'s exact shape.
- `packages/core/src/withdrawal-status.ts` (new) — `extractWithdrawalStatus(partyType, shareId, adjustments: PartnerWithdrawalAdjustment[])`: pure function finding and returning the one requested party's entry (throws a reused-shape `ShareNotFoundError`, mirroring `investment-status.ts`'s precedent). For `partyType: "partner"`, returns the full `PartnerWithdrawalAdjustment` (incl. nested `subPartners`); for `partyType: "sub_partner"`, returns just that `SubPartnerWithdrawalAdjustment` entry.
- `packages/core/src/index.ts` — barrel-export.
- `apps/web/app/api/projects/[id]/my-withdrawal-status/route.ts` (new) — `GET`, query params `partyType`/`shareId`. Ordering: session (401) → project 404 → fetch current Partner/Sub-partner Shares + `sumActiveAmountByProjectId` + `listByProjectId` (withdrawal transactions), mirroring `withdrawal-adjustments/route.ts`'s existing fetch → resolve target share (404) → `authorize()` for `"withdrawal_status:view"` (403) → `computeWithdrawalAdjustment` (409 on its two precondition errors) → `extractWithdrawalStatus` → 200, or 404 if the resolved share isn't in the computed tree (defense in depth).
- `apps/web/app/api/projects/[id]/my-withdrawal-status/shared.ts` (new) — query-param validation, returning the *trimmed* `shareId` (see Decisions).
- `packages/core/src/withdrawal-adjustment.test.ts` — add the worked example's independent-siblings scenario (Partner A + Sub1 + Sub2, exact AC figures).
- `apps/web/app/api/projects/[id]/withdrawal-adjustments/route.test.ts` — add the same scenario at the route level.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/authorize.ts` + tests — `withdrawal_status:view` self-access action
- [x] `packages/core/src/withdrawal-status.ts` + tests — `extractWithdrawalStatus`, worked example, sub-partner-only-own-entry, zero-subs case
- [x] `apps/web/app/api/projects/[id]/my-withdrawal-status/route.ts` + test — GET, full I/O matrix incl. self-access vs. co-partner 403, sub-partner-vs-parent 403, Owner/Admin + sub_partner target
- [x] `apps/web/app/api/projects/[id]/my-withdrawal-status/shared.ts` — query validation, trimmed `shareId`
- [x] `packages/core/src/withdrawal-adjustment.test.ts` + `apps/web/app/api/projects/[id]/withdrawal-adjustments/route.test.ts` — independent-siblings worked-example coverage

**Acceptance Criteria (from epics.md Story 4.6):**
- Given Partner A withdraws their full ₹1,25,000, Sub1 withdraws ₹0, Sub2 withdraws their full ₹62,500, when each transaction is recorded independently, then Sub1 shows Keep for Later ₹62,500 and Sub2 shows no adjustment — neither blocks or forces the other.
- Given this data, when Partner B attempts to view it, then 403 (enforced by Story 2.4).

## Implementation Notes

Implemented exactly per the Code Map -- one new `packages/core` module (pure extraction, zero changes to Stories 4.1-4.4's calculation logic), one new self-access `authorize()` action, and one new narrow route mirroring `my-investment-status/route.ts`'s Story 3.6 shape one ledger over. `withdrawal-adjustments`/`withdrawal-transactions`'s existing Owner/Admin-only broad endpoints were not touched.

**Files changed:**
- `packages/core/src/authorize.ts`: added `"withdrawal_status:view"` to `Action`, to `PERMISSIONS` (`new Set(["owner_admin"])`), and to `SELF_ACCESS_ACTIONS` -- identical shape to `investment_status:view`/`withdrawal_transactions:create`.
- `packages/core/src/authorize.test.ts`: new `describe` block, 8 tests (owner_admin-for-anyone, Partner/Sub-partner self-access incl. case-insensitive UUID match, co-Partner denied, Sub-partner-viewing-parent denied, unlinked/empty `ownerId` denied, nonexistent actor denied).
- `packages/core/src/withdrawal-status.ts` (new): `extractWithdrawalStatus`, overloaded on the literal `partyType`, mirroring `investment-status.ts`'s `extractInvestmentStatus` exactly. Throws the withdrawal domain's existing `WithdrawalShareNotFoundError` (reused unchanged from `withdrawal-transaction.ts`, not a redefinition -- that module already named its own copy this way to avoid a barrel collision with `investment-transaction.ts`'s `ShareNotFoundError`).
- `packages/core/src/withdrawal-status.test.ts` (new): 8 tests against a hand-built tree reproducing the AC's exact worked example (Partner A Can Take 1,25,000/taken 1,25,000/none; Sub1 Can Take 62,500/taken 0/keep_for_later; Sub2 Can Take 62,500/taken 62,500/none), plus zero-subs, co-Partner-still-resolves (privacy is the route's job, not this pure function's), and not-found cases for both party types.
- `packages/core/src/index.ts`: barrel-export added (`export * from "./withdrawal-status"`).
- `apps/web/app/api/projects/[id]/my-withdrawal-status/route.ts` (new): `GET`, Project-scoped (no `requirementId` segment). Ordering: session (401) -> project existence (404) -> query params parsed (400 `invalid_request`) -> current Partner/Sub-partner Shares + `sumActiveAmountByProjectId` + `listByProjectId` fetched in parallel (mirroring `withdrawal-adjustments/route.ts`'s existing fetch) -> target share resolved (404 `not_found`) -> `authorize()` for `"withdrawal_status:view"` (403 `forbidden`) -> `computeWithdrawalAdjustment` (409 on its two precondition errors; this call is also what upserts `withdrawal_adjustments` on every view, the same existing side effect as `withdrawal-adjustments/route.ts`, not a new one) -> `extractWithdrawalStatus`, branched on the literal `partyType` since a union-typed argument can't select the overload on its own -> 200.
- `apps/web/app/api/projects/[id]/my-withdrawal-status/shared.ts` (new): `parseQueryParams` returns the *trimmed* `shareId` directly (this story's Decisions -- Story 3.6 shipped the validated-trimmed-but-returned-untrimmed bug and had to patch it; avoided here from the start), and `shareNotFoundResponse`.
- `apps/web/app/api/projects/[id]/my-withdrawal-status/route.test.ts` (new): full I/O matrix -- 401, malformed/nonexistent project 404, missing/invalid/whitespace `partyType`/`shareId` 400, whitespace-trimming, share-not-found 404, unlinked-share 403, co-Partner 403, Sub-partner-viewing-parent 403, Owner/Admin unconditional 200 (incl. `sub_partner` target and zero-subs), Partner/Sub-partner self-access 200, the AC worked example from both Sub1's and Sub2's own sessions, both 409 precondition errors, and the upsert side effect.
- `packages/core/src/withdrawal-adjustment.test.ts`: added the AC's exact independent-siblings worked example as a direct `computeWithdrawalAdjustment` test (Partner A retains 0% so its aggregate `canTake` is the sum of Sub1+Sub2's 50%/50% split of 1,25,000; Sub1 taken via an absent key = 0, Sub2 taken = 62,500).
- `apps/web/app/api/projects/[id]/withdrawal-adjustments/route.test.ts`: added the same scenario at the route level, asserting the same figures through the real Owner/Admin-only broad endpoint.

Also ran `pnpm --filter @niveshbook/core build` to refresh `packages/core/dist` -- `apps/web` resolves `@niveshbook/core` via its `main: "./dist/index.js"` field (no build step for `packages/ui`, but `packages/core` does have one), so the new barrel export and `authorize.ts` changes were invisible to `apps/web`'s test/build until the dist was rebuilt; without this step every new-action route test failed with `Cannot read properties of undefined (reading 'has')` inside `authorize()`.

**Verification performed:**
- `pnpm --filter @niveshbook/core test`: 497 passed, 0 failed (incl. the 8 new `withdrawal-status.test.ts` tests, the 8 new `authorize.test.ts` tests, and the 1 new `withdrawal-adjustment.test.ts` worked-example test).
- `pnpm --filter @niveshbook/web test`: 538 passed, 0 failed (incl. the new route's full suite and the `withdrawal-adjustments` route-level worked-example addition).
- `pnpm lint` (incl. `eslint-plugin-security`) / `pnpm lint:boundaries`: clean (only pre-existing `security/detect-object-injection`/unused-disable warnings elsewhere in the codebase, none in new files; dependency-cruiser reports no violations, 229 modules/410 deps).
- `pnpm typecheck`: clean across all 6 packages.
- `pnpm build`: clean; `/api/projects/[id]/my-withdrawal-status` appears in the Next.js route manifest as a dynamic (`ƒ`) route alongside the other withdrawal-domain endpoints.
- `pnpm audit`: no known vulnerabilities.
- **Live verification: not performed via browser/curl, by orchestrator decision.** Postgres was reachable by the time of the orchestrator's own re-verification pass (unlike the implementer's session), and `pnpm --filter @niveshbook/db test` ran cleanly against it, confirming DB connectivity/schema integrity. A full manual curl-based end-to-end pass (mirroring Story 4.5's) was deliberately skipped given this is a pure `GET`/read endpoint with no money-movement/write-path risk (unlike 4.5's cap-enforcement gate), and the mocked route-test suite already covers every I/O-matrix row precisely, including the privacy-boundary scenarios this patch round added. The 3-layer review scrutinized the authorization logic specifically for this tradeoff and found it acceptable.

## Spec Change Log

No changes to the frozen Intent/Boundaries/I/O matrix were needed -- implementation matched the Code Map as written on the first pass.

Patch round 1 (Review Triage Log rows 1, 2, 4, 6): added the sibling-Sub-partner denial test (the scenario this story's own worked example centers on, and Boundaries explicitly claims is protected), a cross-branch denial test, and an Owner/Admin-viewing-unlinked-share success test; corrected a misleading test title in `authorize.test.ts` that implied a self-access liveness check was being tested when it wasn't (no behavior change — that precedent is deliberately unchanged, matching Story 3.6). The case-sensitivity finding (row 3) was appended to the existing, already-tracked `deferred-work.md` entry rather than patched in isolation. Independently re-verified: `pnpm turbo run test lint typecheck build --force` (18/18 green, 541 web + 497 core tests), `pnpm lint:boundaries` (clean, 229 modules/410 deps).

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (blind-hunter) No test exercises the sibling-Sub-partner case — Sub1 requesting `partyType=sub_partner&shareId=sub-2` (both under the same parent Partner A). This is exactly the scenario the story's own worked example is built around, and Boundaries explicitly states "No exposing a Sub-partner's sibling data... under any circumstance," yet only co-Partner-vs-Partner and Sub-partner-vs-own-parent denials are tested. | low-medium (real — directly tests this story's own explicit claim; the underlying `authorize()` self-access check is expected to deny correctly, per code trace, but was unverified for this exact case) | Confirmed via `grep` across the test suite — no test has both actor and target as sibling Sub-partners. | patch |
| 2 | (blind-hunter) Similarly missing: a cross-branch case — an entity under one Partner attempting to view an entity under a *different* Partner (beyond the simple co-Partner-vs-Partner case already tested). | low (real, narrow; cheap to fold into the same patch) | Confirmed via `grep`. | patch (folded into #1) |
| 3 | (blind-hunter, edge-case-hunter — both independently) Target-share resolution (`route.ts`, `partnerShares.find(... === query.shareId)`) is case-sensitive, while `authorize()`'s self-access `ownerId` match is case-insensitive — a `shareId` sent in different casing would 404 before ever reaching `authorize()`. | defer (pre-existing class of issue, already tracked) | Matches the exact shape of the case-sensitivity gap already logged in `deferred-work.md` (Stories 2.5/2.6's identical issue, "present in three routes... a deliberate sweep, not a one-route patch") — this is now a 4th occurrence. Appended to that existing entry rather than creating a new one or patching in isolation. | defer (existing deferred-work.md entry updated) |
| 4 | (edge-case-hunter) `authorize.test.ts`'s test titled "denies an actor that no longer exists, even targeting their own (former) id" actually calls `authorize("ghost", "withdrawal_status:view", {ownerId: "someone-else"}, deps)` — `ownerId` doesn't match `actorUserId`, so the self-access branch is never exercised; the test denies for an unrelated reason (no role match) while its title implies it tests the self-access-with-ghost-actor path. | low (real, misleading test title/intent vs. what's actually asserted; trivial fix) | Confirmed by reading the test directly. | patch (rename to accurately describe what's tested — a non-self-access ghost actor is denied for lacking role permission, not because of a self-access liveness check) |
| 5 | (edge-case-hunter) The self-access short-circuit itself doesn't verify the actor still exists/is active before granting access (an actor whose `userId` still matches `resourceRef.ownerId` gets `allowed: true` even if deleted). | defer (pre-existing, already explicitly accepted) | Identical to Story 3.6's own Review Triage Log row 5: "matches established, already-accepted Story 3.3 precedent, not introduced by this story." `withdrawal_status:view`'s `SELF_ACCESS_ACTIONS` entry inherits the same, already-reviewed short-circuit shape unchanged. | defer |
| 6 | (blind-hunter) No test confirms Owner/Admin can view a share whose `userId` is null/unlinked — only the *denial* of a non-owner_admin caller against an unlinked share is tested. | low (real, minor; cheap to fold into #1's patch pass) | Confirmed via `grep`. | patch (folded into #1) |
| 7 | (blind-hunter) `computeWithdrawalAdjustment` upserts the *entire* project's adjustment rows as a side effect of this GET, even for a self-access-only caller authorized to read only their own slice. | defer (pre-existing, matches 4.3's/3.6's identical precedent) | `my-investment-status/route.ts` (Story 3.6) calls `computeInvestmentAdjustment` the same way — "every call upserts," by design since Story 3.4. Not a new risk class: the written values are a deterministic function of already-existing share/transaction data, never read back to the low-privilege caller beyond their own slice. | defer |
| 8 | (blind-hunter) 404-before-`authorize()` ordering lets an authenticated project member distinguish "no such shareId" from "shareId exists but forbidden," enabling enumeration of which Partner/Sub-partner ids exist. | defer (pre-existing) | `my-investment-status/route.ts` has the identical ordering (`shareNotFoundResponse()` before `authorize()`), confirmed by direct read. | defer |
| 9 | (blind-hunter) `extractWithdrawalStatus`'s sub-partner branch does a linear first-match scan with no uniqueness check across the tree. | defer (pre-existing) | `extractInvestmentStatus` (Story 3.6) has the byte-identical shape, confirmed by direct read. | defer |
| 10 | (blind-hunter) `groupByPartnerId`/`groupTransactionsByShareKey` duplicated a third/fourth time across withdrawal/investment routes, no shared implementation. | false (deliberate, already-documented convention) | Explicitly justified in-code as "kept local... matching established precedent" — this codebase's consistent per-route-ownership convention, not an oversight. | — |
| 11 | (blind-hunter) A parent Partner directly querying `partyType=sub_partner&shareId=<their own sub's id>` gets 403, even though the same data is already visible nested inside their own Partner-level view. | false (by design, not a defect) | Self-access keys off the target share's own linked `userId`, not a descendant relationship — matches how self-access works everywhere else in this codebase. The data isn't inaccessible to the Partner, only this one alternate query path is — not the scenario this story's AC/Boundaries are about. | — |
| 12 | (verification-gap) Confirmed no UI-adoption gap — the Withdraw Money page correctly still uses the broad Owner/Admin-only endpoint, since no Partner/Sub-partner-facing route group exists anywhere in the app yet (entire `(dashboard)` group is Owner/Admin-gated) and the spec's own Decisions explicitly defer a client consumer to Epic 5. | false (no gap — correctly, deliberately scoped) | Confirmed via direct repo scan. | — |
| 13 | (edge-case-hunter, verification-gap — corroborating) The full route ordering, `extractWithdrawalStatus`'s both branches, the worked-example arithmetic, trimmed-`shareId` behavior, and every Tasks & Acceptance claim were independently traced and confirmed correct against the real code. | false (no defect) | See each reviewer's report. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `withdrawal-status.test.ts` + `withdrawal-adjustment.test.ts` additions cover the worked example, sub-partner-only-own-entry, zero-subs
- `pnpm --filter @niveshbook/web test` — expected: route test covers the full I/O matrix incl. self-access, co-partner 403, sub-partner-vs-parent 403, Owner/Admin unconditional access
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm lint:boundaries` — expected: clean
- **Live verification:** reuse a Project with Partner A (linked) + Sub1/Sub2 (linked) matching the worked example; confirm A's own session sees their entry with nested Sub1/Sub2; confirm Sub1's own session sees only their Keep for Later ₹62,500; confirm Sub2's own session sees only their No Adjustment; confirm a different Partner's session gets 403 for A's `shareId`.
